const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const {
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  updatePrescription,
  deletePrescription,
} = require('../controllers/prescriptionController');

router.post('/', authMiddleware, createPrescription);
router.get('/:id', authMiddleware, getPrescriptionById);
router.patch('/:id', authMiddleware, updatePrescription);
router.delete('/:id', authMiddleware, deletePrescription);
router.get('/consultation/:consultationId', authMiddleware, getPrescriptionByConsultation);
router.get('/patient/:patientId', authMiddleware, getPrescriptionsByPatient);

module.exports = router;