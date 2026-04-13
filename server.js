// server.js (only showing additions/changes around routes)
const express  = require("express");
const http     = require("http");
const cors     = require("cors");
const mongoose = require("mongoose");
const socketIO = require("socket.io");
require("dotenv").config();

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

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
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


app.get("/", (req, res) => {
  res.send("TechJaguar API running");
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

  socket.on("disconnect", () => {
    console.log("Socket disconnected", socket.id);
  });
});

/* ---------- MongoDB ---------- */
const MONGO_URL =
  process.env.MONGO_URL || "mongodb://127.0.0.1:27017/techjaguar";

mongoose
  .connect(MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error:", err.message));

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
