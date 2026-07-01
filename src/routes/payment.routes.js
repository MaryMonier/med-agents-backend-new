const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");
const {
  initiatePayment,
  handlePaymobWebhook,
  getPaymentStatus,
} = require("../controllers/payment.controller");

// الدكتور لازم يكون عامل لوجين عشان يبدأ يدفع
router.post("/initiate", authMiddleware, initiatePayment);

// ده مينفعش يكون عليه authMiddleware - باي موب نفسه اللي بينادي عليه
// (الحماية بتاعته بقت عن طريق التحقق من الـ HMAC جوه الكنترولر)
router.post("/webhook", handlePaymobWebhook);

router.get("/status/:merchantOrderId", authMiddleware, getPaymentStatus);

module.exports = router;
