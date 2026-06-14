const express = require("express");
const router = express.Router();
const {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
} = require("../controllers/consultationController");

const authMiddleware = require("../middleware/auth.middleware");
router.use(authMiddleware);

router.route("/").get(getAllConsultations).post(createConsultation);
router
  .route("/:id")
  .get(getConsultationById)
  .put(updateConsultation)
  .delete(deleteConsultation);

module.exports = router;
