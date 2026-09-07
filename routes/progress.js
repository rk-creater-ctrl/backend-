const express = require("express");
const { supabase } = require("../supabaseClient");

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestStudentId(req, res) {
  if (!req.user) {
    res.status(401).json({ message: "Login required" });
    return null;
  }
  if (req.user.type === "user") {
    if (String(req.params.studentId) !== String(req.user._id)) {
      res.status(403).json({ message: "Access denied" });
      return null;
    }
    return req.user._id;
  }
  if (req.user.type === "admin") return req.params.studentId;
  res.status(401).json({ message: "Login required" });
  return null;
}

async function hasActivePaidEnrollment(studentId, courseId) {
  const { data, error } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .eq("status", "active")
    .eq("payment_status", "paid")
    .or(`enrollment_expires_at.is.null,enrollment_expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function activeCourseIdsForStudent(studentId) {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("student_id", studentId)
    .eq("status", "active")
    .eq("payment_status", "paid")
    .or(`enrollment_expires_at.is.null,enrollment_expires_at.gt.${new Date().toISOString()}`);
  if (error) throw error;
  return [...new Set((data || []).map((row) => row.course_id).filter(Boolean))];
}

async function videoIdsForCourse(courseId) {
  const { data, error } = await supabase
    .from("videos")
    .select("id")
    .eq("course_id", courseId);
  if (error) throw error;
  return new Set((data || []).map((video) => String(video.id)));
}

function progressResponse(row, studentId, courseId, validVideoIds) {
  const completedVideoIds = [...new Set(row?.completed_lesson_ids || [])]
    .map(String)
    .filter((id) => validVideoIds.has(id));
  const totalCount = validVideoIds.size;
  const completedCount = completedVideoIds.length;
  return {
    studentId,
    courseId,
    completedVideoIds,
    completedLessonIds: completedVideoIds,
    completedCount,
    totalCount,
    percentage: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
    updatedAt: row?.updated_at || null,
  };
}

async function progressForCourse(studentId, courseId) {
  const [videoIds, progressResult] = await Promise.all([
    videoIdsForCourse(courseId),
    supabase
      .from("course_progress")
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (progressResult.error) throw progressResult.error;
  return progressResponse(progressResult.data, studentId, courseId, videoIds);
}

async function requireCourseAccess(req, res, studentId, courseId) {
  if (!UUID_PATTERN.test(String(courseId || ""))) {
    res.status(400).json({ message: "Invalid course ID" });
    return false;
  }
  if (req.user.type === "user" && !(await hasActivePaidEnrollment(studentId, courseId))) {
    res.status(403).json({ message: "Course access denied" });
    return false;
  }
  return true;
}

router.get("/:studentId", async (req, res) => {
  try {
    const studentId = requestStudentId(req, res);
    if (!studentId) return;
    let courseIds;
    if (req.user.type === "user") {
      courseIds = await activeCourseIdsForStudent(studentId);
    } else {
      const { data, error } = await supabase
        .from("course_progress")
        .select("course_id")
        .eq("student_id", studentId);
      if (error) throw error;
      courseIds = [...new Set((data || []).map((row) => row.course_id).filter(Boolean))];
    }
    return res.json(await Promise.all(courseIds.map((courseId) => progressForCourse(studentId, courseId))));
  } catch (err) {
    console.error("Progress list error:", err);
    return res.status(500).json({ message: "Failed to load progress" });
  }
});

router.get("/:studentId/:courseId", async (req, res) => {
  try {
    const studentId = requestStudentId(req, res);
    if (!studentId) return;
    if (!(await requireCourseAccess(req, res, studentId, req.params.courseId))) return;
    return res.json(await progressForCourse(studentId, req.params.courseId));
  } catch (err) {
    console.error("Progress load error:", err);
    return res.status(500).json({ message: "Failed to load progress" });
  }
});

router.put("/:studentId/:courseId", async (req, res) => {
  try {
    const studentId = requestStudentId(req, res);
    if (!studentId) return;
    const { courseId } = req.params;
    const videoId = String(req.body.videoId || "").trim();
    const completed = req.body.completed === true;
    if (!(await requireCourseAccess(req, res, studentId, courseId))) return;
    if (!UUID_PATTERN.test(videoId)) return res.status(400).json({ message: "videoId is required" });

    const validVideoIds = await videoIdsForCourse(courseId);
    if (!validVideoIds.has(videoId)) {
      return res.status(400).json({ message: "Video does not belong to this course" });
    }

    const { data: existing, error: selectError } = await supabase
      .from("course_progress")
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (selectError) throw selectError;

    const nextIds = new Set((existing?.completed_lesson_ids || []).map(String));
    if (completed) nextIds.add(videoId);
    else nextIds.delete(videoId);

    const { data: saved, error: saveError } = await supabase
      .from("course_progress")
      .upsert(
        { student_id: studentId, course_id: courseId, completed_lesson_ids: Array.from(nextIds) },
        { onConflict: "student_id,course_id" }
      )
      .select("student_id,course_id,completed_lesson_ids,updated_at")
      .single();
    if (saveError) throw saveError;
    return res.json(progressResponse(saved, studentId, courseId, validVideoIds));
  } catch (err) {
    console.error("Progress save error:", err);
    return res.status(500).json({ message: "Failed to save progress" });
  }
});

module.exports = router;
