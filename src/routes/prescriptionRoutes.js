const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const {
  searchDrugs,
  checkPrescriptionSafety,
  getAllPrescriptions,
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  getPrescriptionDates,
  updatePrescription,
  deletePrescription,
} = require("../controllers/prescriptionController");
const checkSubscription = require("../middleware/checkSubscription.middleware");

// ⚠️ الراوتس الثابتة لازم تكون قبل الـ dynamic routes
router.get("/drugs/search", authMiddleware, checkSubscription, searchDrugs);
router.post("/safety-check", authMiddleware, checkSubscription, checkPrescriptionSafety);
router.get("/dates", authMiddleware, checkSubscription, getPrescriptionDates);
router.get("/", authMiddleware, checkSubscription, getAllPrescriptions);

router.post("/", authMiddleware, checkSubscription, createPrescription);
router.get(
  "/consultation/:consultationId",
  authMiddleware,
  checkSubscription,
  getPrescriptionByConsultation,
);

router.get(
  "/patient/:patientId",
  authMiddleware,
  checkSubscription,
  getPrescriptionsByPatient,
);
router.get("/:id", authMiddleware, checkSubscription, getPrescriptionById);
router.patch("/:id", authMiddleware, checkSubscription, updatePrescription);
router.delete("/:id", authMiddleware, checkSubscription, deletePrescription);

module.exports = router;