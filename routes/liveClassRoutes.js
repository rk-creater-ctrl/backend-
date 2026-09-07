const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { onlyAdmin, requireSelfOrAdmin, requireUser } = require("../middleware/authRole");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256";

function makeRoomCode() {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getIceServers() {
  const urls = String(process.env.WEBRTC_ICE_SERVERS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const fallbackUrls = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
  ];

  return (urls.length ? urls : fallbackUrls).map((url) => ({ urls: url }));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function studentHasLiveAccess(studentId, courseId = null) {
  let query = supabase
    .from("enrollments")
    .select("id,course_id")
    .eq("student_id", studentId)
    .eq("payment_status", "paid")
    .eq("status", "active")
    .or(`enrollment_expires_at.is.null,enrollment_expires_at.gt.${new Date().toISOString()}`);

  if (courseId) query = query.eq("course_id", courseId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

function toLiveClass(row) {
  if (!row) return null;
  return {
    _id: row.id,
    key: row.key,
    title: row.title,
    courseId: row.course_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    youtubeVideoId: row.youtube_video_id,
    activeMode: row.active_mode,
    internalLiveActive: row.internal_live_active,
    internalRoomCode: row.internal_room_code,
    internalLiveStartedAt: row.internal_live_started_at,
    internalLiveEndedAt: row.internal_live_ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function liveKeyFor(courseId) {
  return courseId ? `course:${courseId}` : "global";
}

function normalizedCourseId(value) {
  const courseId = String(value || "").trim();
  return courseId || null;
}

async function getLiveClassForTarget(courseId = null) {
  const { data, error } = await supabase
    .from("live_classes")
    .select("*")
    .eq("key", liveKeyFor(courseId))
    .maybeSingle();
  if (error) throw error;
  if (data || !courseId) return data;

  // Compatibility for a course-targeted row created before course keys were
  // introduced. New writes always use course:<uuid>.
  const { data: legacyData, error: legacyError } = await supabase
    .from("live_classes")
    .select("*")
    .eq("key", "global")
    .eq("course_id", courseId)
    .maybeSingle();
  if (legacyError) throw legacyError;
  return legacyData;
}

async function getGlobalLiveClass() {
  const { data, error } = await supabase
    .from("live_classes")
    .select("*")
    .eq("key", "global")
    .is("course_id", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getActiveInternalLiveClass() {
  const { data, error } = await supabase
    .from("live_classes")
    .select("*")
    .eq("active_mode", "internal")
    .eq("internal_live_active", true)
    .eq("status", "live")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function getInternalLiveSession(req) {
  return req.app.get("internalLiveSession");
}

function hasInternalBroadcaster(req, live) {
  return Boolean(
    live?.internal_room_code &&
    getInternalLiveSession(req)?.hasBroadcaster(live.internal_room_code)
  );
}

function isInternalBroadcastStarting(req, live) {
  return Boolean(
    live?.internal_room_code &&
    getInternalLiveSession(req)?.isStarting(live.internal_room_code)
  );
}

async function endStaleInternalLiveClass(live) {
  if (!live?.id) return;
  const { error } = await supabase
    .from("live_classes")
    .update({
      status: "ended",
      internal_live_active: false,
      internal_room_code: null,
      internal_live_ended_at: new Date().toISOString(),
    })
    .eq("id", live.id)
    .eq("active_mode", "internal")
    .eq("internal_live_active", true);
  if (error) throw error;
}

async function getEffectiveLiveClass(req, live) {
  if (live?.active_mode === "internal" &&
      live?.status === "ended" &&
      !live?.internal_room_code) {
    return null;
  }
  const markedInternalLive =
    live?.active_mode === "internal" &&
    (live?.internal_live_active === true || live?.status === "live");
  if (!markedInternalLive || hasInternalBroadcaster(req, live)) return live;

  // REST metadata is written just before the admin Socket.IO connection. Keep
  // that reservation briefly, but never advertise it to students as live yet.
  if (isInternalBroadcastStarting(req, live)) return null;

  await endStaleInternalLiveClass(live);
  return null;
}

async function saveLiveClass(courseId, values) {
  const { data, error } = await supabase
    .from("live_classes")
    .upsert(
      { key: liveKeyFor(courseId), course_id: courseId, ...values },
      { onConflict: "key" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Admin: save heading + schedule for either the global class or one course.
router.post("/admin/save", onlyAdmin, async (req, res) => {
  try {
    const { title, scheduledAt, courseId } = req.body;
    const targetCourseId = normalizedCourseId(courseId);

    const existing = await getLiveClassForTarget(targetCourseId);
    const live = await saveLiveClass(targetCourseId, {
      title: title || existing?.title || "Live class",
      scheduled_at: scheduledAt || existing?.scheduled_at || null,
    });
    res.json({ success: true, liveClass: toLiveClass(live), iceServers: getIceServers() });
  } catch (err) {
    console.error("Error saving live class:", err);
    res.status(500).json({ error: "Failed to save live class" });
  }
});

// Admin: start internal app-only live class
router.post("/admin/start-internal", onlyAdmin, async (req, res) => {
  try {
    const { title, courseId } = req.body;
    const targetCourseId = normalizedCourseId(courseId);
    const activeLive = await getActiveInternalLiveClass();
    if (activeLive) {
      if (hasInternalBroadcaster(req, activeLive) ||
          isInternalBroadcastStarting(req, activeLive)) {
        return res.status(409).json({
          error: "Another live broadcast is already active. End it before starting a new class.",
        });
      }
      await endStaleInternalLiveClass(activeLive);
    }

    const existing = await getLiveClassForTarget(targetCourseId);
    const live = await saveLiveClass(targetCourseId, {
      title: title || existing?.title || "Live class",
      status: "live",
      active_mode: "internal",
      internal_live_active: true,
      internal_room_code: makeRoomCode(),
      internal_live_started_at: new Date().toISOString(),
      internal_live_ended_at: null,
    });
    getInternalLiveSession(req)?.reserveStart(live.internal_room_code);
    await supabase.from("notifications").insert({
      title: "Live class started",
      message: live.title || "Teacher is live now.",
      type: "live",
      course_id: live.course_id || null,
      target_role: "student",
    }).then(({ error: notificationError }) => {
      if (notificationError) console.error("Live notification error:", notificationError.message);
    });
    res.json({ success: true, liveClass: toLiveClass(live), iceServers: getIceServers() });
  } catch (err) {
    console.error("Error starting internal live class:", err);
    res.status(500).json({ error: "Failed to start internal live class" });
  }
});

// Admin: end internal app-only live class
router.post("/admin/end-internal", onlyAdmin, async (req, res) => {
  try {
    const existing = await getActiveInternalLiveClass();
    if (!existing) {
      getInternalLiveSession(req)?.clearStart();
      return res.json({ success: true, liveClass: null });
    }
    const { data: live, error } = await supabase
      .from("live_classes")
      .update({
      internal_live_active: false,
      internal_room_code: null,
      internal_live_ended_at: new Date().toISOString(),
      status: existing.active_mode === "internal" ? "ended" : existing.status,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    getInternalLiveSession(req)?.clearStart(existing.internal_room_code);
    res.json({ success: true, liveClass: toLiveClass(live) });
  } catch (err) {
    console.error("Error ending internal live class:", err);
    res.status(500).json({ error: "Failed to end internal live class" });
  }
});

function liveStudentResponse(live) {
  if (!live) return { hasAccess: true, hasLive: false };
  return {
    hasAccess: true,
    hasLive: true,
    title: live.title,
    status: live.status,
    scheduledAt: live.scheduled_at,
    courseId: live.course_id,
    activeMode: live.active_mode || "internal",
    internalLiveActive: live.internal_live_active === true,
  };
}

// Student: global dashboard class. Any authenticated student may view it.
router.get("/student/global", requireUser, async (req, res) => {
  try {
    const live = await getEffectiveLiveClass(req, await getGlobalLiveClass());
    res.json(liveStudentResponse(live));
  } catch (err) {
    console.error("Error loading live class for student:", err);
    res.status(500).json({ error: "Failed to load live class" });
  }
});

// Student: the live class attached to one enrolled, paid, active course.
router.get("/student/course/:courseId", requireUser, async (req, res) => {
  try {
    const courseId = normalizedCourseId(req.params.courseId);
    if (!courseId) return res.status(400).json({ error: "Invalid course ID" });

    const enroll = await studentHasLiveAccess(req.user._id, courseId);
    if (!enroll) return res.status(403).json({ error: "No access for this live class" });

    const live = await getEffectiveLiveClass(
      req,
      await getLiveClassForTarget(courseId)
    );
    res.json(liveStudentResponse(live));
  } catch (err) {
    console.error("Error loading course live class for student:", err);
    res.status(500).json({ error: "Failed to load live class" });
  }
});

// Compatibility endpoint for older clients. It is global-only and never
// returns a course-targeted row.
router.get("/student/:studentId", requireSelfOrAdmin(), async (req, res) => {
  try {
    const live = await getEffectiveLiveClass(req, await getGlobalLiveClass());
    res.json(liveStudentResponse(live));
  } catch (err) {
    console.error("Error loading live class for student:", err);
    res.status(500).json({ error: "Failed to load live class" });
  }
});

// Student: get a short-lived token for internal app-only live class
router.post("/internal/viewer-token", requireUser, async (req, res) => {
  try {
    const studentId = req.user._id;
    const requestedCourseId = normalizedCourseId(req.body?.courseId);

    const storedLive = requestedCourseId
      ? await getLiveClassForTarget(requestedCourseId)
      : await getGlobalLiveClass();
    const live = await getEffectiveLiveClass(req, storedLive);

    if (!live || live.active_mode !== "internal" || !live.internal_live_active ||
        live.status !== "live" || !live.internal_room_code) {
      return res.status(404).json({ error: "No internal live class" });
    }

    if (live.course_id) {
      const enroll = await studentHasLiveAccess(studentId, live.course_id);
      if (!enroll) return res.status(403).json({ error: "No access for this live class" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("full_name,username")
      .eq("id", studentId)
      .maybeSingle();
    if (userError) throw userError;

    const token = jwt.sign(
      {
        type: "internal_live_viewer",
        studentId,
        studentName: user?.full_name || user?.username || "Student",
        roomCode: live.internal_room_code,
        liveClassId: live.id,
      },
      JWT_SECRET,
      { expiresIn: "2h", algorithm: JWT_ALGORITHM }
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
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

    if (payload.type !== "internal_live_viewer") {
      return res.status(403).send("Invalid live class token");
    }

    const { data: live, error: liveError } = await supabase
      .from("live_classes")
      .select("*")
      .eq("id", payload.liveClassId)
      .maybeSingle();
    if (liveError) throw liveError;

    const effectiveLive = await getEffectiveLiveClass(req, live);

    if (!effectiveLive || effectiveLive.active_mode !== "internal" ||
        !effectiveLive.internal_live_active ||
        effectiveLive.internal_room_code !== payload.roomCode ||
        effectiveLive.status !== "live") {
      return res.status(404).send("Live class is not active");
    }

    const title = escapeHtml(effectiveLive.title || "Live class");
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
    video { width: 100%; min-height: 230px; max-height: 72vh; display: block; background: #000; object-fit: contain; }
    .video-label { position: absolute; left: 10px; top: 10px; padding: 5px 9px; border-radius: 999px; background: rgba(2,6,23,.76); border: 1px solid rgba(148,163,184,.22); color: #e5e7eb; font-size: 11px; font-weight: 800; }
    .video-shell:fullscreen { width: 100vw; height: 100vh; border: 0; border-radius: 0; display: grid; place-items: center; background: #000; }
    .video-shell:fullscreen video { width: 100vw; height: 100vh; min-height: 0; max-height: none; object-fit: contain; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    button { border: 0; border-radius: 999px; padding: 11px 12px; background: #22c55e; color: #020617; font-weight: 800; }
    .secondary { background: #0f172a; color: #e5e7eb; border: 1px solid #334155; }
    .student-access { display: none; margin-top: 10px; padding: 10px; border-radius: 16px; border: 1px solid rgba(56,189,248,.2); background: rgba(8,47,73,.3); }
    .student-access.visible { display: block; }
    .student-access-title { font-size: 12px; color: #bae6fd; font-weight: 800; margin-bottom: 8px; }
    .student-access-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .student-access button { display: none; }
    .student-access button.visible { display: block; }
    .danger { background: #ef4444; color: #fff; }
    .hand-active { background: #f97316; color: #111827; }
    .chat { min-height: 260px; border: 1px solid rgba(148,163,184,.18); border-radius: 18px; overflow: hidden; background: rgba(7,17,31,.88); display: flex; flex-direction: column; box-shadow: 0 18px 40px rgba(0,0,0,.22); }
    .chat-head { padding: 12px; border-bottom: 1px solid #1f2937; font-weight: 800; display: flex; justify-content: space-between; align-items: center; }
    .chat-head span { color: #94a3b8; font-size: 11px; font-weight: 700; }
    .messages { flex: 1; overflow-y: auto; padding: 13px; display: flex; flex-direction: column; gap: 14px; }
    .empty-chat { color: #94a3b8; font-size: 13px; padding: 16px; border: 1px dashed #334155; border-radius: 14px; text-align: center; background: rgba(2,6,23,.48); }
    .msg { display: grid; grid-template-columns: 36px 1fr; gap: 10px; font-size: 13px; line-height: 1.38; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg,#334155,#0f172a); color: #e5e7eb; font-size: 12px; font-weight: 900; }
    .msg.teacher .avatar { background: linear-gradient(135deg,#38bdf8,#22c55e); color: #03111f; }
    .meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 3px; }
    .name { color: #e5e7eb; font-weight: 800; }
    .time { color: #64748b; font-size: 11px; }
    .teacher-badge { border-radius: 999px; background: #38bdf8; color: #03111f; padding: 2px 7px; font-size: 10px; font-weight: 900; }
    .text { color: #d1d5db; word-break: break-word; }
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
          <button id="fullscreenVideoButton" class="secondary" type="button">Fullscreen Video</button>
          <button id="raiseHandButton" class="secondary" type="button">Raise Hand</button>
        </div>
        <div id="studentAccessPanel" class="student-access">
          <div class="student-access-title">Host allowed you to participate</div>
          <div class="student-access-buttons">
            <button id="studentMicButton" class="secondary" type="button">Share Mic</button>
            <button id="studentCameraButton" class="secondary" type="button">Share Camera</button>
            <button id="studentScreenButton" class="secondary" type="button">Share Screen</button>
            <button id="studentStopShareButton" class="danger" type="button">Stop Sharing</button>
          </div>
        </div>
      </section>
      <section class="chat">
        <div class="chat-head">Live Comments <span>Ask doubts live</span></div>
        <div id="messages" class="messages">
          <div id="emptyChat" class="empty-chat">No comments yet. Start the discussion with your teacher.</div>
        </div>
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
    const videoShell = document.querySelector(".video-shell");
    const playButton = document.getElementById("playButton");
    const fullscreenVideoButton = document.getElementById("fullscreenVideoButton");
    const raiseHandButton = document.getElementById("raiseHandButton");
    const studentAccessPanel = document.getElementById("studentAccessPanel");
    const studentMicButton = document.getElementById("studentMicButton");
    const studentCameraButton = document.getElementById("studentCameraButton");
    const studentScreenButton = document.getElementById("studentScreenButton");
    const studentStopShareButton = document.getElementById("studentStopShareButton");
    const messagesEl = document.getElementById("messages");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    let pc;
    let studentMediaPc;
    let studentMediaStream;
    let activeStudentMediaType = null;
    let broadcasterId = null;
    let studentPermissions = { mic: false, camera: false, screen: false };

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function getInitials(name) {
      return String(name || "Class")
        .trim()
        .split(/\\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "C";
    }

    function formatMessageTime(value) {
      try {
        return new Date(value || Date.now()).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
      } catch {
        return "now";
      }
    }

    function addMessage(message) {
      const emptyChat = document.getElementById("emptyChat");
      if (emptyChat) emptyChat.remove();
      const item = document.createElement("div");
      item.className = "msg";
      if (message.role === "broadcaster") item.classList.add("teacher");
      item.innerHTML = '<div class="avatar"></div><div><div class="meta"><span class="name"></span><span class="teacher-badge">TEACHER</span><span class="time"></span></div><div class="text"></div></div>';
      item.querySelector(".avatar").textContent = getInitials(message.name);
      item.querySelector(".name").textContent = message.name || "Class";
      item.querySelector(".time").textContent = formatMessageTime(message.createdAt);
      item.querySelector(".text").textContent = message.text || "";
      const badge = item.querySelector(".teacher-badge");
      if (message.role !== "broadcaster") badge.remove();
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

    function updateStudentAccessButtons() {
      const hasAny = studentPermissions.mic || studentPermissions.camera || studentPermissions.screen;
      studentAccessPanel.classList.toggle("visible", hasAny);
      studentMicButton.classList.toggle("visible", studentPermissions.mic);
      studentCameraButton.classList.toggle("visible", studentPermissions.camera);
      studentScreenButton.classList.toggle("visible", studentPermissions.screen);
      studentStopShareButton.classList.toggle("visible", Boolean(studentMediaStream));
    }

    function stopStudentMedia() {
      if (studentMediaPc) {
        studentMediaPc.close();
        studentMediaPc = null;
      }
      if (studentMediaStream) {
        studentMediaStream.getTracks().forEach((track) => track.stop());
        studentMediaStream = null;
      }
      if (activeStudentMediaType) {
        socket.emit("internal-live:student-media-stopped", { mediaType: activeStudentMediaType });
      }
      activeStudentMediaType = null;
      updateStudentAccessButtons();
      setStatus("Stopped sharing your media");
    }

    async function startStudentMedia(mediaType) {
      if (!broadcasterId) {
        setStatus("Teacher connection is not ready yet");
        return;
      }

      if (!studentPermissions[mediaType]) {
        setStatus("Host has not allowed this option");
        return;
      }

      stopStudentMedia();

      try {
        if (mediaType === "screen") {
          studentMediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } else {
          studentMediaStream = await navigator.mediaDevices.getUserMedia({
            video: mediaType === "camera",
            audio: mediaType === "mic" || mediaType === "camera",
          });
        }

        activeStudentMediaType = mediaType;
        studentMediaPc = new RTCPeerConnection({ iceServers: ${iceServers} });
        studentMediaStream.getTracks().forEach((track) => studentMediaPc.addTrack(track, studentMediaStream));
        studentMediaStream.getTracks().forEach((track) => {
          track.onended = () => stopStudentMedia();
        });

        studentMediaPc.onicecandidate = (event) => {
          if (event.candidate && broadcasterId) {
            socket.emit("internal-live:student-media-candidate", {
              to: broadcasterId,
              candidate: event.candidate
            });
          }
        };

        const offer = await studentMediaPc.createOffer();
        await studentMediaPc.setLocalDescription(offer);
        socket.emit("internal-live:student-media-offer", {
          to: broadcasterId,
          offer,
          mediaType
        });
        updateStudentAccessButtons();
        setStatus("Sharing " + mediaType + " with teacher");
      } catch (error) {
        stopStudentMedia();
        setStatus("Could not start sharing. Permission may be blocked.");
      }
    }

    const socket = io({
      // Render can reject an initial WebSocket handshake while an instance is
      // waking. Start with Socket.IO polling, then upgrade to WebSocket when
      // available. WebRTC media still travels directly between teacher/student.
      transports: ["polling", "websocket"],
      upgrade: true,
      tryAllTransports: true,
      reconnectionAttempts: 4,
      timeout: 12000
    });

    socket.on("connect", () => {
      setStatus("Waiting for teacher stream...");
      socket.emit("internal-live:viewer-join", { token });
    });

    socket.on("connect_error", (error) => {
      setStatus("Live connection failed. Please refresh or try another network.");
      console.error("Socket connection error", error && error.message);
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

    socket.on("internal-live:student-permissions", ({ permissions }) => {
      studentPermissions = {
        mic: permissions && permissions.mic === true,
        camera: permissions && permissions.camera === true,
        screen: permissions && permissions.screen === true
      };
      updateStudentAccessButtons();
      if (activeStudentMediaType && !studentPermissions[activeStudentMediaType]) stopStudentMedia();
    });

    socket.on("internal-live:student-media-answer", async ({ answer }) => {
      if (!studentMediaPc || !answer) return;
      await studentMediaPc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("internal-live:student-media-candidate", async ({ candidate }) => {
      if (!studentMediaPc || !candidate) return;
      try {
        await studentMediaPc.addIceCandidate(new RTCIceCandidate(candidate));
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

    fullscreenVideoButton.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement && videoShell.requestFullscreen) {
          await videoShell.requestFullscreen();
          fullscreenVideoButton.textContent = "Exit Fullscreen";
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
          fullscreenVideoButton.textContent = "Fullscreen Video";
        }
      } catch {}
    });

    document.addEventListener("fullscreenchange", () => {
      fullscreenVideoButton.textContent = document.fullscreenElement
        ? "Exit Fullscreen"
        : "Fullscreen Video";
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

    studentMicButton.addEventListener("click", () => startStudentMedia("mic"));
    studentCameraButton.addEventListener("click", () => startStudentMedia("camera"));
    studentScreenButton.addEventListener("click", () => startStudentMedia("screen"));
    studentStopShareButton.addEventListener("click", stopStudentMedia);

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
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

module.exports = router;
