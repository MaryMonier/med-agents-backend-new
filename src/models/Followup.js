const mongoose = require("mongoose");

const followupSchema = new mongoose.Schema(
  {
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      required: true,
    },
    // بيتحدد بس لما الفولو أب دي تتكمّل (Complete Follow-up) — بتشاور على
    // زيارة الإكمال نفسها، مختلفة عن consultationId اللي فضلت بتشاور على
    // الكونسلتيشن الأصلية اللي جدولت الفولو أب دي من الأول
    completionConsultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      default: null,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    instructions: { type: String, required: true },
    scheduledDate: { type: Date },
    // بيتسجل بس لما الفولو أب دي فعلاً تتكمّل - تاريخ اليوم الحقيقي اللي
    // الدكتور خلص فيه الزيارة، مختلف عن scheduledDate اللي هو الميعاد
    // المجدول الأصلي (ممكن يكون قبله أو بعده حسب ظروف المريض)
    completedAt: { type: Date, default: null },
    reminderSent: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    language: { type: String, enum: ["en", "ar"], default: "en" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Followup", followupSchema);
