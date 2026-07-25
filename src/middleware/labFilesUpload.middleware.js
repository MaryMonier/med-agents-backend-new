const multer = require("multer");
const path = require("path");
const fs = require("fs");

// المجلد اللي هيتخزن فيه ملفات التحاليل/الأشعة على السيرفر (لوكال ديسك).
// بننشئه لو مش موجود عشان أول upload ميفشلش.
const UPLOAD_DIR = path.join(__dirname, "../../uploads/lab-files");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// أنواع الملفات المسموحة بس: صور (نتيجة تحليل/أشعة متصورة) وPDF (تقرير
// أشعة/تحليل مكتوب). أي نوع تاني بيترفض من غير ما يوصل للديسك خالص.
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Unsupported file type. Only images (JPG, PNG, WEBP, HEIC) and PDF files are allowed.",
      ),
    );
  }
};

const labFilesUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB لكل ملف
    files: 6, // أقصى عدد ملفات في الطلب الواحد
  },
});

module.exports = { labFilesUpload, UPLOAD_DIR, ALLOWED_MIME_TYPES };
