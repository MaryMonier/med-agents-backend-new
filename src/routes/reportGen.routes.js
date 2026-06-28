const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const reportGenAgent = require('../agents/reportGen.agent');
const Consultation = require('../models/Consultation');
const Prescription = require('../models/Prescription');
const checkSubscription = require('../middleware/checkSubscription.middleware');



router.post('/generate', authMiddleware, checkSubscription,async (req, res, next) => {
  try {
    const { consultationId, language } = req.body;

    if (!consultationId) {
      return res.status(400).json({ success: false, message: 'consultationId is required' });
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found' });
    }

    const prescription = await Prescription.findOne({ consultationId });

    const result = await reportGenAgent({ consultation, prescription, language: language || consultation.language });

    res.status(200).json(result);

  } catch (err) {
    next(err);
  }
});

module.exports = router;