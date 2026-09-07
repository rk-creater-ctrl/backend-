// routes/course.js
const express = require("express");
const { supabase } = require("../supabaseClient");
const { onlyAdmin } = require("../middleware/authRole");

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function courseValues(body) {
  const title = String(body.title || "").trim();
  const price = body.isPaid ? Number(body.price) : 0;
  if (!title) throw Object.assign(new Error("Course title is required"), { status: 400, expose: true });
  if (!Number.isFinite(price) || price < 0) {
    throw Object.assign(new Error("Course price must be a non-negative number"), { status: 400, expose: true });
  }
  return {
    title,
    description: String(body.description || "").trim(),
    cover_image_url: String(body.coverImageUrl || "").trim(),
    category: String(body.category || "").trim(),
    is_paid: Boolean(body.isPaid),
    price,
    mode_options_online: Boolean(body.modeOptions?.online ?? true),
    mode_options_offline: Boolean(body.modeOptions?.offline ?? false),
  };
}

const validId = (id) => UUID_PATTERN.test(String(id || ""));

// create course
router.post("/create", onlyAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .insert(courseValues(req.body))
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .single();

    if (error) throw error;

    res.json({
      _id: data.id,
      title: data.title,
      description: data.description,
      coverImageUrl: data.cover_image_url,
      category: data.category,
      isPaid: data.is_paid,
      price: Number(data.price),
      modeOptions: {
        online: data.mode_options_online,
        offline: data.mode_options_offline,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    if (err.status === 400 && err.expose) return res.status(400).json({ message: err.message });
    return next(err);
  }
});

// update course
router.put("/:id", onlyAdmin, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid course ID" });

    const { data, error } = await supabase
      .from("courses")
      .update(courseValues(req.body))
      .eq("id", req.params.id)
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Course not found" });

    res.json({
      _id: data.id,
      title: data.title,
      description: data.description,
      coverImageUrl: data.cover_image_url,
      category: data.category,
      isPaid: data.is_paid,
      price: Number(data.price),
      modeOptions: {
        online: data.mode_options_online,
        offline: data.mode_options_offline,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    if (err.status === 400 && err.expose) return res.status(400).json({ message: err.message });
    return next(err);
  }
});

// list courses
router.get("/list", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    // map to existing API response shape
    const mapped = (data || []).map((c) => ({
      _id: c.id,
      title: c.title,
      description: c.description,
      coverImageUrl: c.cover_image_url,
      category: c.category,
      isPaid: c.is_paid,
      price: Number(c.price),
      modeOptions: {
        online: c.mode_options_online,
        offline: c.mode_options_offline,
      },
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));

    res.json(mapped);
  } catch (err) {
    return next(err);
  }
});

// get single course
router.get("/:id", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid course ID" });
    const { data, error } = await supabase
      .from("courses")
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Course not found" });

    res.json({
      _id: data.id,
      title: data.title,
      description: data.description,
      coverImageUrl: data.cover_image_url,
      category: data.category,
      isPaid: data.is_paid,
      price: Number(data.price),
      modeOptions: {
        online: data.mode_options_online,
        offline: data.mode_options_offline,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", onlyAdmin, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid course ID" });
    const { data, error } = await supabase
      .from("courses")
      .delete()
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    res.json({
      success: true,
      deletedId: data?.id || req.params.id,
      alreadyDeleted: !data,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
