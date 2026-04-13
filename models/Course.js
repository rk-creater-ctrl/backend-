// models/Course.js
const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    title:         { type: String, required: true },
    description:   { type: String },
    coverImageUrl: { type: String },        // store full URL or relative path
    category:      { type: String },
    isPaid:        { type: Boolean, default: false },
    price:         { type: Number, default: 0 },
    modeOptions: {
      online:  { type: Boolean, default: true },
      offline: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", courseSchema);
