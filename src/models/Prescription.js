const mongoose = require('mongoose');

const medicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dose: { type: String, required: true },
  frequency: { type: String, required: true },
  duration: { type: String, required: true },
});
const prescriptionSchema = new mongoose.Schema({
  consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  medications: [medicationSchema],
  interactions: [{ type: String }],
  warnings: [{ type: String }],
  language: { type: String, enum: ['en', 'ar'], default: 'en' },
}, { timestamps: true });
module.exports = mongoose.model('Prescription', prescriptionSchema);