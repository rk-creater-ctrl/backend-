// backend/routes/auth.js

const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const router  = express.Router();

const User  = require("../models/User");
const Admin = require("../models/Admin");
const { onlyAdmin } = require("../middleware/authRole");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";

/* ------------------ Normal user register & login ------------------ */

// students/teachers register themselves
router.post("/register", async (req, res) => {
  try {
    const { fullName, username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).send("Username already exists");

    const hash = await bcrypt.hash(password, 10);

    const user = new User({
      fullName: fullName || username,
      username,
      passwordHash: hash,
      role: role === "teacher" ? "teacher" : "student"
    });

    await user.save();
    res.json({ message: "Registered" });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

// students/teachers login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(400).send("Invalid credentials");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).send("Invalid credentials");

    const token = jwt.sign(
      { _id: user._id, type: "user", role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        role: user.role
      }
    });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

/* ------------------------- Admin login only ------------------------ */

router.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("Admin login body:", req.body);

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const admin = await Admin.findOne({ username });
    console.log("Admin found:", admin);

    if (!admin) return res.status(400).send("Invalid credentials");

    const ok = await bcrypt.compare(password, admin.passwordHash);
    console.log("Password match result:", ok);

    if (!ok) return res.status(400).send("Invalid credentials");

    const token = jwt.sign(
      { _id: admin._id, type: "admin" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      admin: {
        _id: admin._id,
        fullName: admin.fullName,
        username: admin.username
      }
    });
  } catch (e) {
    console.error("Admin login error:", e);
    res.status(400).send("Error: " + e.message);
  }
});


/* --------------- Admin: create user accounts (benefit) -------------- */

router.post("/admin/create-user", onlyAdmin, async (req, res) => {
  try {
    const { fullName, username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).send("Username already exists");

    const hash = await bcrypt.hash(password, 10);

    const user = new User({
      fullName: fullName || username,
      username,
      passwordHash: hash,
      role: role === "teacher" ? "teacher" : "student"
    });

    await user.save();
    res.json({ message: "User created" });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

module.exports = router;
