const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");
const {
  initiatePayment,
  handlePaymobWebhook,
  getPaymentStatus,
} = require("../controllers/payment.controller");

router.post("/initiate", authMiddleware, initiatePayment);

router.post("/webhook", handlePaymobWebhook);

router.get("/status/:merchantOrderId", authMiddleware, getPaymentStatus);

module.exports = router;
