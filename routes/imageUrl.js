// routes/imageUrl.js
const express  = require("express");
const ImageUrl = require("../models/ImageUrl");

const router = express.Router();

// create image url record
router.post("/create", async (req, res) => {
  try {
    const { label, url } = req.body;
    if (!label || !url) return res.status(400).send("label and url required");

    const doc = await ImageUrl.create({ label, url });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating image URL");
  }
});

// list all image urls
router.get("/list", async (req, res) => {
  try {
    const items = await ImageUrl.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching image URLs");
  }
});

module.exports = router;
