// routes/course.js
const express = require("express");
const Course  = require("../models/Course");

const router = express.Router();

// create course
router.post("/create", async (req, res) => {
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

    const course = await Course.create({
      title,
      description,
      coverImageUrl,
      category,
      isPaid,
      price,
      modeOptions
    });

    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating course");
  }
});

// update course
router.put("/:id", async (req, res) => {
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

    const course = await Course.findByIdAndUpdate(
      req.params.id,
      {
        title,
        description,
        coverImageUrl,
        category,
        isPaid,
        price,
        modeOptions
      },
      { new: true }
    );

    if (!course) return res.status(404).send("Course not found");
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating course");
  }
});

// list courses
router.get("/list", async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching courses");
  }
});

// get single course
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).send("Course not found");
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching course");
  }
});

module.exports = router;
