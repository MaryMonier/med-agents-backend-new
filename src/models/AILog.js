const mongoose = require('mongoose');

const aiLogSchema = new mongoose.Schema({
  consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
  agentName: {
    type: String,
    enum: ['drugSafety', 'clinicalRec', 'reportGen', 'followup'],
    required: true
  },
  reasoningTrace: { type: String },
  tokensUsed: { type: Number },
  costUSD: { type: Number },
  latencyMs: { type: Number },
  success: { type: Boolean, default: true },
  errorMessage: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('AILog', aiLogSchema);