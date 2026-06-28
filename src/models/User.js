const mongoose = require('mongoose');

const TRIAL_DAYS = 14;
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['doctor', 'admin'], default: 'doctor' },
  specialty: { type: String, default: 'Internal Medicine'  },
  language: { type: String, enum: ['en', 'ar'], default: 'en' },
  isActive: { type: Boolean, default: true },

subscription: {
  status: {
    type: String,
    enum: ["trial", "active", "expired"],
    default: "trial",
  },

  plan: {
    type: String,
    default: "Trial",
  },

  trialStart: {
    type: Date,
    default: Date.now,
  },

  trialEnd: {
    type: Date,
    default: () => {
      const date = new Date();
      date.setDate(date.getDate() + TRIAL_DAYS);
      return date;
    },
  },

  subscriptionStart: Date,

  subscriptionEnd: Date,
},
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);