const express = require("express");
const { supabase } = require("../supabaseClient");
const { onlyAdmin, requireSelfOrAdmin } = require("../middleware/authRole");

const router = express.Router();

async function activeCourseIdsForStudent(studentId) {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("student_id", studentId)
    .eq("payment_status", "paid")
    .eq("status", "active")
    .or(`enrollment_expires_at.is.null,enrollment_expires_at.gt.${new Date().toISOString()}`);
  if (error) throw error;
  return (data || []).map((row) => row.course_id).filter(Boolean);
}

router.get("/all", onlyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id,title,message,type,course_id,created_at,courses(title)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json((data || []).map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      courseId: row.course_id,
      courseTitle: row.courses?.title || "",
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

router.post("/all", onlyAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const message = String(req.body.message || "").trim();
    const type = String(req.body.type || "general").trim();
    const courseId = req.body.courseId || null;
    if (!title) return res.status(400).json({ error: "title is required" });

    const { data, error } = await supabase
      .from("notifications")
      .insert({
        title,
        message,
        type,
        course_id: courseId,
        target_role: "student",
      })
      .select("id,title,message,type,course_id,created_at")
      .single();
    if (error) throw error;
    req.app.get("io")?.emit("notification:created", data);
    res.json({ success: true, notification: data });
  } catch (err) {
    console.error("Create notification error:", err);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

router.post("/device-token", requireSelfOrAdmin("userId"), async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const platform = String(req.body.platform || "").trim();
    const userId = req.body.userId;
    if (!token || !userId) return res.status(400).json({ error: "token and userId are required" });

    const { error } = await supabase
      .from("device_tokens")
      .upsert({ user_id: userId, token, platform }, { onConflict: "token" });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Device token save error:", err);
    res.status(500).json({ error: "Failed to save device token" });
  }
});

router.get("/student/:studentId", requireSelfOrAdmin(), async (req, res) => {
  try {
    const courseIds = await activeCourseIdsForStudent(req.params.studentId);
    const allowed = ["course_id.is.null"];
    if (courseIds.length) allowed.push(`course_id.in.(${courseIds.join(",")})`);

    const { data, error } = await supabase
      .from("notifications")
      .select("id,title,message,type,course_id,created_at,courses(title)")
      .or(allowed.join(","))
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;

    res.json((data || []).map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      courseId: row.course_id,
      courseTitle: row.courses?.title || "",
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error("Student notifications error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

module.exports = router;
