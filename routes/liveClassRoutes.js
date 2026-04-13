const express = require("express");
const router = express.Router();
const LiveClass = require("../models/LiveClass");
const Enrollment = require("../models/Enrollment");

// Admin: save heading + schedule for global live class
router.post("/admin/save", async (req, res) => {
  try {
    const { title, scheduledAt } = req.body;

    let live = await LiveClass.findOne({ key: "global" });
    if (!live) {
      live = new LiveClass({
        key: "global",
        title,
        scheduledAt,
      });
    } else {
      if (title) live.title = title;
      if (scheduledAt) live.scheduledAt = scheduledAt;
    }

    await live.save();
    res.json({ success: true, liveClass: live });
  } catch (err) {
    console.error("Error saving live class:", err);
    res.status(500).json({ error: "Failed to save live class" });
  }
});

// Admin: set YouTube video id and mark as live
router.post("/admin/set-youtube", async (req, res) => {
  try {
    const { youtubeVideoId, status } = req.body;

    let live = await LiveClass.findOne({ key: "global" });
    if (!live) {
      return res.status(404).json({ error: "Live class not found. Save heading first." });
    }

    if (youtubeVideoId) {
      live.youtubeVideoId = youtubeVideoId;
    }
    if (status && ["scheduled", "live", "ended"].includes(status)) {
      live.status = status;
    }

    await live.save();
    res.json({ success: true, liveClass: live });
  } catch (err) {
    console.error("Error setting YouTube for live class:", err);
    res.status(500).json({ error: "Failed to update live class" });
  }
});

// Student: dashboard – check if they can see a live class card
router.get("/student/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    // Has at least one paid, active enrollment?
    const enroll = await Enrollment.findOne({
      studentId,
      paymentStatus: "paid",
      status: "active",
    });

    if (!enroll) {
      return res.json({ hasAccess: false });
    }

    const live = await LiveClass.findOne({ key: "global" });

    if (!live) {
      return res.json({ hasAccess: true, hasLive: false });
    }

    res.json({
      hasAccess: true,
      hasLive: true,
      title: live.title,
      status: live.status,
      scheduledAt: live.scheduledAt,
    });
  } catch (err) {
    console.error("Error loading live class for student:", err);
    res.status(500).json({ error: "Failed to load live class" });
  }
});

// Student: join live class (returns only videoId + title)
router.post("/join", async (req, res) => {
  try {
    const { studentId } = req.body;

    // Check paid enrollment
    const enroll = await Enrollment.findOne({
      studentId,
      paymentStatus: "paid",
      status: "active",
    });

    if (!enroll) {
      return res.status(403).json({ error: "No access" });
    }

    const live = await LiveClass.findOne({
      key: "global",
      status: { $in: ["live", "scheduled"] },
    });

    if (!live || !live.youtubeVideoId) {
      return res.status(404).json({ error: "No live class" });
    }

    // Do NOT send YouTube URL, only id and title
    res.json({
      videoId: live.youtubeVideoId,
      title: live.title,
    });
  } catch (err) {
    console.error("Error joining live class:", err);
    res.status(500).json({ error: "Failed to join live class" });
  }
});

module.exports = router;