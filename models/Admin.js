// Admin.js
const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema({
  fullName:     { type: String, required: true },
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  level: {
    type: String,
    enum: ["super_admin", "admin"],
    default: "super_admin"
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  },
  createdFromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  createdAt:    { type: Date, default: Date.now }
});

// force collection name "admins"
module.exports = mongoose.model("Admin", AdminSchema, "admins");
