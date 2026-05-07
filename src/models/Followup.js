const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema({
  consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  instructions: { type: String, required: true },
  scheduledDate: { type: Date },
  reminderSent: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'done'], default: 'pending' },
  language: { type: String, enum: ['en', 'ar'], default: 'en' },
}, { timestamps: true });

module.exports = mongoose.model('Followup', followupSchema);