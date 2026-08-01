const express = require("express");
const router = express.Router();
const { transcribe } = require("../controllers/transcriptionController");
const { audioUpload } = require("../middleware/audioUpload.middleware");
const authMiddleware = require("../middleware/auth.middleware");

// محمي بـ auth بس (مش checkSubscription) - ميزة مساعدة صغيرة، مش عايزين
// نمنعها عن دكتور اشتراكه خلص لمجرد إنها تسهّل الكتابة
router.use(authMiddleware);

router.route("/").post(audioUpload.single("audio"), transcribe);

module.exports = router;
