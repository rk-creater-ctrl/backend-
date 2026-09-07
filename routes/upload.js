// routes/upload.js
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { onlyAdmin } = require("../middleware/authRole");

const COVER_IMAGE_TYPES = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
};

const router = express.Router();
const uploadDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    if (!COVER_IMAGE_TYPES[ext]?.includes(file.mimetype)) {
      const error = new Error("Unsupported cover image file type");
      error.code = "INVALID_FILE_TYPE";
      return cb(error);
    }
    cb(null, true);
  },
});

router.post("/cover", onlyAdmin, upload.single("cover"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  const relativePath = "uploads/" + req.file.filename;
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  const fullUrl = `${protocol}://${req.get("host")}/${relativePath}`;

  res.json({
    coverImageUrl: fullUrl,
    path: relativePath
  });
});

module.exports = router;
