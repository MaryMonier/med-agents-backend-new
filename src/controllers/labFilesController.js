const path = require("path");

/**
 * POST /api/consultations/lab-files
 *
 * بيستقبل واحد أو أكتر من ملفات التحاليل المعملية/تقارير الأشعة (صور أو
 * PDF)، بيرفعهم على الديسك (عن طريق labFilesUpload middleware)، وبيرجّع
 * ميتاداتا كل ملف (مش الملف نفسه) عشان الفرونت يحتفظ بيها في الفورم لحد ما
 * الدكتور يحفظ الكونسلتيشن/الفولو أب فعليًا.
 *
 * الرفع منفصل عن حفظ الكونسلتيشن عن قصد: الدكتور ممكن يرفع الملفات، يجرب
 * "Get AI Recommendation" أكتر من مرة، ويعدّل في باقي الفورم — من غير ما
 * يعيد رفع الملفات كل مرة.
 */
const uploadLabFiles = (req, res) => {
  try {
    const files = req.files || [];

    if (!files.length) {
      return res
        .status(400)
        .json({ success: false, message: "No files were uploaded" });
    }

    const data = files.map((file) => ({
      // مسار نسبي بيتخدم من express.static (اتسجل في app.js) - الفرونت
      // بيحوله لرابط كامل بضم الـ API base URL قبله
      url: `/uploads/lab-files/${file.filename}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
    }));

    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { uploadLabFiles };
