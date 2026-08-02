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
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) return cb(new Error("Only video files are allowed"));
    cb(null, true);
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

function safeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function publicUrlFor(bucket, storagePath) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data?.publicUrl || "";
}

async function uploadFileToSupabaseStorage(file, folder, bucketName) {
  const bucket = bucketName || process.env.SUPABASE_VIDEO_BUCKET || "course-videos";
  const ext = path.extname(file.originalname) || ".mp4";
  const name = safeFileName(path.basename(file.originalname, ext));
  const storagePath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${name}${ext}`;
  const buffer = fs.readFileSync(file.path);

  await supabase.storage.createBucket(bucket, { public: true }).catch((err) => {
    const message = String(err?.message || "").toLowerCase();
    if (!message.includes("already exists")) throw err;
  });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) throw error;

  return {
    bucket,
    storagePath,
    fileUrl: publicUrlFor(bucket, storagePath),
  };
}

async function deleteStorageObject(bucket, storagePath) {
  if (!bucket || !storagePath) return;
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) console.error("Delete storage object error:", error.message);
}

async function activeCourseIdsForStudent(studentId) {
  if (!studentId) return [];
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("student_id", studentId)
    .eq("payment_status", "paid")
    .eq("status", "active")
    .or(`enrollment_expires_at.is.null,enrollment_expires_at.gt.${new Date().toISOString()}`);
  if (error) throw error;
  return (data || []).map((row) => row.course_id).filter(Boolean);
}

function extractYouTubeVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const directId = raw.match(/^[a-zA-Z0-9_-]{11}$/);
  if (directId) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (url.searchParams.get("v")) {
      return url.searchParams.get("v") || "";
    }
    const embedMatch = url.pathname.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
  } catch {
    // raw was not a URL; try common pasted fragments below
  }

  const looseMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
  return looseMatch?.[1] || raw;
}

async function deleteVideoById(req, res) {
  try {
    const { data: video, error: selError } = await supabase
      .from("videos")
      .select("id,type,file_url,storage_bucket,storage_path")
      .eq("id", req.params.id)
      .maybeSingle();

    if (selError) throw selError;
    if (!video) return res.status(404).json({ error: "Video not found" });

    if (video.type === "file") {
      if (video.storage_bucket && video.storage_path) {
        await deleteStorageObject(video.storage_bucket, video.storage_path);
      } else {
        removeLocalVideoFile(video.file_url);
      }
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
      .select("id,title,type,youtube_video_id,file_url,course_id,storage_bucket,storage_path,order,created_at,courses(title)")
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json((data || []).map((v) => ({
      id: v.id,
      title: v.title,
      type: v.type,
      youtubeVideoId: v.youtube_video_id,
      fileUrl: v.file_url,
      courseId: v.course_id,
      courseTitle: v.courses?.title || "",
      storageBucket: v.storage_bucket,
      storagePath: v.storage_path,
      order: v.order,
      createdAt: v.created_at,
    })));
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
    const { title, youtubeVideoId, order, courseId } = req.body;
    const cleanYouTubeVideoId = extractYouTubeVideoId(youtubeVideoId);

    if (!title || !cleanYouTubeVideoId) {
      return res.status(400).json({ error: "title and youtubeVideoId required" });
    }

    const { data, error } = await supabase
      .from("videos")
      .insert({
        title,
        course_id: courseId || null,
        type: "youtube",
        youtube_video_id: cleanYouTubeVideoId,
        order: typeof order === "number" ? order : Number(order) || 0,
      })
      .select("id,title,type,youtube_video_id,file_url,course_id,order,created_at")
      .single();

    if (error) throw error;
    await supabase.from("notifications").insert({
      title: "New video added",
      message: title,
      type: "video",
      course_id: courseId || null,
      target_role: "student",
    }).then(({ error: notificationError }) => {
      if (notificationError) console.error("Video notification error:", notificationError.message);
    });
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
      const { title, order, courseId } = req.body;

      if (!title) {
        return res.status(400).json({ error: "title is required" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "video file is required" });
      }

      let fileUrl = "";
      let storageBucket = null;
      let storagePath = null;
      try {
        const uploaded = await uploadFileToSupabaseStorage(req.file, "videos");
        fileUrl = uploaded.fileUrl;
        storageBucket = uploaded.bucket;
        storagePath = uploaded.storagePath;
        removeLocalVideoFile(`uploads/videos/${req.file.filename}`);
      } catch (storageError) {
        console.error("Supabase video upload failed; using local fallback:", storageError.message);
        const relativePath = path.join("uploads", "videos", req.file.filename)
          .replace(/\\/g, "/");
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
        fileUrl = `${baseUrl}/${relativePath}`;
      }

      const { data, error } = await supabase
        .from("videos")
        .insert({
          title,
          course_id: courseId || null,
          type: "file",
          file_url: fileUrl,
          storage_bucket: storageBucket,
          storage_path: storagePath,
          order: order ? Number(order) : 0,
        })
        .select("id,title,type,youtube_video_id,file_url,course_id,storage_bucket,storage_path,order,created_at")
        .single();

      if (error) throw error;
      await supabase.from("notifications").insert({
        title: "New video uploaded",
        message: title,
        type: "video",
        course_id: courseId || null,
        target_role: "student",
      }).then(({ error: notificationError }) => {
        if (notificationError) console.error("Video upload notification error:", notificationError.message);
      });

      return res.json({ success: true, video: data });
    } catch (err) {
      if (req.file) removeLocalVideoFile(`uploads/videos/${req.file.filename}`);
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
    const studentId = req.query.studentId;
    const courseIds = await activeCourseIdsForStudent(studentId);

    let query = supabase
      .from("videos")
      .select("id,title,type,youtube_video_id,file_url,course_id,courses(title)")
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });

    if (studentId) {
      const allowed = ["course_id.is.null"];
      if (courseIds.length) allowed.push(`course_id.in.(${courseIds.join(",")})`);
      query = query.or(allowed.join(","));
    } else {
      query = query.is("course_id", null);
    }

    const { data, error } = await query;

    if (error) throw error;

    const mapped = (data || []).map((v) => ({
      id: v.id,
      title: v.title,
      type: v.type,
      youtubeVideoId: extractYouTubeVideoId(v.youtube_video_id),
      fileUrl: v.file_url,
      courseId: v.course_id,
      courseTitle: v.courses?.title || "",
    }));

    return res.json(mapped);
  } catch (err) {
    console.error("Public videos error:", err);
    return res.status(500).json({ error: "Failed to load videos" });
  }
});

module.exports = router;
