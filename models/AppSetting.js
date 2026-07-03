const mongoose = require("mongoose");

const AppSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    brandName: { type: String, default: "SR EduNova" },
    appName: { type: String, default: "SR EduNova" },
    instituteName: { type: String, default: "Your Institute Name" },
    logoUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSetting", AppSettingSchema, "appsettings");
