// server.js (only showing additions/changes around routes)
const express  = require("express");
const http     = require("http");
const cors     = require("cors");
const helmet   = require("helmet");
const rateLimit = require("express-rate-limit");
const socketIO = require("socket.io");
const jwt      = require("jsonwebtoken");
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ALGORITHM = "HS256";
const isProduction = process.env.NODE_ENV === "production";
const weakJwtSecrets = new Set([
  "dev_secret_key",
  "change_me_to_a_long_random_secret",
  "your_jwt_secret",
  "jwt_secret",
]);

if (isProduction && (!JWT_SECRET || JWT_SECRET.length < 32 || weakJwtSecrets.has(JWT_SECRET.toLowerCase()))) {
  throw new Error("A strong JWT_SECRET (at least 32 characters and not a default value) is required in production");
}

// Supabase client (server-side)
const { supabase } = require("./supabaseClient");


const path             = require("path");
const uploadRoutes     = require("./routes/upload");
const authRoutes       = require("./routes/auth");
const courseRoutes     = require("./routes/course");
const enrollmentRoutes = require("./routes/enrollment");
const imageUrlRoutes   = require("./routes/imageUrl");   // <-- add this
const { attachUser }   = require("./middleware/authRole");
const userRoutes       = require("./routes/user");
const liveClassRoutes = require("./routes/liveClassRoutes");
const videoRoutes = require("./routes/video");
const settingsRoutes = require("./routes/settings");
const progressRoutes = require("./routes/progress");
const materialRoutes = require("./routes/material");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notification");

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedBrowserOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin is not allowed by Socket.IO CORS"));
    },
    methods: ["GET", "POST"]
  }
});
app.set("trust proxy", 1);
app.set("io", io);
const INTERNAL_LIVE_ROOM_PREFIX = "internal-live:";
let internalLiveBroadcasterId = null;
let internalLiveStartingRoomCode = null;
let internalLiveStartingTimer = null;

function clearInternalLiveStarting(roomCode = null) {
  if (roomCode && internalLiveStartingRoomCode !== roomCode) return;
  internalLiveStartingRoomCode = null;
  if (internalLiveStartingTimer) clearTimeout(internalLiveStartingTimer);
  internalLiveStartingTimer = null;
}

function reserveInternalLiveStart(roomCode) {
  clearInternalLiveStarting();
  internalLiveStartingRoomCode = roomCode;
  internalLiveStartingTimer = setTimeout(() => {
    clearInternalLiveStarting(roomCode);
    endInternalLiveRow(roomCode).catch(() => {
      console.error("Failed to clear an unconnected internal live session");
    });
  }, 30000);
  internalLiveStartingTimer.unref();
}

function hasConnectedInternalBroadcaster(roomCode) {
  if (!internalLiveBroadcasterId) return false;
  const broadcaster = io.sockets.sockets.get(internalLiveBroadcasterId);
  return Boolean(
    broadcaster?.connected &&
    (!roomCode || broadcaster.data.internalLiveRoomCode === roomCode)
  );
}

async function endInternalLiveRow(roomCode) {
  if (!roomCode) return;
  const { error } = await supabase
    .from("live_classes")
    .update({
      status: "ended",
      internal_live_active: false,
      internal_room_code: null,
      internal_live_ended_at: new Date().toISOString(),
    })
    .eq("active_mode", "internal")
    .eq("internal_live_active", true)
    .eq("internal_room_code", roomCode);
  if (error) console.error("Failed to clear disconnected internal live session");
}

async function clearStaleInternalLiveRows() {
  const { error } = await supabase
    .from("live_classes")
    .update({
      status: "ended",
      internal_live_active: false,
      internal_room_code: null,
      internal_live_ended_at: new Date().toISOString(),
    })
    .eq("active_mode", "internal")
    .or("internal_live_active.eq.true,status.eq.live");
  if (error) throw error;
}

app.set("internalLiveSession", {
  hasBroadcaster: hasConnectedInternalBroadcaster,
  isStarting: (roomCode) => internalLiveStartingRoomCode === roomCode,
  reserveStart: reserveInternalLiveStart,
  clearStart: clearInternalLiveStarting,
});

function verifySocketToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return null;
  }
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

const allowedOrigins = [
  process.env.FRONTEND_URLS,
]
  .filter(Boolean)
  .join(",")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

function isLocalhostOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function isAllowedBrowserOrigin(origin) {
  // Mobile clients, curl, health checks, and server-to-server calls have no Origin.
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  // Development supports the local React admin and local browser testing only.
  return !isProduction && isLocalhostOrigin(normalizedOrigin);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/socket.io/"),
  handler: (req, res) => {
    res.status(429).json({ message: "Too many requests. Please try again in 15 minutes." });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ message: "Too many authentication attempts. Please try again in 15 minutes." });
  },
});

app.use(cors({
  origin(origin, callback) {
    if (isAllowedBrowserOrigin(origin)) {
      return callback(null, true);
    }
    const error = new Error("Origin not allowed");
    error.code = "CORS_ORIGIN_DENIED";
    error.status = 403;
    return callback(error);
  },
  credentials: true,
}));
// Keep Helmet's safe headers while avoiding CSP/COEP restrictions on the
// existing inline live-class viewer and WebRTC/media integrations.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(attachUser);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// HTTP API only: Socket.IO owns /socket.io and is deliberately not limited.
app.use(apiLimiter);

