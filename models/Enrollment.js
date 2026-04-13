// backend/models/Enrollment.js
const mongoose = require("mongoose");

const EnrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  courseId:  { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
  mode:      { type: String, enum: ["online", "offline"] },
  status: {
    type: String,
    enum: ["pending", "active", "completed"],
    default: "pending"
  },
  paymentType: {
    type: String,
    enum: ["online", "offline"]
  },
  paymentStatus: {
    type: String,
    enum: ["unpaid", "paid"],
    default: "unpaid"
  },
  amount: { type: Number, default: 0 },
  offlineDetails: {
    address:     String,
    teacherName: String,
    phone:       String,
    message:     String
  },
  onlinePayment: {
    orderId:   String,
    paymentId: String,
    signature: String
  },
  createdAt: { type: Date, default: Date.now }
});

// force collection name "enrollments"
module.exports = mongoose.model("Enrollment", EnrollmentSchema, "enrollments");
