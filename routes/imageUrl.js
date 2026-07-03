// routes/imageUrl.js
const express  = require("express");
const { supabase } = require("../supabaseClient");

const router = express.Router();

// create image url record
router.post("/create", async (req, res) => {
  try {
    const { label, url } = req.body;
    if (!label || !url) return res.status(400).send("label and url required");

    const { data, error } = await supabase
      .from("image_urls")
      .insert({ label, url })
      .select("id,label,url,created_at")
      .single();

    if (error) throw error;

    // Keep response close to old Mongoose: { _id, label, url, createdAt }
    res.json({
      _id: data.id,
      label: data.label,
      url: data.url,
      createdAt: data.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating image URL");
  }
});

// list all image urls
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("image_urls")
      .select("id,label,url,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(
      (data || []).map((d) => ({
        _id: d.id,
        label: d.label,
        url: d.url,
        createdAt: d.created_at,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching image URLs");
  }
});

module.exports = router;