app.use("/upload",     uploadRoutes);
app.use("/auth",       authLimiter, authRoutes);
app.use("/course",     courseRoutes);
app.use("/enrollment", enrollmentRoutes);
app.use("/image-url",  imageUrlRoutes);   // <-- add this
app.use("/user",       userRoutes);
app.use("/live-class", liveClassRoutes);
app.use("/video", videoRoutes);
app.use("/settings", settingsRoutes);
app.use("/progress", progressRoutes);
app.use("/material", materialRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/notification", notificationRoutes);


app.get("/", (req, res) => {
  res.send("SR EduNova API running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.code === "CORS_ORIGIN_DENIED") {
    return res.status(403).json({ message: "Origin not allowed" });
  }
  if ((err instanceof SyntaxError && err.status === 400) || err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "Uploaded file is too large" });
  }
  if (err?.code === "INVALID_FILE_TYPE") {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  if (typeof err?.code === "string" && err.code.startsWith("LIMIT_")) {
    return res.status(400).json({ message: "Invalid multipart upload" });
  }
  if (err?.status === 400) {
    return res.status(400).json({ message: "Invalid request" });
  }
  if ([401, 403, 404, 413].includes(err?.status)) {
    const messages = {
      401: "Authentication required",
      403: "Access denied",
      404: "Resource not found",
      413: "Request body too large",
    };
    return res.status(err.status).json({ message: messages[err.status] });
  }

  const safeMessage = String(err?.message || "Unknown error")
    .replace(/(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .slice(0, 500);
  console.error("Unhandled request error:", {
    name: err?.name,
    code: err?.code,
    status: err?.status,
    message: safeMessage,
  });
  return res.status(500).json({ message: "Internal server error" });
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

    if (internalLiveStartingRoomCode !== roomCode &&
        !(internalLiveBroadcasterId === socket.id &&
          socket.data.internalLiveRoomCode === roomCode)) {
      socket.emit("internal-live:error", {
        message: "This live broadcast is no longer active",
      });
      return;
    }

    if (internalLiveBroadcasterId && internalLiveBroadcasterId !== socket.id) {
      socket.emit("internal-live:error", {
        message: "Another live broadcast is already active",
      });
      return;
    }

    internalLiveBroadcasterId = socket.id;
    clearInternalLiveStarting(roomCode);
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

  socket.on("internal-live:set-student-permissions", ({ viewerId, permissions }) => {
    if (socket.data.internalLiveRole !== "broadcaster" || !viewerId) return;
    io.to(viewerId).emit("internal-live:student-permissions", {
      permissions: {
        mic: permissions?.mic === true,
        camera: permissions?.camera === true,
        screen: permissions?.screen === true,
      },
    });
  });

  socket.on("internal-live:student-media-offer", ({ to, offer, mediaType }) => {
    if (socket.data.internalLiveRole !== "viewer" || !to || !offer) return;
    io.to(to).emit("internal-live:student-media-offer", {
      from: socket.id,
      name: socket.data.internalLiveName || "Student",
      offer,
      mediaType: mediaType || "camera",
    });
  });

  socket.on("internal-live:student-media-answer", ({ to, answer }) => {
    if (socket.data.internalLiveRole !== "broadcaster" || !to || !answer) return;
    io.to(to).emit("internal-live:student-media-answer", {
      from: socket.id,
      answer,
    });
  });

  socket.on("internal-live:student-media-candidate", ({ to, candidate }) => {
    if (!to || !candidate) return;
    io.to(to).emit("internal-live:student-media-candidate", {
      from: socket.id,
      candidate,
    });
  });

  socket.on("internal-live:student-media-stopped", ({ mediaType }) => {
    if (socket.data.internalLiveRole !== "viewer" || !internalLiveBroadcasterId) return;
    io.to(internalLiveBroadcasterId).emit("internal-live:student-media-stopped", {
      viewerId: socket.id,
      mediaType: mediaType || "camera",
    });
  });

  socket.on("disconnect", () => {
    if (socket.id === internalLiveBroadcasterId) {
      internalLiveBroadcasterId = null;
      const roomCode = socket.data.internalLiveRoomCode;
      clearInternalLiveStarting(roomCode);
      if (roomCode) {
        socket
          .to(`${INTERNAL_LIVE_ROOM_PREFIX}${roomCode}`)
          .emit("internal-live:broadcaster-offline");
        endInternalLiveRow(roomCode).catch(() => {
          console.error("Failed to end disconnected internal live session");
        });
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
clearStaleInternalLiveRows()
  .catch(() => {
    console.error("Failed to clear stale internal live sessions during startup");
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log("Server running on port", PORT);
      if (isProduction && allowedOrigins.length === 0) {
        console.warn("FRONTEND_URLS is not configured; browser-origin requests will be rejected in production.");
      }
    });
  });

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing server`);
  io.close();
  server.close(() => {
    process.exitCode = 0;
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, io };
