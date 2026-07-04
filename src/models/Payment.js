const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // الخطة والمدة اللي الدكتور بيدفع عشانها
    plan: {
      type: String,
      required: true,
    },
    months: {
      type: Number,
      required: true,
    },

    // المبلغ بالقرش (cents) عشان نتجنب مشاكل الفاصلة العشرية
    amountCents: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "EGP",
    },

    // بيانات Paymob
    paymobOrderId: {
      type: String,
      index: true,
    },
    paymobTransactionId: {
      type: String,
      index: true,
    },

    // مرجع فريد بنولده إحنا ونبعته كـ merchant_order_id لباي موب
    // ده اللي بيربطنا بين الطلب اللي بدأ والـ webhook اللي هيوصل بعدين
    merchantOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },

    // نخزن رد باي موب الخام للمراجعة لو حصلت مشكلة
    rawWebhookPayload: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
