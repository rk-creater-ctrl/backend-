const jwt   = require("jsonwebtoken");
const Admin = require("../models/Admin");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key";

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

  const admin = await Admin.findById(req.user._id);
  if (!admin) {
    return res.status(403).send("Admin not found");
  }
  next();
}

module.exports = { attachUser, onlyAdmin };
