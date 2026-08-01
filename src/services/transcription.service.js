const OpenAI = require("openai");
const { GROQ_API_KEY } = require("../config/env");

// Groq بيستضيف whisper-large-v3 مجانًا (كوتة يومية سخية) - نفس فكرة
// باقي المزوّدين المستقلين عندنا، بمفتاحه ومنصته الخاصة بيه
const groq = GROQ_API_KEY
  ? new OpenAI({
      apiKey: GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : null;

const WHISPER_MODEL = "whisper-large-v3";

/**
 * بياخد buffer صوتي (من multer memoryStorage) واسم الملف وبيرجّع النص
 * المُفرَّغ منه. لو language اتبعتت (زي "ar" أو "en")، بنمررها لـ Whisper
 * عشان تحسّن الدقة - مش إجبارية، Whisper بيكتشف اللغة تلقائيًا لو مش
 * موجودة.
 */
const transcribeAudio = async ({ buffer, filename, mimeType, language }) => {
  if (!groq) {
    throw new Error(
      "خدمة تحويل الصوت لنص مش متاحة - لازم تحطي GROQ_API_KEY في .env",
    );
  }

  // مكتبة openai محتاجة الملف بصيغة File/Blob مش Buffer خام - بنبنيها
  // من الـ buffer اللي multer رجّعه
  const file = await OpenAI.toFile(buffer, filename || "audio.webm", {
    type: mimeType,
  });

  const response = await groq.audio.transcriptions.create({
    file,
    model: WHISPER_MODEL,
    ...(language ? { language } : {}),
    response_format: "json",
  });

  return response.text?.trim() || "";
};

module.exports = { transcribeAudio };
