// backend/routes/enrollment.js
const express    = require("express");
const router     = express.Router();
const Enrollment = require("../models/Enrollment");
const Course     = require("../models/Course");
const { onlyAdmin } = require("../middleware/authRole");


// Student creates enrollment (offline OR online placeholder)
router.post("/", async (req, res) => {
  try {
    const { studentId, courseId, mode, paymentType, offlineDetails } = req.body;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).send("Course not found");

    const enrollment = new Enrollment({
      studentId,
      courseId,
      mode,
      paymentType,
      paymentStatus: "unpaid",
      amount: course.price || 0,
      offlineDetails: mode === "offline" ? offlineDetails : undefined,
    });

    await enrollment.save();

    // if paymentType === "online", here you will:
    // 1) create Razorpay/Stripe order,
    // 2) send order details back to frontend.
    res.json({
      message: "Enrollment request created",
      enrollmentId: enrollment._id,
    });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

// ADMIN: list enrollments
router.get("/all", onlyAdmin, async (req, res) => {
  const enrollments = await Enrollment.find()
    .populate("studentId", "fullName username")
    .populate("courseId", "title");
  res.json(enrollments);
});

// ADMIN: mark offline as paid
router.post("/mark-paid/:id", onlyAdmin, async (req, res) => {
  const id = req.params.id;
  const enrollment = await Enrollment.findById(id);
  if (!enrollment) return res.status(404).send("Enrollment not found");

  enrollment.paymentStatus = "paid";
  enrollment.status        = "active";
  await enrollment.save();
  res.send("Enrollment marked as paid");
});

// ADMIN: mark as unpaid again
router.post("/mark-unpaid/:id", onlyAdmin, async (req, res) => {
  const id = req.params.id;
  const enrollment = await Enrollment.findById(id);
  if (!enrollment) return res.status(404).send("Enrollment not found");

  enrollment.paymentStatus = "unpaid";
  enrollment.status        = "pending";
  await enrollment.save();
  res.send("Enrollment marked as unpaid");
});

// ADMIN: delete enrollment
router.delete("/:id", onlyAdmin, async (req, res) => {
  const id = req.params.id;
  const enrollment = await Enrollment.findByIdAndDelete(id);
  if (!enrollment) return res.status(404).send("Enrollment not found");
  res.send("Enrollment deleted");
});

// STUDENT: my enrollments / fees
router.get("/my-fees/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const enrollments = await Enrollment.find({ studentId })
      .populate("courseId", "title price") // so app can show title & price
      .lean();

    return res.json(enrollments); // plain array
  } catch (err) {
    console.error("MY FEES ERROR:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
