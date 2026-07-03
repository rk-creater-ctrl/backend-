// backend/routes/auth.js

const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const router  = express.Router();

const { supabase } = require("../supabaseClient");
const { onlyAdmin, getAdminLevel } = require("../middleware/authRole");


const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";

function cleanUsername(username) {
  return String(username || "").trim();
}

function toUserResponse(user) {
  return {
    _id: user._id,
    fullName: user.fullName,
    username: user.username,
    role: user.role || "student",
  };
}

function toAdminResponse(admin) {
  return {
    _id: admin._id,
    fullName: admin.fullName,
    username: admin.username,
    level: getAdminLevel(admin),
  };
}

function signUser(user) {
  return jwt.sign(
    { _id: user._id, type: "user", role: user.role || "student" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function signAdmin(admin) {
  return jwt.sign(
    { _id: admin._id, type: "admin", level: getAdminLevel(admin) },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function usernameExists(username) {
  const { data: u, error: uErr } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  const { data: a, error: aErr } = await supabase
    .from('admins')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (uErr || aErr) throw uErr || aErr;
  return Boolean(u || a);
}


function requireUser(req, res, next) {
  if (!req.user || req.user.type !== "user") {
    return res.status(401).send("Login required");
  }
  next();
}

async function findLinkedAdmin(user) {
  if (!user) return null;

  const { data: byUser } = await supabase
    .from('admins')
    .select('id, full_name, username, level, password_hash, created_from_user, created_by')
    .eq('created_from_user', user._id)
    .maybeSingle();

  if (byUser) {
    return {
      _id: byUser.id,
      fullName: byUser.full_name,
      username: byUser.username,
      level: byUser.level,
      passwordHash: byUser.password_hash,
      createdFromUser: byUser.created_from_user,
      createdBy: byUser.created_by,
    };
  }

  const { data: byUsername } = await supabase
    .from('admins')
    .select('id, full_name, username, level, password_hash, created_from_user, created_by')
    .eq('username', user.username)
    .maybeSingle();

  if (!byUsername) return null;

  return {
    _id: byUsername.id,
    fullName: byUsername.full_name,
    username: byUsername.username,
    level: byUsername.level,
    passwordHash: byUsername.password_hash,
    createdFromUser: byUsername.created_from_user,
    createdBy: byUsername.created_by,
  };
}

async function usernameAvailableForUser(username, user, linkedAdmin) {
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .neq('id', user._id)
    .maybeSingle();

  if (existingUser) return false;

  let q = supabase
    .from('admins')
    .select('id')
    .eq('username', username);

  if (linkedAdmin) q = q.neq('id', linkedAdmin._id);

  const { data: existingAdmin } = await q.maybeSingle();

  return !existingAdmin;
}


/* ------------------ Normal user register & login ------------------ */

// Public registration. Every self-registered account starts as a student.
router.post("/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const fullName = String(req.body.fullName || username).trim();
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    if (await usernameExists(username)) {
      return res.status(400).send("Username already exists");
    }

    const hash = await bcrypt.hash(password, 10);

    const { data: inserted, error } = await supabase
      .from('users')
      .insert({
        full_name: fullName || username,
        username,
        password_hash: hash,
        role: 'student',
      })
      .select('id, full_name, username, role')
      .single();

    if (error || !inserted) {
      throw error || new Error('Failed to create user');
    }

    const user = {
      _id: inserted.id,
      fullName: inserted.full_name,
      username: inserted.username,
      role: inserted.role,
    };

    res.json({
      message: "Registered",
      token: signUser(user),
      user: toUserResponse(user),
    });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});


// students/admin-users login to the student app
router.post("/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, password_hash, role')
      .eq('username', username)
      .single();

    if (error || !userRow) return res.status(400).send("Invalid credentials");

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) return res.status(400).send("Invalid credentials");

    const user = {
      _id: userRow.id,
      fullName: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
    };

    res.json({
      token: signUser(user),
      user: toUserResponse(user),
    });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});


router.get("/me", requireUser, async (req, res) => {
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, role')
      .eq('id', req.user._id)
      .single();

    if (error || !userRow) return res.status(404).send("User not found");

    const user = {
      _id: userRow.id,
      fullName: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
    };

    res.json({ user: toUserResponse(user) });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});


router.put("/me", requireUser, async (req, res) => {
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, role')
      .eq('id', req.user._id)
      .single();

    if (error || !userRow) return res.status(404).send("User not found");

    const user = {
      _id: userRow.id,
      fullName: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
    };

    const linkedAdmin = await findLinkedAdmin(user);

    const fullName = String(req.body.fullName || user.fullName).trim();
    const username = cleanUsername(req.body.username || user.username);

    if (!fullName || !username) {
      return res.status(400).send("Full name and username are required");
    }

    if (!(await usernameAvailableForUser(username, user, linkedAdmin))) {
      return res.status(400).send("Username already exists");
    }

    const { data: updatedUser } = await supabase
      .from('users')
      .update({ full_name: fullName, username })
      .eq('id', user._id)
      .select('id, full_name, username, role')
      .single();

    if (linkedAdmin) {
      await supabase
        .from('admins')
        .update({ full_name: fullName, username })
        .eq('id', linkedAdmin._id);
    }

    const newUser = {
      _id: updatedUser.id,
      fullName: updatedUser.full_name,
      username: updatedUser.username,
      role: updatedUser.role,
    };

    res.json({ user: toUserResponse(newUser) });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});


router.put("/me/password", requireUser, async (req, res) => {
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, role, password_hash')
      .eq('id', req.user._id)
      .single();

    if (error || !userRow) return res.status(404).send("User not found");

    if (userRow.role === "admin") {
      return res.status(403).send("Admin passwords cannot be changed here");
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).send("Current and new password required");
    }

    const ok = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!ok) return res.status(400).send("Current password is incorrect");

    const nextHash = await bcrypt.hash(newPassword, 10);
    await supabase
      .from('users')
      .update({ password_hash: nextHash })
      .eq('id', userRow.id);

    // If user has linked admin, update admin password too (behavior matches your existing logic)
    const { data: linkedAdmin } = await supabase
      .from('admins')
      .select('id')
      .eq('created_from_user', userRow.id)
      .maybeSingle();

    if (linkedAdmin) {
      await supabase
        .from('admins')
        .update({ password_hash: nextHash })
        .eq('id', linkedAdmin.id);
    }

    res.json({ message: "Password updated" });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});


