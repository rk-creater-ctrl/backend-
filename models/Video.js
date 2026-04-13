// backend/models/Video.js
const mongoose = require("mongoose");

const VideoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },

    // 'youtube' or 'file'
    type: {
      type: String,
      enum: ["youtube", "file"],
      default: "youtube",
      required: true,
    },

    // For YouTube videos
    youtubeVideoId: { type: String },

    // For uploaded files
    fileUrl: { type: String },

    // For sorting
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// NO pre('save') here – we validate in routes instead.

module.exports = mongoose.model("Video", VideoSchema);