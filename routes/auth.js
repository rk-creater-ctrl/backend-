// backend/routes/auth.js

const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const router  = express.Router();

const { supabase } = require("../supabaseClient");
const { onlyAdmin, getAdminLevel } = require("../middleware/authRole");


const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256";
const MAX_USERNAME_LENGTH = 64;
const MAX_FULL_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 128;

function cleanUsername(username) {
  return username.trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(body, allowedFields) {
  return Object.keys(body).every((key) => allowedFields.includes(key));
}

function invalidInput(res, message) {
  return res.status(400).json({ message });
}

function unexpectedAuthError(res, context, error) {
  console.error(context, { name: error?.name, code: error?.code });
  return res.status(500).json({ message: "Unable to process authentication request" });
}

function validateCredentials(body, { allowFullName = false } = {}) {
  const allowedFields = allowFullName ? ["username", "fullName", "password"] : ["username", "password"];
  if (!isPlainObject(body) || !hasOnlyFields(body, allowedFields)) {
    return { error: "Invalid request body" };
  }
  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return { error: "Username and password must be strings" };
  }

  const username = cleanUsername(body.username);
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    return { error: "Username must be between 1 and 64 characters" };
  }
  if (!body.password || body.password.length > MAX_PASSWORD_LENGTH) {
    return { error: "Password must be between 1 and 128 characters" };
  }

  const fullName = allowFullName
    ? (body.fullName === undefined || body.fullName === "" ? username : typeof body.fullName === "string" ? body.fullName.trim() : null)
    : undefined;
  if (allowFullName && (!fullName || fullName.length > MAX_FULL_NAME_LENGTH)) {
    return { error: "Full name must be between 1 and 120 characters" };
  }

  return { username, password: body.password, fullName };
}

function validateProfileUpdate(body) {
  if (!isPlainObject(body) || !hasOnlyFields(body, ["username", "fullName"])) {
    return { error: "Invalid request body" };
  }
  if (body.username !== undefined && typeof body.username !== "string") {
    return { error: "Username must be a string" };
  }
  if (body.fullName !== undefined && typeof body.fullName !== "string") {
    return { error: "Full name must be a string" };
  }
  if (typeof body.username === "string" && body.username.trim().length > MAX_USERNAME_LENGTH) {
    return { error: "Username must be at most 64 characters" };
  }
  if (typeof body.fullName === "string" && body.fullName.trim().length > MAX_FULL_NAME_LENGTH) {
    return { error: "Full name must be at most 120 characters" };
  }
  return {};
}

function validatePasswordChange(body) {
  if (!isPlainObject(body) || !hasOnlyFields(body, ["currentPassword", "newPassword"])) {
    return { error: "Invalid request body" };
  }
  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return { error: "Passwords must be strings" };
  }
  if (!body.currentPassword || !body.newPassword || body.currentPassword.length > MAX_PASSWORD_LENGTH || body.newPassword.length > MAX_PASSWORD_LENGTH) {
    return { error: "Passwords must be between 1 and 128 characters" };
  }
  return {};
}

function toUserResponse(user) {
  return {
    _id: user._id,
    fullName: user.fullName,
    username: user.username,
    role: user.role || "student",
    status: user.status || "active",
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
    { expiresIn: "7d", algorithm: JWT_ALGORITHM }
  );
}

function signAdmin(admin) {
  return jwt.sign(
    { _id: admin._id, type: "admin", level: getAdminLevel(admin) },
    JWT_SECRET,
    { expiresIn: "7d", algorithm: JWT_ALGORITHM }
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
    return res.status(401).json({ message: "Login required" });
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
    const input = validateCredentials(req.body, { allowFullName: true });
    if (input.error) return invalidInput(res, input.error);
    const { username, fullName, password } = input;

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
    return unexpectedAuthError(res, "Student registration error", e);
  }
});


// students/admin-users login to the student app
router.post("/login", async (req, res) => {
  try {
    const input = validateCredentials(req.body);
    if (input.error) return invalidInput(res, input.error);
    const { username, password } = input;

    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, password_hash, role, status')
      .eq('username', username)
      .single();

    if (error || !userRow) return res.status(400).send("Invalid credentials");
    if (userRow.status === "blocked") return res.status(403).send("Account is blocked");

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) return res.status(400).send("Invalid credentials");

    const user = {
      _id: userRow.id,
      fullName: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
      status: userRow.status,
    };

    res.json({
      token: signUser(user),
      user: toUserResponse(user),
    });
  } catch (e) {
    return unexpectedAuthError(res, "Student login error", e);
  }
});


router.get("/me", requireUser, async (req, res) => {
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('id, full_name, username, role, status')
      .eq('id', req.user._id)
      .single();

    if (error || !userRow) return res.status(404).send("User not found");

    const user = {
      _id: userRow.id,
      fullName: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
      status: userRow.status,
    };

    res.json({ user: toUserResponse(user) });
  } catch (e) {
    return unexpectedAuthError(res, "Student profile lookup error", e);
  }
});


router.put("/me", requireUser, async (req, res) => {
  try {
    const input = validateProfileUpdate(req.body);
    if (input.error) return invalidInput(res, input.error);
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
    return unexpectedAuthError(res, "Student profile update error", e);
  }
});


router.put("/me/password", requireUser, async (req, res) => {
  try {
    const input = validatePasswordChange(req.body);
    if (input.error) return invalidInput(res, input.error);
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
    return unexpectedAuthError(res, "Student password update error", e);
  }
});


/* ------------------------- Admin login only ------------------------ */

router.post("/admin/login", async (req, res) => {
  try {
    const input = validateCredentials(req.body);
    if (input.error) return invalidInput(res, input.error);
    const { username, password } = input;

    const { data: adminRow, error } = await supabase
      .from('admins')
      // Login must work with the original admins table too.  The two
      // relationship columns below are optional and are not needed to sign in.
      .select('id, full_name, username, password_hash, level')
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
    };

    res.json({
      token: signAdmin(admin),
      admin: toAdminResponse(admin),
    });
  } catch (e) {
    return unexpectedAuthError(res, "Admin login error", e);
  }
});

router.get("/admin/me", onlyAdmin, (req, res) => {
  res.json({ admin: toAdminResponse(req.admin) });
});

/* --------------- Admin: create student accounts ------------------- */

router.post("/admin/create-user", onlyAdmin, async (req, res) => {
  try {
    const input = validateCredentials(req.body, { allowFullName: true });
    if (input.error) return invalidInput(res, input.error);
    const { username, fullName, password } = input;

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
    return unexpectedAuthError(res, "Admin user creation error", e);
  }
});

module.exports = router;
