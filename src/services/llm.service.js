const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const { GEMINI_API_KEY, NVIDIA_API_KEY } = require("../config/env");

// ============================================================
// الموديلات التلاتة بالترتيب: Gemini (أساسي) -> DeepSeek -> Llama
// ✅ الاتنين (DeepSeek وLlama) بيشتغلوا من نفس المنصة المجانية بالكامل:
// NVIDIA NIM (build.nvidia.com) - مفتاح واحد بس (NVIDIA_API_KEY)، من غير
// كارت ائتمان. السبب إننا مش بنستخدم API الرسمي بتاع DeepSeek مباشرة: ده
// مدفوع (مفيهوش free tier دائم)، لكن NVIDIA مستضيفة نفس موديل DeepSeek
// مجانًا على منصتها - فبناخد نفس التنوع بين موديلين مختلفين (لو موديل واحد
// فيه مشكلة وقتية، التاني غالبًا لأ) من غير أي تكلفة خالص.
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

const GEMINI_MODEL = "gemini-2.5-flash";
// موديل DeepSeek نفسه، لكن مستضاف مجانًا على NVIDIA NIM (مش على API
// الرسمي المدفوع بتاع DeepSeek)
const DEEPSEEK_MODEL = "deepseek-ai/deepseek-v4-flash";
// موديل تاني مختلف تمامًا (Llama من Meta) على نفس منصة NVIDIA - ملاذ أخير
// لو DeepSeek نفسه كان فيه مشكلة وقتية
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * بياخد نفس شكل params اللي كل الـ agents كانت مستخدماه قديمًا:
 * { messages: [{role:'system'|'user'|'assistant', content}], temperature, max_tokens, jsonMode, thinkingBudget }
 * وبيرجع نفس شكل رد OpenAI/Groq القديم: response.choices[0].message.content
 * عشان كل الكود اللي بيستخدمه (agents) يفضل شغال من غير أي تعديل تاني.
 *
 * الترتيب: Gemini أول -> DeepSeek (على NVIDIA) لو فشل -> Llama (على NVIDIA) لو كمان فشل.
 */
const callLLM = async ({
  messages,
  temperature = 0.3,
  max_tokens = 800,
  jsonMode = false,
  thinkingBudget = 150,
}) => {
  const systemPrompt =
    messages.find((m) => m.role === "system")?.content || "";
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
      console.log("Gemini failed, falling back to DeepSeek...", err.message);
    }
  }

  // 2. DeepSeek (مستضاف على NVIDIA)
  if (nvidia) {
    try {
      const response = await nvidia.chat.completions.create({
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

  // 3. Llama على NVIDIA (ملاذ أخير)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
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
  nvidia,
  GEMINI_MODEL,
  DEEPSEEK_MODEL,
  NVIDIA_MODEL,
};