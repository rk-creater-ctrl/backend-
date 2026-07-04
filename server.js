// server.js (only showing additions/changes around routes)
const express  = require("express");
const http     = require("http");
const cors     = require("cors");
const socketIO = require("socket.io");
const jwt      = require("jsonwebtoken");
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

// Supabase client (server-side)
require("./supabaseClient");


const path             = require("path");
const uploadRoutes     = require("./routes/upload");
const authRoutes       = require("./routes/auth");
const courseRoutes     = require("./routes/course");
const enrollmentRoutes = require("./routes/enrollment");
const imageUrlRoutes   = require("./routes/imageUrl");   // <-- add this
const { attachUser }   = require("./middleware/authRole");
const userRoutes       = require("./routes/user");
const paymentRoutes = require("./routes/payment");
const liveClassRoutes = require("./routes/liveClassRoutes");
const videoRoutes = require("./routes/video");
const settingsRoutes = require("./routes/settings");
const progressRoutes = require("./routes/progress");

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.set("trust proxy", 1);
app.set("io", io);
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";
const INTERNAL_LIVE_ROOM_PREFIX = "internal-live:";
let internalLiveBroadcasterId = null;

function verifySocketToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

const allowedOrigins = (process.env.FRONTEND_URLS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin include mobile apps and health checks.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());
app.use(attachUser);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/upload",     uploadRoutes);
app.use("/auth",       authRoutes);
app.use("/course",     courseRoutes);
app.use("/enrollment", enrollmentRoutes);
app.use("/image-url",  imageUrlRoutes);   // <-- add this
app.use("/user",       userRoutes);
app.use("/payment", paymentRoutes);
app.use("/live-class", liveClassRoutes);
app.use("/video", videoRoutes);
app.use("/settings", settingsRoutes);
app.use("/progress", progressRoutes);


app.get("/", (req, res) => {
  res.send("SR EduNova API running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ... rest of your server.js unchanged


/* ---------- Socket.io ---------- */
io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);

  socket.on("join-room", ({ roomCode, userId }) => {
    socket.join(roomCode);
    console.log(`User ${userId} joined room ${roomCode}`);
    socket.to(roomCode).emit("user-joined", { userId });
  });

  socket.on("offer", ({ roomCode, offer, from }) => {
    socket.to(roomCode).emit("offer", { offer, from });
  });

  socket.on("answer", ({ roomCode, answer, from }) => {
    socket.to(roomCode).emit("answer", { answer, from });
  });

  socket.on("ice-candidate", ({ roomCode, candidate, from }) => {
    socket.to(roomCode).emit("ice-candidate", { candidate, from });
  });

  socket.on("internal-live:broadcaster-start", ({ token, roomCode }) => {
    const payload = verifySocketToken(token);
    if (!payload || payload.type !== "admin" || !roomCode) {
      socket.emit("internal-live:error", { message: "Admin live access denied" });
      return;
    }

    internalLiveBroadcasterId = socket.id;
    socket.data.internalLiveRole = "broadcaster";
    socket.data.internalLiveRoomCode = roomCode;
    socket.data.internalLiveName = "Teacher";
    socket.join(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`);
    socket.emit("internal-live:broadcaster-ready", { roomCode });
    socket
      .to(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`)
      .emit("internal-live:broadcaster-online");
  });

  socket.on("internal-live:viewer-join", ({ token }) => {
    const payload = verifySocketToken(token);
    if (!payload || payload.type !== "internal_live_viewer" || !payload.roomCode) {
      socket.emit("internal-live:error", { message: "Student live access denied" });
      return;
    }

    socket.data.internalLiveRole = "viewer";
    socket.data.internalLiveRoomCode = payload.roomCode;
    socket.data.internalLiveName = payload.studentName || "Student";
    socket.join(`${INTERNAL_LIVE_ROOM_PREFIX}${payload.roomCode}`);

    if (internalLiveBroadcasterId) {
      io.to(internalLiveBroadcasterId).emit("internal-live:viewer-joined", {
        viewerId: socket.id,
        name: socket.data.internalLiveName,
      });
    } else {
      socket.emit("internal-live:error", { message: "Teacher has not started streaming yet" });
    }
  });

  socket.on("internal-live:offer", ({ to, offer }) => {
    if (!to || !offer) return;
    io.to(to).emit("internal-live:offer", { from: socket.id, offer });
  });

  socket.on("internal-live:answer", ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit("internal-live:answer", { from: socket.id, answer });
  });

  socket.on("internal-live:candidate", ({ to, candidate }) => {
    if (!to || !candidate) return;
    io.to(to).emit("internal-live:candidate", { from: socket.id, candidate });
  });

  socket.on("internal-live:chat-message", ({ text, name }) => {
    const roomCode = socket.data.internalLiveRoomCode;
    if (!roomCode || !text) return;

    const message = {
      id: `${Date.now()}_${socket.id}`,
      role: socket.data.internalLiveRole || "viewer",
      name: name || socket.data.internalLiveName || "Class",
      text: String(text).slice(0, 500),
      createdAt: new Date().toISOString(),
    };

    io.to(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`).emit(
      "internal-live:chat-message",
      message
    );
  });

  socket.on("internal-live:raise-hand", ({ name }) => {
    const roomCode = socket.data.internalLiveRoomCode;
    if (!roomCode) return;

    const message = {
      viewerId: socket.id,
      name: name || socket.data.internalLiveName || "Student",
      createdAt: new Date().toISOString(),
    };

    io.to(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`).emit(
      "internal-live:hand-raised",
      message
    );
  });

  socket.on("disconnect", () => {
    if (socket.id === internalLiveBroadcasterId) {
      internalLiveBroadcasterId = null;
      const roomCode = socket.data.internalLiveRoomCode;
      if (roomCode) {
        socket
          .to(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`)
          .emit("internal-live:broadcaster-offline");
      }
    } else if (socket.data.internalLiveRole === "viewer" && internalLiveBroadcasterId) {
      io.to(internalLiveBroadcasterId).emit("internal-live:viewer-left", {
        viewerId: socket.id,
        name: socket.data.internalLiveName,
      });
    }

    console.log("Socket disconnected", socket.id);
  });
});

/* ---------- Database: Supabase ---------- */
// Supabase connectivity is handled by `backend/supabaseClient.js`.
// This file only starts the HTTP + Socket.io servers.

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
