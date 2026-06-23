const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const {
  searchDrugs,
  getAllPrescriptions,
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  updatePrescription,
  deletePrescription,
} = require("../controllers/prescriptionController");

// ⚠️ الراوتس الثابتة لازم تكون قبل الـ dynamic routes
router.get("/drugs/search", authMiddleware, searchDrugs);
router.get("/", authMiddleware, getAllPrescriptions);

router.post("/", authMiddleware, createPrescription);
router.get(
  "/consultation/:consultationId",
  authMiddleware,
  getPrescriptionByConsultation,
);
router.get("/patient/:patientId", authMiddleware, getPrescriptionsByPatient);
router.get("/:id", authMiddleware, getPrescriptionById);
router.patch("/:id", authMiddleware, updatePrescription);
router.delete("/:id", authMiddleware, deletePrescription);

module.exports = router;
