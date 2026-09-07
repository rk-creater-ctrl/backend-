const jwt   = require("jsonwebtoken");

const { supabase } = require("../supabaseClient");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256";


function getAdminLevel(admin) {
  return admin?.level || "super_admin";
}

function getAuthenticatedUserId(req) {
  const userId = req?.user?._id;
  return typeof userId === "string" && userId.trim() ? userId : null;
}

// attach req.user if JWT exists (for both user and admin)
function attachUser(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (!payload?._id || !["user", "admin"].includes(payload.type)) {
      throw new Error("Invalid token payload");
    }
    req.user = payload;
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
  next();
}

// admin‑only guard (type: "admin" and exists in admins collection)
async function onlyAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Login required" });
  }
  if (req.user.type !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, full_name, username, password_hash, level, created_from_user, created_by')
    .eq('id', req.user._id)
    .single();

  if (error || !admin) {
    return res.status(403).json({ message: "Admin not found" });
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

function requireUser(req, res, next) {
  if (!req.user || req.user.type !== "user") {
    return res.status(401).json({ message: "Login required" });
  }
  next();
}

function requireSelfOrAdmin(paramName = "studentId") {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Login required" });
    }
    const authenticatedUserId = getAuthenticatedUserId(req);
    const requestedTargetId = req.params[paramName] ?? req.body?.[paramName];
    const targetId = requestedTargetId ?? authenticatedUserId;
    const isSelf =
      req.user?.type === "user" &&
      authenticatedUserId !== null &&
      String(authenticatedUserId) === String(targetId);
    if (!isSelf && req.user?.type !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

module.exports = {
  attachUser,
  onlyAdmin,
  onlySuperAdmin,
  requireUser,
  requireSelfOrAdmin,
  getAdminLevel,
  getAuthenticatedUserId,
};
