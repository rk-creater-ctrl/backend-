// backend/routes/video.js
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
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

function removeLocalVideoFile(fileUrl) {
  if (!fileUrl) return;

  try {
    const parsed = new URL(fileUrl, "http://local");
    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");

    if (!relativePath.startsWith("uploads/videos/")) return;

    const resolvedPath = path.resolve(__dirname, "..", relativePath);
    const resolvedUploadDir = path.resolve(uploadDir);

    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep)) return;

    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
  } catch (err) {
    console.error("Delete local video file error:", err.message);
  }
}

async function deleteVideoById(req, res) {
  try {
    const { data: video, error: selError } = await supabase
      .from("videos")
      .select("id,type,file_url")
      .eq("id", req.params.id)
      .maybeSingle();

    if (selError) throw selError;
    if (!video) return res.status(404).json({ error: "Video not found" });

    if (video.type === "file") {
      removeLocalVideoFile(video.file_url);
    }

    const { error: delError } = await supabase
      .from("videos")
      .delete()
      .eq("id", req.params.id);

    if (delError) throw delError;

    return res.json({ success: true, deletedId: String(video.id) });
  } catch (err) {
    console.error("Delete video error:", err);
    return res.status(500).json({ error: "Failed to delete video" });
  }
}

// -----------------
// ADMIN: list all videos
// -----------------
router.get("/all", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select("id,title,type,youtube_video_id,file_url,order,created_at")
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json(data || []);
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
      return res.status(400).json({ error: "title and youtubeVideoId required" });
    }

    const { data, error } = await supabase
      .from("videos")
      .insert({
        title,
        type: "youtube",
        youtube_video_id: youtubeVideoId,
        order: typeof order === "number" ? order : Number(order) || 0,
      })
      .select("id,title,type,youtube_video_id,file_url,order,created_at")
      .single();

    if (error) throw error;
    return res.json({ success: true, video: data });
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

      const relativePath = path.join("uploads", "videos", req.file.filename)
        .replace(/\\/g, "/");

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const fileUrl = `${baseUrl}/${relativePath}`;

      const { data, error } = await supabase
        .from("videos")
        .insert({
          title,
          type: "file",
          file_url: fileUrl,
          order: order ? Number(order) : 0,
        })
        .select("id,title,type,youtube_video_id,file_url,order,created_at")
        .single();

      if (error) throw error;

      return res.json({ success: true, video: data });
    } catch (err) {
      console.error("Upload video error:", err);
      return res.status(500).json({ error: "Failed to upload video" });
    }
  }
);

// -----------------
// ADMIN: delete video
// Supports both paths so older frontend calls and clearer admin calls work.
// -----------------
router.delete("/all/:id", onlyAdmin, deleteVideoById);
router.delete("/:id", onlyAdmin, deleteVideoById);

// -----------------
// STUDENT: public list
// -----------------
router.get("/public", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select("id,title,type,youtube_video_id,file_url")
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const mapped = (data || []).map((v) => ({
      id: v.id,
      title: v.title,
      type: v.type,
      youtubeVideoId: v.youtube_video_id,
      fileUrl: v.file_url,
    }));

    return res.json(mapped);
  } catch (err) {
    console.error("Public videos error:", err);
    return res.status(500).json({ error: "Failed to load videos" });
  }
});

module.exports = router;
