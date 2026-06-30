const express = require("express");
const router = express.Router();
const {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
  getAllConsultationsByDoctor,
    getConsultationsByDoctorId,   // 

  getAIRecommendation,
} = require("../controllers/consultationController");

const authMiddleware = require("../middleware/auth.middleware");
router.use(authMiddleware);

router.route("/").get(getAllConsultations).post(createConsultation);
router.route("/doctor").get(getAllConsultationsByDoctor)
router.route("/ai-recommendation").post(getAIRecommendation)
router.route("/by-doctor/:doctorId").get(getConsultationsByDoctorId);   // 

router
  .route("/:id")
  .get(getConsultationById)
  .put(updateConsultation)
  .delete(deleteConsultation);
module.exports = router;
