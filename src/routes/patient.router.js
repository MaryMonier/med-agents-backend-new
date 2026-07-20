const authMiddleware = require("../middleware/auth.middleware");
const {
  getAllPatients,
  getPatientById,
  createPatient,
  deletePatient,
  getPatientHistory,
  updatePatient,
  getPatientsByDoctorId,
  getAllPatientsByDoctor,
  discontinueMedication,
  reactivateMedication,
} = require("../controllers/patient.controller");
const adminMiddleware = require("../middleware/admin.middleware");
const checkSubscription = require("../middleware/checkSubscription.middleware");
const router = require("express").Router();

router.get("/", authMiddleware, checkSubscription, getAllPatients);
router.get(
  "/doctor",
  authMiddleware,
  checkSubscription,
  getAllPatientsByDoctor,
);
router.get("/:id", authMiddleware, checkSubscription, getPatientById);
router.post("/", authMiddleware, checkSubscription, createPatient);
router.delete("/:id", authMiddleware, checkSubscription, deletePatient);
router.patch("/:id", authMiddleware, checkSubscription, updatePatient);
router.get(
  "/:id/history",
  authMiddleware,
  checkSubscription,
  getPatientHistory,
);
router.post(
  "/:id/discontinue-medication",
  authMiddleware,
  checkSubscription,
  discontinueMedication,
);
router.post(
  "/:id/reactivate-medication",
  authMiddleware,
  checkSubscription,
  reactivateMedication,
);

router.get("/by-doctor/:doctorId", authMiddleware, checkSubscription, getPatientsByDoctorId);

module.exports = router;