// backend/routes/user.js
const express = require("express");
const User    = require("../models/User"); // adjust name if different

const router = express.Router();

// GET /user/list - all students
router.get("/list", async (req, res) => {
  try {
    const students = await User.find().sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching students");
  }
});

// POST /user - create student
router.post("/", async (req, res) => {
  try {
    const student = await User.create(req.body);
    res.json(student);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating student");
  }
});

// PUT /user/:id - update student
router.put("/:id", async (req, res) => {
  try {
    const student = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!student) return res.status(404).send("Student not found");
    res.json(student);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating student");
  }
});

// DELETE /user/:id - delete student
router.delete("/:id", async (req, res) => {
  try {
    const student = await User.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).send("Student not found");
    res.send("Deleted");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting student");
  }
});

module.exports = router;
