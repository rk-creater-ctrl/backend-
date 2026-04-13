// backend/routes/video.js
const express = require("express");
const router = express.Router();
const Video = require("../models/Video");
const { onlyAdmin } = require("../middleware/authRole");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// -----------------
// Multer setup for video files (under /uploads/videos)
// -----------------
const uploadDir = path.join(__dirname, "..", "uploads", "videos");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    const base = path.basename(file.originalname, ext);
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, base + "-" + unique + ext);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 500, // 500MB
  },
});

// -----------------
// ADMIN: list all videos
// -----------------
router.get("/all", onlyAdmin, async (req, res) => {
  try {
    const videos = await Video.find().sort({ order: 1, createdAt: -1 });
    return res.json(videos);
  } catch (err) {
    console.error("List videos error:", err);
    return res.status(500).json({ error: "Failed to list videos" });
  }
});

// -----------------
// ADMIN: create YouTube video
// -----------------
router.post("/all", onlyAdmin, async (req, res) => {
  try {
    const { title, youtubeVideoId, order } = req.body;
    if (!title || !youtubeVideoId) {
      return res
        .status(400)
        .json({ error: "title and youtubeVideoId required" });
    }

    const video = new Video({
      title,
      type: "youtube",
      youtubeVideoId,
      order: typeof order === "number" ? order : Number(order) || 0,
    });

    await video.save();
    return res.json({ success: true, video });
  } catch (err) {
    console.error("Create video error:", err);
    return res.status(500).json({ error: "Failed to create video" });
  }
});

// -----------------
// ADMIN: upload video file
// -----------------
router.post(
  "/upload",
  onlyAdmin,
  upload.single("file"), // field name MUST be "file"
  async (req, res) => {
    try {
      const { title, order } = req.body;

      if (!title) {
        return res.status(400).json({ error: "title is required" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "video file is required" });
      }

      // e.g. /uploads/videos/filename.mp4
      const relativePath = path.join("uploads", "videos", req.file.filename)
        .replace(/\\/g, "/");

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const fileUrl = `${baseUrl}/${relativePath}`;

      console.log("VIDEO UPLOAD:", {
        file: req.file,
        body: req.body,
        relativePath,
        fileUrl,
      });

      const video = new Video({
        title,
        type: "file",
        fileUrl,
        order: order ? Number(order) : 0,
      });

      await video.save();

      return res.json({ success: true, video });
    } catch (err) {
      console.error("Upload video error:", err);
      return res.status(500).json({ error: "Failed to upload video" });
    }
  }
);

// -----------------
// STUDENT: public list
// -----------------
router.get("/public", async (req, res) => {
  try {
    const videos = await Video.find().sort({ order: 1, createdAt: -1 });
    const mapped = videos.map((v) => ({
      id: v._id,
      title: v.title,
      type: v.type,
      youtubeVideoId: v.youtubeVideoId,
      fileUrl: v.fileUrl,
    }));
    return res.json(mapped);
  } catch (err) {
    console.error("Public videos error:", err);
    return res.status(500).json({ error: "Failed to load videos" });
  }
});

module.exports = router;