const express = require('express');
const router = express.Router();
const {
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  updatePrescription,
  deletePrescription,
} = require('../controllers/prescriptionController');


router.post('/',createPrescription);
router.get('/:id',getPrescriptionById);
router.patch('/:id',updatePrescription);
router.delete('/:id',deletePrescription);
router.get('/consultation/:consultationId',getPrescriptionByConsultation);
router.get('/patient/:patientId',getPrescriptionsByPatient);

module.exports = router;
