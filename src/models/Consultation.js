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
      enum: ["low", "medium", "critical"],
      default: "low",
    },
    suggestedSpecialist: { type: String },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
    language: { type: String, enum: ["en", "ar"], default: "en" },
    followUpDate: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Consultation", consultationSchema);
