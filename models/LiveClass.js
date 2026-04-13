const mongoose = require("mongoose");

const LiveClassSchema = new mongoose.Schema(
  {
    // Single global live class document
    key: { type: String, default: "global", unique: true },

    title: { type: String, required: true }, // heading entered by teacher
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },
    scheduledAt: { type: Date },

    // YouTube id (kept hidden from students)
    youtubeVideoId: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LiveClass", LiveClassSchema);