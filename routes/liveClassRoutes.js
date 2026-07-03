const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const LiveClass = require("../models/LiveClass");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const { onlyAdmin } = require("../middleware/authRole");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";

function makeRoomCode() {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getIceServers() {
  const urls = String(process.env.WEBRTC_ICE_SERVERS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  return urls.map((url) => ({ urls: url }));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function studentHasLiveAccess(studentId) {
  return Enrollment.findOne({
    studentId,
    paymentStatus: "paid",
    status: "active",
  });
}

// Admin: save heading + schedule for global live class
router.post("/admin/save", onlyAdmin, async (req, res) => {
  try {
    const { title, scheduledAt } = req.body;

    let live = await LiveClass.findOne({ key: "global" });
    if (!live) {
      live = new LiveClass({
        key: "global",
        title: title || "Live class",
        scheduledAt,
      });
    } else {
      if (title) live.title = title;
      if (scheduledAt) live.scheduledAt = scheduledAt;
    }

    await live.save();
    res.json({ success: true, liveClass: live, iceServers: getIceServers() });
  } catch (err) {
    console.error("Error saving live class:", err);
    res.status(500).json({ error: "Failed to save live class" });
  }
});

// Admin: start internal app-only live class
router.post("/admin/start-internal", onlyAdmin, async (req, res) => {
  try {
    const { title } = req.body;

    let live = await LiveClass.findOne({ key: "global" });
    if (!live) {
      live = new LiveClass({
        key: "global",
        title: title || "Live class",
      });
    }

    if (title) live.title = title;
    live.status = "live";
    live.activeMode = "internal";
    live.internalLiveActive = true;
    live.internalRoomCode = live.internalRoomCode || makeRoomCode();
    live.internalLiveStartedAt = new Date();
    live.internalLiveEndedAt = undefined;

    await live.save();
    res.json({ success: true, liveClass: live, iceServers: getIceServers() });
  } catch (err) {
    console.error("Error starting internal live class:", err);
    res.status(500).json({ error: "Failed to start internal live class" });
  }
});

// Admin: end internal app-only live class
router.post("/admin/end-internal", onlyAdmin, async (req, res) => {
  try {
    const live = await LiveClass.findOne({ key: "global" });
    if (!live) return res.status(404).json({ error: "Live class not found" });

    live.internalLiveActive = false;
    live.internalLiveEndedAt = new Date();
    if (live.activeMode === "internal") live.status = "ended";

    await live.save();
    res.json({ success: true, liveClass: live });
  } catch (err) {
    console.error("Error ending internal live class:", err);
    res.status(500).json({ error: "Failed to end internal live class" });
  }
});

// Student: dashboard - check if they can see a live class card
router.get("/student/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const enroll = await studentHasLiveAccess(studentId);
    if (!enroll) return res.json({ hasAccess: false });

    const live = await LiveClass.findOne({ key: "global" });
    if (!live) return res.json({ hasAccess: true, hasLive: false });

    res.json({
      hasAccess: true,
      hasLive: true,
      title: live.title,
      status: live.status,
      scheduledAt: live.scheduledAt,
      activeMode: live.activeMode || "internal",
      internalLiveActive: live.internalLiveActive === true,
    });
  } catch (err) {
    console.error("Error loading live class for student:", err);
    res.status(500).json({ error: "Failed to load live class" });
  }
});

// Student: get a short-lived token for internal app-only live class
router.post("/internal/viewer-token", async (req, res) => {
  try {
    const studentId = req.user?.type === "user" ? req.user._id : req.body.studentId;
    if (!studentId) return res.status(401).json({ error: "Login required" });

    const enroll = await studentHasLiveAccess(studentId);
    if (!enroll) return res.status(403).json({ error: "No access" });

    const live = await LiveClass.findOne({
      key: "global",
      activeMode: "internal",
      internalLiveActive: true,
      status: "live",
    });

    if (!live || !live.internalRoomCode) {
      return res.status(404).json({ error: "No internal live class" });
    }

    const user = await User.findById(studentId).select("fullName username").lean();

    const token = jwt.sign(
      {
        type: "internal_live_viewer",
        studentId,
        studentName: user?.fullName || user?.username || "Student",
        roomCode: live.internalRoomCode,
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      viewerUrl: `/live-class/internal/viewer?token=${encodeURIComponent(token)}`,
      title: live.title,
    });
  } catch (err) {
    console.error("Internal live token error:", err);
    res.status(500).json({ error: "Failed to create live class token" });
  }
});

// Internal live viewer page used inside the Flutter app WebView
router.get("/internal/viewer", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    const payload = jwt.verify(token, JWT_SECRET);

    if (payload.type !== "internal_live_viewer") {
      return res.status(403).send("Invalid live class token");
    }

    const live = await LiveClass.findOne({
      key: "global",
      activeMode: "internal",
      internalLiveActive: true,
      internalRoomCode: payload.roomCode,
      status: "live",
    }).lean();

    if (!live) return res.status(404).send("Live class is not active");

    const title = escapeHtml(live.title || "Live class");
    const safeToken = JSON.stringify(token);
    const safeStudentName = JSON.stringify(payload.studentName || "Student");
    const iceServers = JSON.stringify(getIceServers());

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #020617; color: #e5e7eb; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    body { background: radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 34%), radial-gradient(circle at top right, rgba(56,189,248,.12), transparent 32%), #020617; }
    .wrap { min-height: 100vh; display: flex; flex-direction: column; }
    header { padding: 14px 16px; border-bottom: 1px solid rgba(148,163,184,.16); background: rgba(7,17,31,.92); position: sticky; top: 0; z-index: 5; backdrop-filter: blur(14px); }
    .top { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(135deg, #22c55e, #38bdf8); color: #020617; font-weight: 900; }
    h1 { font-size: 16px; margin: 0; line-height: 1.2; }
    .sub { color: #94a3b8; font-size: 12px; margin-top: 3px; }
    .live-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(239,68,68,.16); color: #fecaca; border: 1px solid rgba(239,68,68,.28); font-size: 11px; font-weight: 800; letter-spacing: .08em; }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: #ef4444; box-shadow: 0 0 14px #ef4444; }
    .status { color: #94a3b8; font-size: 12px; margin-top: 10px; }
    .stage { flex: 1; display: grid; grid-template-rows: auto minmax(240px, 1fr); gap: 12px; padding: 12px; }
    .classroom { border: 1px solid rgba(148,163,184,.18); background: rgba(15,23,42,.72); border-radius: 18px; padding: 10px; box-shadow: 0 18px 40px rgba(0,0,0,.28); }
    .video-shell { position: relative; overflow: hidden; border-radius: 15px; background: #000; border: 1px solid #1f2937; }
    video { width: 100%; min-height: 230px; max-height: 44vh; display: block; background: #000; object-fit: contain; }
    .video-label { position: absolute; left: 10px; top: 10px; padding: 5px 9px; border-radius: 999px; background: rgba(2,6,23,.76); border: 1px solid rgba(148,163,184,.22); color: #e5e7eb; font-size: 11px; font-weight: 800; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    button { border: 0; border-radius: 999px; padding: 11px 12px; background: #22c55e; color: #020617; font-weight: 800; }
    .secondary { background: #0f172a; color: #e5e7eb; border: 1px solid #334155; }
    .hand-active { background: #f97316; color: #111827; }
    .chat { min-height: 260px; border: 1px solid rgba(148,163,184,.18); border-radius: 18px; overflow: hidden; background: rgba(7,17,31,.88); display: flex; flex-direction: column; box-shadow: 0 18px 40px rgba(0,0,0,.22); }
    .chat-head { padding: 12px; border-bottom: 1px solid #1f2937; font-weight: 800; display: flex; justify-content: space-between; align-items: center; }
    .chat-head span { color: #94a3b8; font-size: 11px; font-weight: 700; }
    .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg { padding: 9px 10px; border-radius: 14px; background: #0f172a; border: 1px solid #1f2937; font-size: 13px; line-height: 1.35; }
    .msg.teacher { background: rgba(8,47,73,.72); border-color: rgba(56,189,248,.24); }
    .msg strong { color: #38bdf8; display: block; margin-bottom: 2px; font-size: 12px; }
    .chat-form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #1f2937; background: rgba(2,6,23,.64); }
    input { flex: 1; min-width: 0; border-radius: 999px; border: 1px solid #334155; background: #020617; color: #e5e7eb; padding: 11px 12px; }
    .send { flex: 0 0 auto; padding-inline: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="top">
        <div class="avatar">TJ</div>
        <div>
          <h1>${title}</h1>
          <div class="sub">Interactive classroom</div>
        </div>
        <div class="live-pill"><span class="dot"></span>LIVE</div>
      </div>
      <div id="status" class="status">Connecting to live class...</div>
    </header>
    <main class="stage">
      <section class="classroom">
        <div class="video-shell">
          <video id="remoteVideo" autoplay playsinline></video>
          <div class="video-label">Teacher Stream</div>
        </div>
        <div class="controls">
          <button id="playButton" type="button">Play Live Class</button>
          <button id="raiseHandButton" class="secondary" type="button">Raise Hand</button>
        </div>
      </section>
      <section class="chat">
        <div class="chat-head">Class Chat <span>Ask doubts live</span></div>
        <div id="messages" class="messages"></div>
        <form id="chatForm" class="chat-form">
          <input id="chatInput" placeholder="Type your message..." autocomplete="off" />
          <button class="send" type="submit">Send</button>
        </form>
      </section>
    </main>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const token = ${safeToken};
    const studentName = ${safeStudentName};
    const statusEl = document.getElementById("status");
    const remoteVideo = document.getElementById("remoteVideo");
    const playButton = document.getElementById("playButton");
    const raiseHandButton = document.getElementById("raiseHandButton");
    const messagesEl = document.getElementById("messages");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    let pc;
    let broadcasterId = null;

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function addMessage(message) {
      const item = document.createElement("div");
      item.className = "msg";
      if (message.role === "broadcaster") item.classList.add("teacher");
      item.innerHTML = "<strong></strong><span></span>";
      item.querySelector("strong").textContent = message.name || "Class";
      item.querySelector("span").textContent = message.text || "";
      messagesEl.appendChild(item);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function ensurePeerConnection() {
      if (pc) return pc;
      pc = new RTCPeerConnection({ iceServers: ${iceServers} });
      pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.play().catch(() => {});
        setStatus("Live class is playing");
      };
      pc.onicecandidate = (event) => {
        if (event.candidate && broadcasterId) {
          socket.emit("internal-live:candidate", {
            to: broadcasterId,
            candidate: event.candidate
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setStatus("Live class connection was interrupted");
        }
      };
      return pc;
    }

    const socket = io({ transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      setStatus("Waiting for teacher stream...");
      socket.emit("internal-live:viewer-join", { token });
    });

    socket.on("internal-live:offer", async ({ from, offer }) => {
      broadcasterId = from;
      const peer = ensurePeerConnection();
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("internal-live:answer", { to: from, answer });
    });

    socket.on("internal-live:candidate", async ({ candidate }) => {
      if (!candidate || !pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    });

    socket.on("internal-live:broadcaster-offline", () => {
      setStatus("Teacher has ended the live class");
    });

    socket.on("internal-live:error", ({ message }) => {
      setStatus(message || "Unable to join live class");
    });

    socket.on("internal-live:chat-message", (message) => {
      addMessage(message);
    });

    socket.on("internal-live:hand-raised", (message) => {
      addMessage({
        name: "Class",
        text: (message.name || "A student") + " raised their hand."
      });
    });

    playButton.addEventListener("click", () => {
      remoteVideo.play().catch(() => {});
    });

    raiseHandButton.addEventListener("click", () => {
      socket.emit("internal-live:raise-hand", { name: studentName });
      raiseHandButton.textContent = "Hand Raised";
      raiseHandButton.classList.add("hand-active");
      setTimeout(() => {
        raiseHandButton.textContent = "Raise Hand";
        raiseHandButton.classList.remove("hand-active");
      }, 5000);
    });

    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      socket.emit("internal-live:chat-message", { text, name: studentName });
      chatInput.value = "";
    });
  </script>
</body>
</html>`);
  } catch {
    res.status(403).send("Invalid or expired live class token");
  }
});

module.exports = router;
