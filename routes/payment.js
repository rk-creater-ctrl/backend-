// routes/payment.js
const express = require("express");
const Razorpay = require("razorpay");

const router = express.Router();

const razor = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay order
router.post("/order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const options = {
      amount: amount * 100, // rupees -> paise
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    };

    const order = await razor.orders.create(options);
    return res.json(order);
  } catch (err) {
    console.error("RAZORPAY ORDER ERROR:", err);
    return res.status(500).json({ message: "Failed to create order" });
  }
});

module.exports = router;