/* ------------------------- Admin login only ------------------------ */

router.post("/admin/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    const { data: adminRow, error } = await supabase
      .from('admins')
      .select('id, full_name, username, password_hash, level, created_from_user, created_by')
      .eq('username', username)
      .single();

    if (error || !adminRow) return res.status(400).send("Invalid credentials");

    const ok = await bcrypt.compare(password, adminRow.password_hash);
    if (!ok) return res.status(400).send("Invalid credentials");

    const admin = {
      _id: adminRow.id,
      fullName: adminRow.full_name,
      username: adminRow.username,
      passwordHash: adminRow.password_hash,
      level: adminRow.level,
      createdFromUser: adminRow.created_from_user,
      createdBy: adminRow.created_by,
    };

    res.json({
      token: signAdmin(admin),
      admin: toAdminResponse(admin),
    });
  } catch (e) {
    console.error("Admin login error:", e);
    res.status(400).send("Error: " + e.message);
  }
});

router.get("/admin/me", onlyAdmin, (req, res) => {
  res.json({ admin: toAdminResponse(req.admin) });
});

/* --------------- Admin: create student accounts ------------------- */

router.post("/admin/create-user", onlyAdmin, async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const fullName = String(req.body.fullName || username).trim();
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    if (await usernameExists(username)) {
      return res.status(400).send("Username already exists");
    }

    const hash = await bcrypt.hash(password, 10);

    const { data: inserted, error } = await supabase
      .from('users')
      .insert({
        full_name: fullName || username,
        username,
        password_hash: hash,
        role: 'student',
      })
      .select('id, full_name, username, role')
      .single();

    if (error || !inserted) {
      throw error || new Error('Failed to create user');
    }

    const user = {
      _id: inserted.id,
      fullName: inserted.full_name,
      username: inserted.username,
      role: inserted.role,
    };

    res.json({ message: "User created", user: toUserResponse(user) });
  } catch (e) {
    res.status(400).send("Error: " + e.message);
  }
});

module.exports = router;
