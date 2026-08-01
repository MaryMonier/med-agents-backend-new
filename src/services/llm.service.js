const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const { GEMINI_API_KEY, NVIDIA_API_KEY } = require("../config/env");

// بيدوّر على أول { ... } كامل جوه النص - بيشيل أي markdown fences أو
// preamble/postamble نصي ممكن الموديل يحطه رغم تعليمة "JSON بس"
const extractJsonCandidate = (text) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

// بيتحقق فعليًا إن الرد قابل لل JSON.parse - مش بس بيفترض إن "200 OK"
// معناها إن المحتوى سليم
const isValidJson = (text) => {
  try {
    JSON.parse(extractJsonCandidate(text));
    return true;
  } catch {
    return false;
  }
};

// ============================================================
// الترتيب: 3 موديلات Gemini (كل واحد بكوتة يومية منفصلة) -> Llama (NVIDIA)
// Groq اتشال خالص (كان بيقع كتير ومش موثوق) - بدالها بقينا بنستخدم عدد
// أكبر من موديلات Gemini نفسها، بما إن كل موديل عنده "دلو" كوتة يومية
// منفصل تمامًا عن التاني (مؤكد من رسائل الخطأ: quotaId فيه PerModel)
// ============================================================

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

const nvidia = NVIDIA_API_KEY
  ? new OpenAI({
      apiKey: NVIDIA_API_KEY,
      baseURL: "https://integrate.api.nvidia.com/v1",
    })
  : null;

// 3 موديلات مختلفة من Gemini، بالترتيب من الأحدث/الأقوى للأقدم. كل واحد
// فيهم كوتة يومية منفصلة تمامًا (حتى بنفس GEMINI_API_KEY) - يعني عمليًا
// بنجرب 3 "محاولات مجانية" حقيقية قبل ما ننزل لـ NVIDIA. gemini-3.5-flash
// هو الإصدار المستقر (GA) الأحدث بديل gemini-3-flash-preview القديم
// (تحقّق يوليو 2026) - لو أي اسم منهم اتغيّر/اختفى مستقبلًا، غيّره من
// هنا بس من غير أي تعديل تاني في باقي الكود
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];
// موجودين هنا برضو عشان أي كود قديم بيستوردهم بالاسم القديم يفضل شغال
const GEMINI_MODEL_PRIMARY = GEMINI_MODELS[0];
const GEMINI_MODEL = GEMINI_MODELS[GEMINI_MODELS.length - 1];
// موديل Llama 4 Scout - متاح مجانًا على NVIDIA وبيدعم الصور فعليًا
// (multimodal). ملحوظة: كان عندنا Llama 4 Maverick قبل كده، لكن NVIDIA
// شالته رسميًا بتاريخ 27/7/2026 (رجّع 410 Gone) - Scout هو البديل
// المدعوم حاليًا (تحقّق أغسطس 2026). نفس مفتاح NVIDIA_API_KEY الموجود
const NVIDIA_MODEL = "meta/llama-4-scout-17b-16e-instruct";

/**
 * بياخد نفس شكل params اللي كل الـ agents كانت مستخدماه قديمًا:
 * { messages: [{role:'system'|'user'|'assistant', content}], temperature, max_tokens, jsonMode, thinkingBudget }
 * وبيرجع نفس شكل رد OpenAI القديم: response.choices[0].message.content
 * عشان كل الكود اللي بيستخدمه (agents) يفضل شغال من غير أي تعديل تاني.
 *
 * الترتيب: gemini-3.5-flash -> gemini-3-flash-preview -> gemini-2.5-flash
 * -> Llama (على NVIDIA)
 */
const callLLM = async ({
  messages,
  temperature = 0.3,
  max_tokens = 800,
  jsonMode = false,
  thinkingBudget = 150,
}) => {
  const systemPrompt = messages.find((m) => m.role === "system")?.content || "";
  const conversation = messages.filter((m) => m.role !== "system");

  // Gemini - نجرب كل الموديلات التلاتة بالترتيب (كل واحد كوتة منفصلة)
  // قبل ما ننزل لـ NVIDIA
  if (gemini) {
    const geminiContents = conversation.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    for (const model of GEMINI_MODELS) {
      try {
        const response = await gemini.models.generateContent({
          model,
          contents: geminiContents,
          config: {
            systemInstruction: systemPrompt,
            temperature,
            maxOutputTokens: max_tokens,
            thinkingConfig: { thinkingBudget },
            ...(jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        });

        if (jsonMode && !isValidJson(response.text)) {
          throw new Error("Gemini returned non-JSON content despite jsonMode");
        }

        return {
          choices: [{ message: { content: response.text } }],
          provider: "gemini",
        };
      } catch (err) {
        console.log(`Gemini (${model}) failed...`, err.message);
      }
    }
    console.log("All Gemini models failed, falling back to Llama...");
  }

  // Llama على NVIDIA (ملاذ أخير)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
    );
  }

  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages,
    temperature,
    max_tokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return { ...response, provider: "nvidia" };
};

module.exports = {
  callLLM,
  gemini,
  nvidia,
  isValidJson,
  GEMINI_MODELS,
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL,
  NVIDIA_MODEL,
};
