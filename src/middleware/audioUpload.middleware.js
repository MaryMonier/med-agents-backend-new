const multer = require("multer");

// بنستخدم memoryStorage مش diskStorage - الملف الصوتي مؤقت بس (بيتبعت لـ
// Groq فورًا وبيترمي بعدها)، مفيش داعي نخزّنه على الديسك خالص زي ملفات
// التحاليل. الميزة دي بتقلل مساحة تخزين وتبسّط تنظيف الملفات القديمة.
const storage = multer.memoryStorage();

const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/wave",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
];

const fileFilter = (req, file, cb) => {
  if (ALLOWED_AUDIO_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported audio format."));
  }
};

const audioUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB - كفاية لدقائق كتير من الكلام
  },
});

module.exports = { audioUpload };
