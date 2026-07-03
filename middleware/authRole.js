const jwt   = require("jsonwebtoken");

const { supabase } = require("../supabaseClient");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";


function getAdminLevel(admin) {
  return admin?.level || "super_admin";
}

// attach req.user if JWT exists (for both user and admin)
function attachUser(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET); // { _id, type, role? }
    req.user = payload;
  } catch {
    req.user = null;
  }
  next();
}

// admin‑only guard (type: "admin" and exists in admins collection)
async function onlyAdmin(req, res, next) {
  if (!req.user || req.user.type !== "admin") {
    return res.status(403).send("Admin only");
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, full_name, username, password_hash, level, created_from_user, created_by')
    .eq('id', req.user._id)
    .single();

  if (error || !admin) {
    return res.status(403).send("Admin not found");
  }

  // Normalize to match prior code shape
  req.admin = {
    _id: admin.id,
    fullName: admin.full_name,
    username: admin.username,
    passwordHash: admin.password_hash,
    level: admin.level,
    createdFromUser: admin.created_from_user,
    createdBy: admin.created_by,
  };
  req.adminLevel = getAdminLevel(req.admin);
  next();

}

function onlySuperAdmin(req, res, next) {
  if (!req.admin || req.adminLevel !== "super_admin") {
    return res.status(403).send("Real admin only");
  }

  next();
}

module.exports = { attachUser, onlyAdmin, onlySuperAdmin, getAdminLevel };
