const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");
const adminMiddleware = require("../middleware/admin.middleware");
const {
  initiatePayment,
  handlePaymobWebhook,
  getPaymentStatus,
  getAllPayments,
} = require("../controllers/payment.controller");

router.post("/initiate", authMiddleware, initiatePayment);

router.post("/webhook", handlePaymobWebhook);

router.get("/status/:merchantOrderId", authMiddleware, getPaymentStatus);

router.get("/all", authMiddleware, adminMiddleware, getAllPayments);

module.exports = router;