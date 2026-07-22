const mongoose = require("mongoose");

const consultationSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    symptoms: [{ type: String }],
    diagnosis: { type: String },
    rawInput: { type: String, required: true },
    structuredNote: { type: String },
    urgencyLevel: {
      type: String,
      enum: ["low", "medium", "critical", "unknown"],
    },
    suggestedSpecialist: { type: String },
    // القطع المنظمة الخام اللي بيرجعها إيجنت التشخيص التفريقي (Differential
    // Diagnosis Agent) - محفوظة منفصلة عن structuredNote (النص المجمّع) عشان
    // الـ Patient History وأي شاشة تانية تقدر تعرضهم في أقسام منظمة
    clinicalReading: { type: String },
    possibleDiagnoses: [
      {
        _id: false,
        diagnosis: { type: String },
        likelihood: {
          type: String,
          enum: ["high", "moderate", "low"],
        },
        // ليه محتمل
        supportingReasoning: { type: String },
        // ليه مش محتمل / أقل تأكيد
        againstReasoning: { type: String },
        // فحوصات/أشعة موصى بيها لإثبات أو استبعاد التشخيص ده
        recommendedTests: { type: String },
        // بروتوكول العلاج الخاص بالتشخيص ده تحديدًا لو اتأكد - كل تشخيص
        // بروتوكوله بتاعه، مش بروتوكول واحد عام للحالة كلها
        protocol: { type: String },
      },
    ],
    // لو الدكتور حدد إن الدايجنوزز دي مرض مزمن، بنضيفها لـ Patient.chronicConditions
    isChronic: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
    language: { type: String, enum: ["en", "ar"], default: "en" },
    followUpDate: { type: Date },
    // لو الكونسلتيشن دي جاية من فولو أب، بنحفظ الـ id بتاعه هنا
    followupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Followup",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Consultation", consultationSchema);
