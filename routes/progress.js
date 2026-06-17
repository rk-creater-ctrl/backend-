const express = require("express");
const { supabase } = require("../supabaseClient");

const router = express.Router();

function canAccessStudent(req, studentId) {
  return (
    req.user &&
    ((req.user.type === "user" && String(req.user._id) === String(studentId)) ||
      req.user.type === "admin")
  );
}

function progressResponse(row) {
  return {
    studentId: row.student_id,
    courseId: row.course_id,
    completedLessonIds: row.completed_lesson_ids || [],
    updatedAt: row.updated_at,
  };
}

router.get("/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!canAccessStudent(req, studentId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { data, error } = await supabase
      .from("course_progress")
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .eq("student_id", studentId);

    if (error) throw error;

    res.json((data || []).map(progressResponse));
  } catch (err) {
    console.error("Progress list error:", err);
    res.status(500).json({ message: "Failed to load progress" });
  }
});

router.get("/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;
    if (!canAccessStudent(req, studentId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { data, error } = await supabase
      .from("course_progress")
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.json({
        studentId,
        courseId,
        completedLessonIds: [],
        updatedAt: null,
      });
    }

    res.json(progressResponse(data));
  } catch (err) {
    console.error("Progress load error:", err);
    res.status(500).json({ message: "Failed to load progress" });
  }
});

router.put("/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;
    const lessonId = String(req.body.lessonId || "").trim();
    const completed = req.body.completed === true;

    if (!canAccessStudent(req, studentId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!lessonId) {
      return res.status(400).json({ message: "lessonId is required" });
    }

    // Fetch current row (or default)
    const { data: existing, error: selErr } = await supabase
      .from("course_progress")
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .maybeSingle();

    if (selErr) throw selErr;

    const current = existing?.completed_lesson_ids || [];
    const set = new Set(current);
    if (completed) set.add(lessonId);
    else set.delete(lessonId);

    const nextIds = Array.from(set);

    // Upsert by unique(student_id,course_id)
    const { data: upserted, error: upErr } = await supabase
      .from("course_progress")
      .upsert(
        {
          student_id: studentId,
          course_id: courseId,
          completed_lesson_ids: nextIds,
        },
        // Prefer conflict target columns to avoid needing the exact constraint name
        { onConflict: "(student_id,course_id)" }
      )
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .single();

    if (upErr) throw upErr;

    res.json(progressResponse(upserted));
  } catch (err) {
    console.error("Progress save error:", err);
    res.status(500).json({ message: "Failed to save progress" });
  }
});

module.exports = router;

