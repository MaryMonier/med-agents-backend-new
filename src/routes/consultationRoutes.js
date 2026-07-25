const express = require("express");
const router = express.Router();
const {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
  getAllConsultationsByDoctor,
  getConsultationsByDoctorId, //

  getAIRecommendation,
  getMedicationSuggestions,
} = require("../controllers/consultationController");
const { uploadLabFiles } = require("../controllers/labFilesController");
const { labFilesUpload } = require("../middleware/labFilesUpload.middleware");

const authMiddleware = require("../middleware/auth.middleware");
const adminMiddleware = require("../middleware/admin.middleware");
const checkSubscription = require("../middleware/checkSubscription.middleware");
router.use(authMiddleware);
router.use(checkSubscription);

// دي بترجع كونسلتيشنز كل الدكاترة - أدمن بس. الدكتور العادي يستخدم
// /doctor (getAllConsultationsByDoctor) اللي بتفلتر بتاعته هو بس.
router
  .route("/")
  .get(adminMiddleware, getAllConsultations)
  .post(createConsultation);
router.route("/doctor").get(getAllConsultationsByDoctor);
router.route("/ai-recommendation").post(getAIRecommendation);
router.route("/medication-suggestions").post(getMedicationSuggestions);

// رفع ملفات التحاليل المعملية/تقارير الأشعة (اختياري) - بيرجع ميتاداتا
// الملفات بس (رابط + اسم + نوع + حجم)، مش بيحفظهم على كونسلتيشن معينة.
// الفرونت بيحتفظ بالميتاداتا دي في الفورم وبيبعتها مع باقي البيانات لما
// يعمل Get AI Recommendation أو يحفظ الكونسلتيشن/الفولو أب نفسه.
router
  .route("/lab-files")
  .post(labFilesUpload.array("files", 6), uploadLabFiles);

router.route("/by-doctor/:doctorId").get(getConsultationsByDoctorId); //

router
  .route("/:id")
  .get(getConsultationById)
  .put(updateConsultation)
  .delete(deleteConsultation);
module.exports = router;
