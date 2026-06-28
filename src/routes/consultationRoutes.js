const express = require("express");
const router = express.Router();
const {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
  getAllConsultationsByDoctor,
  getAIRecommendation,
} = require("../controllers/consultationController");

const authMiddleware = require("../middleware/auth.middleware");
const checkSubscription = require("../middleware/checkSubscription.middleware");
router.use(authMiddleware);
router.use(authMiddleware);
router.use(checkSubscription);

router.route("/").get(getAllConsultations).post(createConsultation);
router.route("/doctor").get(getAllConsultationsByDoctor)
router.route("/ai-recommendation").post(getAIRecommendation)
router
  .route("/:id")
  .get(getConsultationById)
  .put(updateConsultation)
  .delete(deleteConsultation);
module.exports = router;
