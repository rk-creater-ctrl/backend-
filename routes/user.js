// backend/routes/user.js
const express = require("express");
const bcrypt  = require("bcryptjs");
const { supabase } = require("../supabaseClient");
const { onlyAdmin, getAdminLevel } = require("../middleware/authRole");

const router = express.Router();

router.use(onlyAdmin);

function isRealAdmin(req) {
  return req.adminLevel === "super_admin";
}

function toUserResponse(user, adminAccount) {
  const plain = user.toObject ? user.toObject() : { ...user };
  delete plain.passwordHash;

  if (adminAccount || plain.role === "admin") {
    plain.adminLevel = adminAccount ? getAdminLevel(adminAccount) : "admin";
  }

  return plain;
}

async function fetchUserById(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("id,full_name,username,password_hash,role,created_at")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data;
}

async function fetchAdminByUserOrUsername({ userId, username }) {
  // Try created_from_user first
  if (userId) {
    const { data: admin1, error: e1 } = await supabase
      .from("admins")
      .select("id,full_name,username,password_hash,level,created_from_user,created_by,created_at")
      .eq("created_from_user", userId)
      .maybeSingle();
    if (e1) throw e1;
    if (admin1) return admin1;
  }

  const { data: admin2, error: e2 } = await supabase
    .from("admins")
    .select("id,full_name,username,password_hash,level,created_from_user,created_by,created_at")
    .eq("username", username)
    .maybeSingle();

  if (e2) throw e2;
  return admin2;
}

function adminBelongsToUser(admin, user) {
  return (
    admin?.created_from_user &&
    String(admin.created_from_user) === String(user.id)
  );
}

async function assertUsernameAvailable(username, userId, adminId) {
  const { data: existingUsers, error: eu } = await supabase
    .from("users")
    .select("id,username")
    .eq("username", username);
  if (eu) throw eu;

  const { data: existingAdmins, error: ea } = await supabase
    .from("admins")
    .select("id,username")
    .eq("username", username);
  if (ea) throw ea;

  const userTaken = (existingUsers || []).some((u) => u.id !== userId);
  const adminTaken = (existingAdmins || []).some((a) => a.id !== adminId);

  if (userTaken || adminTaken) {
    const err = new Error("Username already exists");
    err.status = 400;
    throw err;
  }
}


// GET /user/list - all users for admin dashboard
router.get("/list", async (req, res) => {
  try {
    const { data: users, error: uErr } = await supabase
      .from("users")
      .select("id,full_name,username,role,created_at")
      .order("created_at", { ascending: false });

    if (uErr) throw uErr;

    const usernames = (users || []).map((u) => u.username).filter(Boolean);

    const { data: adminAccounts, error: aErr } = await supabase
      .from("admins")
      .select("id,username,level,created_from_user")
      .in("username", usernames.length ? usernames : ["__none__"]);

    if (aErr) throw aErr;

    const adminByUsername = new Map((adminAccounts || []).map((a) => [a.username, a]));

    res.json(
      (users || []).map((user) => {
        const adminAccount = adminByUsername.get(user.username);
        return {
          id: user.id,
          fullName: user.full_name,
          username: user.username,
          role: user.role || "student",
          createdAt: user.created_at,
          adminLevel: adminAccount
            ? getAdminLevel(adminAccount)
            : user.role === "admin"
              ? "admin"
              : undefined,
        };
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching users");
  }
});

// POST /user - create student
router.post("/", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const fullName = String(req.body.fullName || username).trim();
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Username and password required");
    }

    await assertUsernameAvailable(username);

    const { data: student, error } = await supabase
      .from("users")
      .insert({
        full_name: fullName || username,
        username,
        password_hash: await bcrypt.hash(password, 10),
        role: "student",
      })
      .select("id,full_name,username,role,created_at")
      .single();

    if (error) throw error;

    res.json({
      id: student.id,
      fullName: student.full_name,
      username: student.username,
      role: student.role || "student",
      createdAt: student.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).send(err.message || "Error creating user");
  }
});

// PUT /user/:id - update user details/password
router.put("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await fetchUserById(userId);
    if (!user) return res.status(404).send("User not found");

    const linkedAdmin = await fetchAdminByUserOrUsername({ userId, username: user.username });
    const targetIsAdmin = user.role === "admin" || Boolean(linkedAdmin);

    if (targetIsAdmin && !isRealAdmin(req)) {
      return res.status(403).send("Only real admins can edit admin accounts");
    }

    const nextUsername = String(req.body.username || user.username).trim();
    const nextFullName = String(req.body.fullName || user.full_name).trim();
    const nextPassword = typeof req.body.password === "string" ? req.body.password : "";

    if (!nextUsername || !nextFullName) {
      return res.status(400).send("Full name and username are required");
    }

    await assertUsernameAvailable(nextUsername, userId, linkedAdmin?.id);

    const updatePayload = {
      full_name: nextFullName,
      username: nextUsername,
    };
    if (nextPassword.trim()) {
      updatePayload.password_hash = await bcrypt.hash(nextPassword, 10);
    }

    const { data: updatedUser, error: uErr } = await supabase
      .from("users")
      .update(updatePayload)
      .eq("id", userId)
      .select("id,full_name,username,password_hash,role,created_at")
      .single();

    if (uErr) throw uErr;

    if (linkedAdmin) {
      const linkedAdminPayload = {
        full_name: nextFullName,
        username: nextUsername,
        ...(nextPassword.trim() ? { password_hash: updatedUser.password_hash } : {}),
      };

      const { error: aErr } = await supabase
        .from("admins")
        .update(linkedAdminPayload)
        .eq("id", linkedAdmin.id);

      if (aErr) throw aErr;
    }

    res.json({
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      username: updatedUser.username,
      role: updatedUser.role || "student",
      createdAt: updatedUser.created_at,
      adminLevel: linkedAdmin ? getAdminLevel(linkedAdmin) : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).send(err.message || "Error updating user");
  }
});

