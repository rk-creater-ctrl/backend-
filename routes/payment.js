// routes/payment.js
const express = require("express");
const Razorpay = require("razorpay");
const { requireUser } = require("../middleware/authRole");

const router = express.Router();

const hasRazorpayConfig = Boolean(
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
);

// Keep the API available when online payments are not configured.
const razor = hasRazorpayConfig
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

// Create Razorpay order
router.post("/order", requireUser, async (req, res) => {
  try {
    if (!razor) {
      return res.status(503).json({
        message: "Online payments are not configured",
      });
    }

    const { amount, currency = "INR", receipt, notes } = req.body;
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1000000) {
      return res.status(400).json({ message: "Invalid amount" });
    }
    if (currency !== "INR") return res.status(400).json({ message: "Unsupported currency" });

    const options = {
      amount: Math.round(numericAmount * 100), // rupees -> paise
      currency,
      receipt: String(receipt || `rcpt_${Date.now()}`).slice(0, 40),
      notes: notes && typeof notes === "object" && !Array.isArray(notes) ? notes : {},
    };

    const order = await razor.orders.create(options);
    return res.json(order);
  } catch (err) {
    console.error("RAZORPAY ORDER ERROR:", err);
    return res.status(500).json({ message: "Failed to create order" });
  }
});

module.exports = router;
