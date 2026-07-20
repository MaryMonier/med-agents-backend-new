const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // رقم موبايل مصري (01 + رقم من 0/1/2/5 + 8 أرقام = 11 رقم بالظبط).
    // الفريدة (unique) بتتحقق على مستوى الكونترولر لكل دكتور لوحده (مش
    // unique index على مستوى الداتابيز كله)، عشان دكتورين مختلفين ممكن
    // يكون عندهم مريض بنفس الرقم من غير مشكلة
    phone: {
      type: String,
      required: true,
      match: [/^01[0125][0-9]{8}$/, "Invalid Egyptian mobile number"],
    },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ["male", "female"], required: true },
    bloodType: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    allergies: [{ type: String }],
    chronicConditions: [{ type: String }],
    // اختياري - أدوية كرونية معروفة عن المريض (زي لما تكون معاه من قبل ما
    // ينضم للنظام). لما يتعمل discontinue لدواء كروني من روشتة، بيتشال من
    // هنا كمان لو موجود (اسم مطابق) عشان الخانة تفضل معبّرة عن الحالة الحالية
    chronicMedications: [{ type: String }],
    // مش required عمدًا: لو الدكتور اللي أنشأ المريض اتمسح، deleteDoctor
    // بيحط null هنا بدل ما يسيب reference معلّق على user مش موجود، والسجل
    // الطبي للمريض بيفضل موجود زي ما هو.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    doctors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // بيسجل إن دواء معين (من روشتة قديمة) اتوقف، من غير ما نلمس أو نعدّل
    // الروشتة الأصلية خالص - عشان نحافظ على السجل التاريخي زي ما هو، وفي
    // نفس الوقت متعتبرش الدواء ده "شغال" لسه في فحوصات التعارضات
    discontinuedMedications: [
      {
        prescriptionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Prescription",
          required: true,
        },
        medicationId: { type: mongoose.Schema.Types.ObjectId, required: true }, // subdocument _id بتاع الدواء جوه الروشتة
        medicationName: { type: String }, // للعرض بس، مش بيتستخدم في المطابقة
        discontinuedAt: { type: Date, default: Date.now },
        discontinuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reason: { type: String, default: null },
      },
    ],
  },
  { timestamps: true },
);
module.exports = mongoose.model("Patient", patientSchema);
