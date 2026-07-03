// routes/upload.js
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { onlyAdmin } = require("../middleware/authRole");

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
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + ext);
  }
});

const upload = multer({ storage });

router.post("/cover", onlyAdmin, upload.single("cover"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  const relativePath = "uploads/" + req.file.filename;
  const fullUrl = `${req.protocol}://${req.get("host")}/${relativePath}`;

  res.json({
    coverImageUrl: fullUrl,
    path: relativePath
  });
});

module.exports = router;
