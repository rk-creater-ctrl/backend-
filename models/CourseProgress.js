const mongoose = require("mongoose");

const CourseProgressSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    completedLessonIds: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

CourseProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model(
  "CourseProgress",
  CourseProgressSchema,
  "courseprogress"
);
