const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  fullName:     { type: String, required: true },
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ["teacher", "student"],
    default: "student"
  },
  createdAt: { type: Date, default: Date.now }
});

// force collection name "users"
module.exports = mongoose.model("User", UserSchema, "users");
