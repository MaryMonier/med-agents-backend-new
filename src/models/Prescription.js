const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // Dosage amount + unit, e.g. amount=500, unit='mg'
  dosageAmount: { type: Number, required: true },
  dosageUnit: { type: String, enum: ["mcg", "mg", "g"], required: true },
  // How many times per period, e.g. frequencyCount=2, frequencyPeriod='per day'
  frequencyCount: { type: Number, required: true },
  frequencyPeriod: {
    type: String,
    enum: ["per day", "per week", "per month"],
    required: true,
  },
  // Duration is irrelevant when isChronic is true (lifelong medication)
  isChronic: { type: Boolean, default: false },
  durationValue: {
    type: Number,
    required: function () {
      return !this.isChronic;
    },
  },
  durationUnit: {
    type: String,
    enum: ["days", "weeks", "months"],
    required: function () {
      return !this.isChronic;
    },
  },
  // Kept for backward compatibility / quick display (auto-derived, see controller)
  dose: { type: String },
  frequency: { type: String },
  duration: { type: String },
  // One short sentence from the Quick Drug Check agent (interactions,
  // allergy conflicts, age issues, or "still active from a previous
  // prescription"), or null when no issue was found for this medication.
  quickCheckMessage: { type: String, default: null },
});

const prescriptionSchema = new mongoose.Schema(
  {
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      required: true,
    },
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
    medications: [medicationSchema],
    interactions: [{ type: String }],
    warnings: [{ type: String }],
    language: { type: String, enum: ["en", "ar"], default: "en" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Prescription", prescriptionSchema);
