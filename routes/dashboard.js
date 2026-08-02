const express = require("express");
const { supabase } = require("../supabaseClient");
const { onlyAdmin } = require("../middleware/authRole");

const router = express.Router();

async function countRows(table, apply = (query) => query) {
  const { count, error } = await apply(
    supabase.from(table).select("id", { count: "exact", head: true })
  );
  if (error) throw error;
  return count || 0;
}

router.get("/admin", onlyAdmin, async (req, res) => {
  try {
    const [
      courses,
      students,
      enrollments,
      activeEnrollments,
      pendingEnrollments,
      videos,
      materials,
      paidRows,
      liveClass,
    ] = await Promise.all([
      countRows("courses"),
      countRows("users", (q) => q.eq("role", "student")),
      countRows("enrollments"),
      countRows("enrollments", (q) => q.eq("payment_status", "paid").eq("status", "active")),
      countRows("enrollments", (q) => q.eq("payment_status", "unpaid")),
      countRows("videos"),
      countRows("course_materials"),
      supabase.from("enrollments").select("amount").eq("payment_status", "paid"),
      supabase
        .from("live_classes")
        .select("status,internal_live_active,title")
        .eq("key", "global")
        .maybeSingle(),
    ]);

    if (paidRows.error) throw paidRows.error;
    if (liveClass.error) throw liveClass.error;

    const revenue = (paidRows.data || []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );

    res.json({
      courses,
      students,
      enrollments,
      activeEnrollments,
      pendingEnrollments,
      videos,
      materials,
      revenue,
      live: liveClass.data || null,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

module.exports = router;
