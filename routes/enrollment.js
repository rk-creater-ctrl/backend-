// backend/routes/enrollment.js
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { onlyAdmin, requireSelfOrAdmin } = require("../middleware/authRole");

const enrollmentSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,student_address,aadhar_number,mobile_number,enrollment_expires_at,offline_address,offline_teacher_name,offline_phone,offline_message,created_at,users(full_name,username),courses(title)";
const legacyEnrollmentSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,offline_address,offline_teacher_name,offline_phone,offline_message,created_at,users(full_name,username),courses(title)";
const safeEnrollmentSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at";
const myFeesSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,student_address,aadhar_number,mobile_number,enrollment_expires_at,created_at,courses(title,price,description,cover_image_url,category)";
const legacyMyFeesSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at,courses(title,price,description,cover_image_url,category)";
const safeMyFeesSelect =
  "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (id) => UUID_PATTERN.test(String(id || ""));

function emitEnrollmentChange(req, action, enrollment) {
  req.app.get("io")?.emit("enrollment:changed", { action, enrollment });
}

function enrollmentError(res, message, err) {
  console.error(message, err);
  const payload = { message };
  if (process.env.NODE_ENV !== "production") payload.detail = err?.message || message;
  res.status(500).json(payload);
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildRegistrationDetails(offlineDetails = {}) {
  const address = String(
    offlineDetails.studentAddress || offlineDetails.address || ""
  ).trim();
  const aadharNumber = cleanDigits(
    offlineDetails.aadharNumber || offlineDetails.aadhaarNumber
  );
  const mobileNumber = cleanDigits(
    offlineDetails.mobileNumber || offlineDetails.phone
  );
  const teacherName = String(offlineDetails.teacherName || "").trim();
  const message = String(offlineDetails.message || "").trim();

  return { address, aadharNumber, mobileNumber, teacherName, message };
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

async function selectEnrollmentsWithFallback(selectClause, fallbackClause, applyQuery) {
  let query = supabase.from("enrollments").select(selectClause);
  query = applyQuery(query);
  const result = await query;
  if (!result.error || !isMissingColumnError(result.error)) return result;

  console.warn("Enrollment query used legacy fallback:", result.error.message);
  let fallbackQuery = supabase.from("enrollments").select(fallbackClause);
  fallbackQuery = applyQuery(fallbackQuery);
  return fallbackQuery;
}

async function fetchUsersByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase
    .from("users")
    .select("id,full_name,username")
    .in("id", uniqueIds);

  if (error) {
    console.error("Enrollment user lookup fallback failed:", error.message);
    return new Map();
  }

  return new Map((data || []).map((user) => [user.id, user]));
}

async function fetchCoursesByIds(ids = [], courseSelect = "id,title") {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase
    .from("courses")
    .select(courseSelect)
    .in("id", uniqueIds);

  if (error) {
    console.error("Enrollment course lookup fallback failed:", error.message);
    return new Map();
  }

  return new Map((data || []).map((course) => [course.id, course]));
}

// Student creates enrollment (offline OR online placeholder)
router.post("/", requireSelfOrAdmin(), async (req, res) => {
  try {
    const { studentId, courseId, mode, paymentType, offlineDetails } = req.body;
    if (!validId(studentId) || !validId(courseId)) {
      return res.status(400).send("Invalid student or course ID");
    }
    if (!["online", "offline"].includes(mode) || !["online", "offline"].includes(paymentType)) {
      return res.status(400).send("Invalid enrollment mode or payment type");
    }
    if (!offlineDetails || typeof offlineDetails !== "object" || Array.isArray(offlineDetails)) {
      return res.status(400).send("Student registration details are required");
    }

    const registrationDetails = buildRegistrationDetails(offlineDetails);
    if (
      !registrationDetails.address ||
      registrationDetails.aadharNumber.length !== 12 ||
      registrationDetails.mobileNumber.length !== 10
    ) {
      return res
        .status(400)
        .send("Address, 12-digit Aadhaar number and 10-digit mobile number are required");
    }

    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id,price")
      .eq("id", courseId)
      .maybeSingle();

    if (cErr) throw cErr;
    if (!course) return res.status(404).send("Course not found");

    const { data: existing, error: existingError } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.status(409).send("Already enrolled in this course");

    const amount = Number(course.price || 0);

    const insertPayload = {
        student_id: studentId,
        course_id: courseId,
        mode,
        payment_type: paymentType,
        payment_status: "unpaid",
        status: "pending",
        amount,
        offline_details: {
          ...offlineDetails,
          address: registrationDetails.address,
          studentAddress: registrationDetails.address,
          aadharNumber: registrationDetails.aadharNumber,
          mobileNumber: registrationDetails.mobileNumber,
          phone: registrationDetails.mobileNumber,
          teacherName: registrationDetails.teacherName,
          message: registrationDetails.message,
        },
        student_address: registrationDetails.address,
        aadhar_number: registrationDetails.aadharNumber,
        mobile_number: registrationDetails.mobileNumber,
        offline_address: registrationDetails.address,
        offline_teacher_name: registrationDetails.teacherName || null,
        offline_phone: registrationDetails.mobileNumber,
        offline_message: registrationDetails.message || null,
      };

    let { data: enrollment, error: eErr } = await supabase
      .from("enrollments")
      .insert(insertPayload)
      .select(
        "id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,student_address,aadhar_number,mobile_number,created_at"
      )
      .single();

    if (eErr && isMissingColumnError(eErr)) {
      console.warn("Enrollment insert used legacy fallback:", eErr.message);
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.student_address;
      delete legacyPayload.aadhar_number;
      delete legacyPayload.mobile_number;
      const legacyResult = await supabase
        .from("enrollments")
        .insert(legacyPayload)
        .select("id,student_id,course_id,mode,payment_type,payment_status,status,amount,offline_details,created_at")
        .single();
      enrollment = legacyResult.data;
      eErr = legacyResult.error;
    }

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
    let { data, error } = await selectEnrollmentsWithFallback(
      enrollmentSelect,
      legacyEnrollmentSelect,
      (query) => query.order("created_at", { ascending: false })
    );

    if (error) {
      console.warn("Enrollment list used safe fallback:", error.message);
      const safeResult = await supabase
        .from("enrollments")
        .select(safeEnrollmentSelect)
        .order("created_at", { ascending: false });
      data = safeResult.data;
      error = safeResult.error;
    }

    if (error) throw error;

    const usersById = await fetchUsersByIds((data || []).map((row) => row.student_id));
    const coursesById = await fetchCoursesByIds((data || []).map((row) => row.course_id));

    // Map to old-ish nested populate shape: { studentId: {..}, courseId: {title,..} }
    res.json(
      (data || []).map((row) => ({
        _id: row.id,
        studentId: row.users || usersById.get(row.student_id)
          ? {
              fullName: (row.users || usersById.get(row.student_id))?.full_name,
              username: (row.users || usersById.get(row.student_id))?.username,
              _id: row.student_id,
            }
          : row.student_id,
        courseId: row.courses || coursesById.get(row.course_id)
          ? { title: (row.courses || coursesById.get(row.course_id))?.title, _id: row.course_id }
          : row.course_id,
        mode: row.mode,
        paymentType: row.payment_type,
        paymentStatus: row.payment_status,
        status: row.status,
        amount: row.amount,
        offlineDetails: row.offline_details,
        expiresAt: row.enrollment_expires_at,
        registrationDetails: {
          address: row.student_address || row.offline_address || row.offline_details?.studentAddress || row.offline_details?.address || "",
          aadharNumber: row.aadhar_number || row.offline_details?.aadharNumber || row.offline_details?.aadhaarNumber || "",
          mobileNumber: row.mobile_number || row.offline_phone || row.offline_details?.mobileNumber || row.offline_details?.phone || "",
          teacherName: row.offline_teacher_name || row.offline_details?.teacherName || "",
          message: row.offline_message || row.offline_details?.message || "",
        },
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
    if (!validId(req.params.id)) return res.status(400).send("Invalid enrollment ID");
    const expiresAt = req.body?.expiresAt || null;
    const updatePayload = {
        payment_status: "paid",
        status: "active",
        enrollment_expires_at: expiresAt,
      };
    let { data, error } = await supabase
      .from("enrollments")
      .update(updatePayload)
      .eq("id", req.params.id)
      .select("id,payment_status,status,student_id,course_id,enrollment_expires_at,courses(title)")
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      console.warn("Mark-paid used legacy fallback:", error.message);
      const legacyResult = await supabase
        .from("enrollments")
        .update({ payment_status: "paid", status: "active" })
        .eq("id", req.params.id)
        .select("id,payment_status,status,student_id,course_id,courses(title)")
        .maybeSingle();
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) throw error;
    if (!data) return res.status(404).send("Enrollment not found");
    await supabase
      .from("notifications")
      .insert({
        title: "Enrollment approved",
        message: `Your access for ${data.courses?.title || "a course"} is now active.`,
        type: "enrollment",
        course_id: data.course_id,
        target_role: "student",
      })
      .then(({ error: notificationError }) => {
        if (notificationError) {
          console.error("Enrollment notification error:", notificationError.message);
        }
      });
    emitEnrollmentChange(req, "updated", data);
    res.send("Enrollment marked as paid");
  } catch (err) {
    enrollmentError(res, "Failed to update enrollment", err);
  }
});

// ADMIN: mark as unpaid again
router.post("/mark-unpaid/:id", onlyAdmin, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).send("Invalid enrollment ID");
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
    if (!validId(req.params.id)) return res.status(400).send("Invalid enrollment ID");
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
router.get("/my-fees/:studentId", requireSelfOrAdmin(), async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!validId(studentId)) return res.status(400).send("Invalid student ID");

    let { data, error } = await selectEnrollmentsWithFallback(
      myFeesSelect,
      legacyMyFeesSelect,
      (query) => query.eq("student_id", studentId).order("created_at", { ascending: false })
    );

    if (error) {
      console.warn("My fees used safe fallback:", error.message);
      const safeResult = await supabase
        .from("enrollments")
        .select(safeMyFeesSelect)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      data = safeResult.data;
      error = safeResult.error;
    }

    if (error) throw error;

    const coursesById = await fetchCoursesByIds(
      (data || []).map((row) => row.course_id),
      "id,title,price,description,cover_image_url,category"
    );

    res.json(
      (data || []).map((row) => ({
        _id: row.id,
        studentId: row.student_id,
        courseId: row.courses || coursesById.get(row.course_id) || row.course_id,
        mode: row.mode,
        paymentType: row.payment_type,
        paymentStatus: row.payment_status,
        status: row.status,
        amount: row.amount,
        offlineDetails: row.offline_details,
        expiresAt: row.enrollment_expires_at,
        registrationDetails: {
          address: row.student_address || row.offline_details?.studentAddress || row.offline_details?.address || "",
          aadharNumber: row.aadhar_number || row.offline_details?.aadharNumber || row.offline_details?.aadhaarNumber || "",
          mobileNumber: row.mobile_number || row.offline_details?.mobileNumber || row.offline_details?.phone || "",
        },
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    console.error("MY FEES ERROR:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

