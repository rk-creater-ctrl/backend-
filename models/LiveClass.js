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

    activeMode: {
      type: String,
      enum: ["youtube", "internal"],
      default: "internal",
    },
    internalLiveActive: { type: Boolean, default: false },
    internalRoomCode: { type: String },
    internalLiveStartedAt: { type: Date },
    internalLiveEndedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LiveClass", LiveClassSchema);
