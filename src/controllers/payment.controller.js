const crypto = require("crypto");
const User = require("../models/User");
const Payment = require("../models/Payment");
const { calculateAmountCents } = require("../config/plans");
const paymobService = require("../services/paymob.service");

// عدّلي القيمة دي في .env لو الباك إند أو الفرونت شغالين على دومين مختلف
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

// الدكتور بيدوس "اشترك دلوقتي" -> بنرجعله رابط دفع باي موب
const initiatePayment = async (req, res) => {
  try {
    const { plan, months } = req.body;
    const doctorId = req.user.id;

    if (!plan || !months) {
      return res.status(400).json({
        success: false,
        message: "Plan and months are required",
      });
    }

    const doctor = await User.findById(doctorId);

    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    let amountCents;
    try {
      amountCents = calculateAmountCents(plan, months);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    // مرجع فريد بنربط بيه عملية الدفع دي بالدكتور والخطة
    const merchantOrderId = `${doctorId}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;

    const payment = await Payment.create({
      doctor: doctorId,
      plan,
      months,
      amountCents,
      merchantOrderId,
      status: "pending",
    });

    const [firstName, ...rest] = (doctor.name || "Doctor").split(" ");

    const { paymobIntentionId, checkoutUrl } = await paymobService.createPaymentLink({
      amountCents,
      merchantOrderId,
      billingData: {
        first_name: firstName || "Doctor",
        last_name: rest.join(" ") || "Doctor",
        email: doctor.email,
        phone_number: doctor.phone || "+201000000000",
        apartment: "NA",
        floor: "NA",
        street: "NA",
        building: "NA",
        city: "NA",
        country: "EG",
        state: "NA",
      },
      redirectionUrl: `${FRONTEND_URL}/payment/callback`,
      notificationUrl: `${BACKEND_URL}/api/payment/webhook`,
    });

    payment.paymobOrderId = paymobIntentionId;
    await payment.save();

    return res.status(200).json({
      success: true,
      data: {
        paymentUrl: checkoutUrl,
        merchantOrderId,
      },
    });
  } catch (error) {
    console.error("initiatePayment error:", error?.response?.data || error);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate payment",
    });
  }
};

// باي موب بينادي الـ endpoint ده (server-to-server) بعد ما الدفع يخلص
// ده اللي بيفعّل/يجدد الاشتراك فعليًا - مينفعش نعتمد على ريدايركت المتصفح بس
const handlePaymobWebhook = async (req, res) => {
  try {
    const receivedHmac = req.query.hmac;
    const transaction = req.body.obj;

    if (!transaction) {
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    const isValid = paymobService.verifyHmac(transaction, receivedHmac);

    if (!isValid) {
      console.warn("Paymob webhook: invalid HMAC, ignoring request");
      return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    const merchantOrderId = transaction.order?.merchant_order_id;

    const payment = await Payment.findOne({ merchantOrderId });

    if (!payment) {
      console.warn("Paymob webhook: payment record not found", merchantOrderId);
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    // لو الطلب اتعالج قبل كده (باي موب ممكن يبعت الـ webhook أكتر من مرة)
    if (payment.status === "success") {
      return res.status(200).json({ success: true, message: "Already processed" });
    }

    payment.rawWebhookPayload = transaction;
    payment.paymobTransactionId = transaction.id;

    if (transaction.success === true && transaction.error_occured === false) {
      payment.status = "success";
      await payment.save();

      // تفعيل/تجديد الاشتراك فعليًا
      const doctor = await User.findById(payment.doctor);

      if (doctor) {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + payment.months);

        doctor.subscription.status = "active";
        doctor.subscription.plan = payment.plan;
        doctor.subscription.subscriptionStart = startDate;
        doctor.subscription.subscriptionEnd = endDate;

        await doctor.save();
      }
    } else {
      payment.status = "failed";
      await payment.save();
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("handlePaymobWebhook error:", error);
    // برجع 200 عشان باي موب ميعيدش المحاولة بشكل لا نهائي على خطأ فينا إحنا
    // الخطأ اتسجل بالـ log عشان نراجعه
    return res.status(200).json({ success: false });
  }
};

// الدكتور بيستخدمها يشوف حالة آخر عملية دفع عمله (لصفحة "جاري التأكيد")
const getPaymentStatus = async (req, res) => {
  try {
    const { merchantOrderId } = req.params;

    const payment = await Payment.findOne({
      merchantOrderId,
      doctor: req.user.id,
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: payment.status,
        plan: payment.plan,
        months: payment.months,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  initiatePayment,
  handlePaymobWebhook,
  getPaymentStatus,
};