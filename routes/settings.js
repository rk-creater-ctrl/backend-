const express = require("express");
const { supabase } = require("../supabaseClient");
const { onlyAdmin } = require("../middleware/authRole");

const router = express.Router();

const FIXED_BRAND_NAME = "SR EduNova";
const DEFAULT_INSTITUTE_NAME = "Your Institute Name";

const DEFAULT_SETTINGS = {
  brandName: FIXED_BRAND_NAME,
  appName: FIXED_BRAND_NAME,
  instituteName: DEFAULT_INSTITUTE_NAME,
  logoUrl: "",
};

function legacyInstituteName(value) {
  const name = String(value || "").trim();
  const normalized = name.toLowerCase();
  const previousBrandName = ["tech", "jaguar"].join("");

  if (
    !name ||
    normalized === FIXED_BRAND_NAME.toLowerCase() ||
    normalized === previousBrandName
  ) {
    return "";
  }

  return name;
}

async function getSettings() {
  const { data: settings, error } = await supabase
    .from("app_settings")
    .select("key, brand_name, app_name, institute_name, logo_url")
    .eq("key", "global")
    .single();

  if (error) {
    // if row doesn’t exist, fall back to defaults
    if (String(error?.message || "").toLowerCase().includes("single")) {
      return DEFAULT_SETTINGS;
    }
    throw error;
  }

  if (!settings) return DEFAULT_SETTINGS;

  const instituteName =
    String(settings.institute_name || "").trim() ||
    legacyInstituteName(settings.app_name);

  return {
    ...DEFAULT_SETTINGS,
    key: settings.key,
    brandName: FIXED_BRAND_NAME,
    appName: FIXED_BRAND_NAME,
    instituteName: instituteName || DEFAULT_INSTITUTE_NAME,
    logoUrl: settings.logo_url || "",
  };
}

function toResponse(settings) {
  const instituteName = String(settings.instituteName || "").trim();

  return {
    brandName: FIXED_BRAND_NAME,
    appName: FIXED_BRAND_NAME,
    instituteName: instituteName || DEFAULT_INSTITUTE_NAME,
    logoUrl: settings.logoUrl || "",
  };
}

async function saveSettings(req, res) {
  try {
    const instituteName = String(
      req.body.instituteName || req.body.appName || ""
    ).trim();
    const logoUrl = String(req.body.logoUrl || "").trim();

    if (!instituteName) {
      return res.status(400).json({ message: "Institute name is required" });
    }

    // Upsert single global row
    const { data, error } = await supabase
      .from("app_settings")
      .upsert({
        key: "global",
        brand_name: FIXED_BRAND_NAME,
        app_name: FIXED_BRAND_NAME,
        institute_name: instituteName,
        logo_url: logoUrl,
      })
      .select("key, institute_name, logo_url")
      .single();

    if (error) throw error;

    // Map DB -> API response shape
    res.json(
      toResponse({
        instituteName: data?.institute_name,
        logoUrl: data?.logo_url,
      })
    );
  } catch (err) {
    console.error("Settings save error:", err);
    res.status(500).json({ message: "Failed to save settings" });
  }
}

router.get("/public", async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(toResponse(settings));
  } catch (err) {
    console.error("Settings load error:", err);
    res.status(500).json({ message: "Failed to load settings" });
  }
});

router.get("/admin", onlyAdmin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(toResponse(settings));
  } catch (err) {
    console.error("Settings load error:", err);
    res.status(500).json({ message: "Failed to load settings" });
  }
});

router.post("/admin", onlyAdmin, saveSettings);
router.put("/admin", onlyAdmin, saveSettings);

module.exports = router;