// PATCH /user/:id/role - promote/demote user admin role
router.patch("/:id/role", async (req, res) => {
  try {
    if (!isRealAdmin(req)) {
      return res.status(403).send("Only real admins can change admin roles");
    }

    const userId = req.params.id;
    const nextRole = String(req.body.role || "").trim();
    if (!["student", "admin"].includes(nextRole)) {
      return res.status(400).send("Role must be student or admin");
    }

    const user = await fetchUserById(userId);
    if (!user) return res.status(404).send("User not found");

    const linkedAdmin = await fetchAdminByUserOrUsername({ userId, username: user.username });

    if (nextRole === "admin") {
      if (
        linkedAdmin &&
        getAdminLevel(linkedAdmin) === "super_admin" &&
        !adminBelongsToUser(linkedAdmin, user)
      ) {
        return res.status(400).send("This username already belongs to a real admin account");
      }

      let admin = linkedAdmin;
      if (!admin) {
        const { data: created, error: cErr } = await supabase
          .from("admins")
          .insert({
            full_name: user.full_name,
            username: user.username,
            password_hash: user.password_hash,
            level: "admin",
            created_by: req.admin.id,
            created_from_user: user.id,
          })
          .select("id,full_name,username,password_hash,level,created_from_user,created_by,created_at")
          .single();
        if (cErr) throw cErr;
        admin = created;
      } else {
        const { error: aErr } = await supabase
          .from("admins")
          .update({
            full_name: user.full_name,
            username: user.username,
            password_hash: user.password_hash,
            level: "admin",
          })
          .eq("id", admin.id);
        if (aErr) throw aErr;
      }

      const { error: uErr } = await supabase
        .from("users")
        .update({ role: "admin" })
        .eq("id", userId);
      if (uErr) throw uErr;

      return res.json({
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        role: "admin",
        adminLevel: admin ? getAdminLevel(admin) : "admin",
      });
    }

    // demote to student
    if (linkedAdmin) {
      if (getAdminLevel(linkedAdmin) === "super_admin") {
        return res.status(403).send("Real admin accounts cannot be demoted");
      }
      if (String(linkedAdmin.id) === String(req.admin.id)) {
        return res.status(403).send("You cannot demote your own admin account");
      }

      const { error: dErr } = await supabase
        .from("admins")
        .delete()
        .eq("id", linkedAdmin.id);
      if (dErr) throw dErr;
    }

    const { error: uErr } = await supabase
      .from("users")
      .update({ role: "student" })
      .eq("id", userId);
    if (uErr) throw uErr;

    res.json({
      id: user.id,
      fullName: user.full_name,
      username: user.username,
      role: "student",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating role");
  }
});

// DELETE /user/:id - delete student/admin-user
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await fetchUserById(userId);
    if (!user) return res.status(404).send("User not found");

    const linkedAdmin = await fetchAdminByUserOrUsername({ userId, username: user.username });
    const targetIsAdmin = user.role === "admin" || Boolean(linkedAdmin);

    if (targetIsAdmin && !isRealAdmin(req)) {
      return res.status(403).send("Only real admins can delete admin accounts");
    }

    if (linkedAdmin) {
      if (getAdminLevel(linkedAdmin) === "super_admin") {
        return res.status(403).send("Real admin accounts cannot be deleted");
      }
      if (String(linkedAdmin.id) === String(req.admin.id)) {
        return res.status(403).send("You cannot delete your own admin account");
      }

      const { error: dErr } = await supabase
        .from("admins")
        .delete()
        .eq("id", linkedAdmin.id);
      if (dErr) throw dErr;
    }

    const { error: delUserErr } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (delUserErr) throw delUserErr;

    res.send("Deleted");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting user");
  }
});


module.exports = router;
