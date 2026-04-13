// models/ImageUrl.js
const mongoose = require("mongoose");

const imageUrlSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    url:   { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ImageUrl", imageUrlSchema);
