const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { checkDrugSafety, checkDrugSafetyForPatient } = require('../controllers/drugSafetyController');
const checkSubscription = require('../middleware/checkSubscription.middleware');
const requireProPlan = require('../middleware/requireProPlan.middleware');

// Check drug safety for a list of medications (no patient needed)
router.post('/check', authMiddleware, checkSubscription, requireProPlan, checkDrugSafety);

// Check drug safety using patient's allergies and chronic conditions from DB
router.post('/check/:patientId', authMiddleware, checkSubscription, requireProPlan, checkDrugSafetyForPatient);

module.exports = router;