const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, require: true },
    nationalID: { type: String, require: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ["male", "female"], required: true },
    bloodType: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    allergies: [{ type: String }],
    chronicConditions: [{ type: String }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
