const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const {
  GEMINI_API_KEY,
  NVIDIA_API_KEY,
  KIMI_API_KEY,
  DEEPSEEK_API_KEY,
} = require("../config/env");

// ============================================================
// الترتيب الجديد: Gemini -> Kimi -> DeepSeek (مستقل) -> Llama (على NVIDIA)
// كل واحد فيهم بمفتاحه ومنصته الخاصة بيه - مفيش اعتماد مشترك بين حد وحد،
// فلو منصة وقعت أو مفتاح فشل، الباقي شغالين تمامًا لوحدهم
// ============================================================

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

// Kimi (Moonshot AI) - مستقل، مش عن طريق NVIDIA. الـ SDK بتاعه متوافق مع
// OpenAI (نفس شكل client بتاع openai npm package بس بـ baseURL مختلف)
const kimi = KIMI_API_KEY
  ? new OpenAI({
      apiKey: KIMI_API_KEY,
      baseURL: "https://api.moonshot.ai/v1",
    })
  : null;

// DeepSeek الرسمي (api.deepseek.com) - مستقل تمامًا عن نسخة DeepSeek
// القديمة اللي كانت شغالة عن طريق NVIDIA. حساب ومفتاح منفصلين بالكامل
const deepseek = DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    })
  : null;

const nvidia = NVIDIA_API_KEY
  ? new OpenAI({
      apiKey: NVIDIA_API_KEY,
      baseURL: "https://integrate.api.nvidia.com/v1",
    })
  : null;

const GEMINI_MODEL = "gemini-2.5-flash";
const KIMI_MODEL = "kimi-k3";
// ملحوظة: "deepseek-v4" لوحدها مش ID رسمي - DeepSeek عندهم موديلين تحت
// اسم V4: deepseek-v4-flash (أسرع وأرخص) و deepseek-v4-pro (أدق للمهام
// الصعبة). مستخدمين flash هنا كافتراضي - غيّرها لـ deepseek-v4-pro لو
// عايز دقة أعلى بدل السرعة
const DEEPSEEK_MODEL = "deepseek-v4-flash";
// موديل تاني مختلف تمامًا (Llama من Meta) على منصة NVIDIA - ملاذ أخير
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * بياخد نفس شكل params اللي كل الـ agents كانت مستخدماه قديمًا:
 * { messages: [{role:'system'|'user'|'assistant', content}], temperature, max_tokens, jsonMode, thinkingBudget }
 * وبيرجع نفس شكل رد OpenAI/Groq القديم: response.choices[0].message.content
 * عشان كل الكود اللي بيستخدمه (agents) يفضل شغال من غير أي تعديل تاني.
 *
 * الترتيب: Gemini -> Kimi -> DeepSeek (مستقل) -> Llama (على NVIDIA)
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

  // 1. Gemini
  if (gemini) {
    try {
      const geminiContents = conversation.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const response = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents: geminiContents,
        config: {
          systemInstruction: systemPrompt,
          temperature,
          maxOutputTokens: max_tokens,
          thinkingConfig: { thinkingBudget },
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      });

      return {
        choices: [{ message: { content: response.text } }],
        provider: "gemini",
      };
    } catch (err) {
      console.log("Gemini failed, falling back to Kimi...", err.message);
    }
  }

  // 2. Kimi (Moonshot AI - مستقل)
  if (kimi) {
    try {
      const response = await kimi.chat.completions.create({
        model: KIMI_MODEL,
        messages,
        temperature,
        max_tokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return { ...response, provider: "kimi" };
    } catch (err) {
      console.log("Kimi failed, falling back to DeepSeek...", err.message);
    }
  }

  // 3. DeepSeek الرسمي (مستقل عن NVIDIA)
  if (deepseek) {
    try {
      const response = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        temperature,
        max_tokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return { ...response, provider: "deepseek" };
    } catch (err) {
      console.log("DeepSeek failed, falling back to Llama...", err.message);
    }
  }

  // 4. Llama على NVIDIA (ملاذ أخير)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا Kimi ولا DeepSeek ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
    );
  }

  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages,
    temperature,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return { ...response, provider: "nvidia" };
};

module.exports = {
  callLLM,
  gemini,
  kimi,
  deepseek,
  nvidia,
  GEMINI_MODEL,
  KIMI_MODEL,
  DEEPSEEK_MODEL,
  NVIDIA_MODEL,
};
