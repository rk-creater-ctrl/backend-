const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { supabase } = require("../supabaseClient");
const { onlyAdmin, requireSelfOrAdmin } = require("../middleware/authRole");

const router = express.Router();
const uploadDir = path.join(__dirname, "..", "uploads", "materials");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".pdf";
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]+/g, "-");
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 50 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only PDF, image, or Word files are allowed"));
    }
    cb(null, true);
  },
});

function removeLocalFile(fileUrl) {
  if (!fileUrl) return;
  try {
    const parsed = new URL(fileUrl, "http://local");
    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    if (!relativePath.startsWith("uploads/materials/")) return;
    const resolvedPath = path.resolve(__dirname, "..", relativePath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep)) return;
    if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
  } catch (err) {
    console.error("Delete material file error:", err.message);
  }
}

async function uploadToStorage(file) {
  const bucket = process.env.SUPABASE_MATERIAL_BUCKET || "course-materials";
  const ext = path.extname(file.originalname) || ".pdf";
  const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const storagePath = `materials/${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`;
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

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return { bucket, storagePath, fileUrl: data?.publicUrl || "" };
}

async function deleteStorageObject(bucket, storagePath) {
  if (!bucket || !storagePath) return;
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) console.error("Delete material storage error:", error.message);
}

async function activeCourseIdsForStudent(studentId) {
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

router.get("/all", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("course_materials")
      .select("id,title,file_url,file_name,mime_type,course_id,order,created_at,courses(title)")
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json((data || []).map((row) => ({
      id: row.id,
      title: row.title,
      fileUrl: row.file_url,
      fileName: row.file_name,
      mimeType: row.mime_type,
      courseId: row.course_id,
      courseTitle: row.courses?.title || "",
      order: row.order,
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error("List materials error:", err);
    res.status(500).json({ error: "Failed to list materials" });
  }
});

router.post("/upload", onlyAdmin, upload.single("file"), async (req, res) => {
  try {
    const { title, courseId, order } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    let fileUrl = "";
    let storageBucket = null;
    let storagePath = null;
    try {
      const uploaded = await uploadToStorage(req.file);
      fileUrl = uploaded.fileUrl;
      storageBucket = uploaded.bucket;
      storagePath = uploaded.storagePath;
      removeLocalFile(`uploads/materials/${req.file.filename}`);
    } catch (storageError) {
      console.error("Supabase material upload failed; using local fallback:", storageError.message);
      const relativePath = path.join("uploads", "materials", req.file.filename).replace(/\\/g, "/");
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      fileUrl = `${baseUrl}/${relativePath}`;
    }

    const { data, error } = await supabase
      .from("course_materials")
      .insert({
        title,
        course_id: courseId || null,
        file_url: fileUrl,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        order: order ? Number(order) : 0,
      })
      .select("id,title,file_url,file_name,mime_type,course_id,order,created_at")
      .single();
    if (error) throw error;
    await supabase.from("notifications").insert({
      title: "New study material",
      message: title,
      type: "material",
      course_id: courseId || null,
      target_role: "student",
    }).then(({ error: notificationError }) => {
      if (notificationError) console.error("Material notification error:", notificationError.message);
    });

    res.json({ success: true, material: data });
  } catch (err) {
    if (req.file) removeLocalFile(`uploads/materials/${req.file.filename}`);
    console.error("Upload material error:", err);
    res.status(500).json({ error: "Failed to upload material" });
  }
});

router.delete("/:id", onlyAdmin, async (req, res) => {
  try {
    const { data: material, error: selError } = await supabase
      .from("course_materials")
      .select("id,file_url,storage_bucket,storage_path")
      .eq("id", req.params.id)
      .maybeSingle();
    if (selError) throw selError;
    if (!material) return res.status(404).json({ error: "Material not found" });

    if (material.storage_bucket && material.storage_path) {
      await deleteStorageObject(material.storage_bucket, material.storage_path);
    } else {
      removeLocalFile(material.file_url);
    }

    const { error } = await supabase
      .from("course_materials")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true, deletedId: material.id });
  } catch (err) {
    console.error("Delete material error:", err);
    res.status(500).json({ error: "Failed to delete material" });
  }
});

router.get("/student/:studentId", requireSelfOrAdmin(), async (req, res) => {
  try {
    const courseIds = await activeCourseIdsForStudent(req.params.studentId);
    const allowed = ["course_id.is.null"];
    if (courseIds.length) allowed.push(`course_id.in.(${courseIds.join(",")})`);

    const { data, error } = await supabase
      .from("course_materials")
      .select("id,title,file_url,file_name,mime_type,course_id,order,created_at,courses(title)")
      .or(allowed.join(","))
      .order("order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;

    res.json((data || []).map((row) => ({
      id: row.id,
      title: row.title,
      fileUrl: row.file_url,
      fileName: row.file_name,
      mimeType: row.mime_type,
      courseId: row.course_id,
      courseTitle: row.courses?.title || "",
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error("Student materials error:", err);
    res.status(500).json({ error: "Failed to load materials" });
  }
});

module.exports = router;
