// routes/course.js
const express = require("express");
const { supabase } = require("../supabaseClient");
const { onlyAdmin } = require("../middleware/authRole");

const router = express.Router();

// create course
router.post("/create", onlyAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      coverImageUrl,
      category,
      isPaid,
      price,
      modeOptions
    } = req.body;

    const { data, error } = await supabase
      .from("courses")
      .insert({
        title,
        description,
        cover_image_url: coverImageUrl,
        category,
        is_paid: Boolean(isPaid),
        price: price ? Number(price) : 0,
        mode_options_online: Boolean(modeOptions?.online ?? true),
        mode_options_offline: Boolean(modeOptions?.offline ?? false),
      })
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
    console.error(err);
    res.status(500).send("Error creating course");
  }
});

// update course
router.put("/:id", onlyAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      coverImageUrl,
      category,
      isPaid,
      price,
      modeOptions
    } = req.body;

    const { data, error } = await supabase
      .from("courses")
      .update({
        title,
        description,
        cover_image_url: coverImageUrl,
        category,
        is_paid: Boolean(isPaid),
        price: price ? Number(price) : 0,
        mode_options_online: Boolean(modeOptions?.online ?? true),
        mode_options_offline: Boolean(modeOptions?.offline ?? false),
      })
      .eq("id", req.params.id)
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .single();

    if (error) throw error;
    if (!data) return res.status(404).send("Course not found");

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
    console.error(err);
    res.status(500).send("Error updating course");
  }
});

// list courses
router.get("/list", async (req, res) => {
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
    console.error(err);
    res.status(500).send("Error fetching courses");
  }
});

// get single course
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(
        "id,title,description,cover_image_url,category,is_paid,price,mode_options_online,mode_options_offline,created_at,updated_at"
      )
      .eq("id", req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).send("Course not found");

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
    console.error(err);
    res.status(500).send("Error fetching course");
  }
});

module.exports = router;
