require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY,
  // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // ✅ مفيش DEEPSEEK_API_KEY منفصل - موديل DeepSeek نفسه بيشتغل مجانًا عن
  // طريق NVIDIA_API_KEY تحت (build.nvidia.com بيستضيفه مجانًا)
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  // Groq - مستقل تمامًا، مش عن طريق NVIDIA. بنستخدم موديل بيقرا صور
  // (qwen/qwen3.6-27b) مع كوتة يومية سخية جدًا مقارنة بـ Gemini
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // عنوان خدمة تصنيف صور الأمراض الجلدية المحلية (Python/FastAPI) - شوف
  // مجلد skin-classifier-service. لو مش موجودة القيمة دي، الميزة بتتعطل
  // بصمت من غير ما تكسر أي حاجة تانية في التطبيق
  SKIN_CLASSIFIER_URL: process.env.SKIN_CLASSIFIER_URL,

  // Paymob (Intention API - النظام الجديد)
  PAYMOB_SECRET_KEY: process.env.PAYMOB_SECRET_KEY,
  PAYMOB_PUBLIC_KEY: process.env.PAYMOB_PUBLIC_KEY,
  PAYMOB_INTEGRATION_ID: process.env.PAYMOB_INTEGRATION_ID,
  PAYMOB_HMAC_SECRET: process.env.PAYMOB_HMAC_SECRET,
};
