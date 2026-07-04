// backend/routes/enrollment.js
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { onlyAdmin } = require("../middleware/authRole");

const enrollmentSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at,users(full_name,username),courses(title)";

function emitEnrollmentChange(req, action, enrollment) {
  req.app.get("io")?.emit("enrollment:changed", { action, enrollment });
}

function enrollmentError(res, message, err) {
  console.error(message, err);
  const detail = err?.message || message;
  res.status(500).json({ message, detail });
}

// Student creates enrollment (offline OR online placeholder)
router.post("/", async (req, res) => {
  try {
    const { studentId, courseId, mode, paymentType, offlineDetails } = req.body;

    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id,price")
      .eq("id", courseId)
      .single();

    if (cErr) throw cErr;
    if (!course) return res.status(404).send("Course not found");

    const amount = Number(course.price || 0);

    const { data: enrollment, error: eErr } = await supabase
      .from("enrollments")
      .insert({
        student_id: studentId,
        course_id: courseId,
        mode,
        payment_type: paymentType,
        payment_status: "unpaid",
        status: "pending",
        amount,
        offline_details: mode === "offline" ? offlineDetails : null,
      })
      .select(
        "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at"
      )
      .single();

    if (eErr) throw eErr;

    res.json({
      message: "Enrollment request created",
      enrollmentId: enrollment.id,
    });
    emitEnrollmentChange(req, "created", { _id: enrollment.id });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

// ADMIN: list enrollments
router.get("/all", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("enrollments")
      .select(enrollmentSelect)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Map to old-ish nested populate shape: { studentId: {..}, courseId: {title,..} }
    res.json(
      (data || []).map((row) => ({
        _id: row.id,
        studentId: row.users
          ? { fullName: row.users.full_name, username: row.users.username, _id: row.student_id }
          : row.student_id,
        courseId: row.courses
          ? { title: row.courses.title, _id: row.course_id }
          : row.course_id,
        mode: row.mode,
        paymentType: row.payment_type,
        paymentStatus: row.payment_status,
        status: row.status,
        amount: row.amount,
        offlineDetails: row.offline_details,
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    enrollmentError(res, "Failed to load enrollments", err);
  }
});

// ADMIN: mark offline as paid
router.post("/mark-paid/:id", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("enrollments")
      .update({ payment_status: "paid", status: "active" })
      .eq("id", req.params.id)
      .select("id,payment_status,status")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).send("Enrollment not found");
    emitEnrollmentChange(req, "updated", data);
    res.send("Enrollment marked as paid");
  } catch (err) {
    enrollmentError(res, "Failed to update enrollment", err);
  }
});

// ADMIN: mark as unpaid again
router.post("/mark-unpaid/:id", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("enrollments")
      .update({ payment_status: "unpaid", status: "pending" })
      .eq("id", req.params.id)
      .select("id,payment_status,status")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).send("Enrollment not found");
    emitEnrollmentChange(req, "updated", data);
    res.send("Enrollment marked as unpaid");
  } catch (err) {
    enrollmentError(res, "Failed to update enrollment", err);
  }
});

// ADMIN: delete enrollment
router.delete("/:id", onlyAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("enrollments")
      .delete()
      .eq("id", req.params.id);

    if (error) throw error;
    emitEnrollmentChange(req, "deleted", { id: req.params.id });
    res.send("Enrollment deleted");
  } catch (err) {
    enrollmentError(res, "Failed to delete enrollment", err);
  }
});

// STUDENT: my enrollments / fees
router.get("/my-fees/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at,courses(title,price,description,cover_image_url,category)"
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(
      (data || []).map((row) => ({
        _id: row.id,
        studentId: row.student_id,
        courseId: row.courses,
        mode: row.mode,
        paymentType: row.payment_type,
        paymentStatus: row.payment_status,
        status: row.status,
        amount: row.amount,
        offlineDetails: row.offline_details,
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    console.error("MY FEES ERROR:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

