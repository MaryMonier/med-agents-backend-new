const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const {
  GEMINI_API_KEY,
  NVIDIA_API_KEY,
  GROQ_API_KEY,
} = require("../config/env");

// ============================================================
// الترتيب: Gemini -> Groq (مستقل) -> Llama (على NVIDIA)
// كل واحد فيهم بمفتاحه ومنصته الخاصة بيه - مفيش اعتماد مشترك بين حد وحد
// ============================================================

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

// Groq (console.groq.com) - مستقل، مش عن طريق NVIDIA. متوافق مع صيغة
// OpenAI. كوتة يومية مجانية سخية جدًا مقارنة بـ Gemini (1000-14400
// طلب/يوم حسب الموديل، بدل 20 طلب/يوم بس على Gemini الفري تير). موديلات
// Groq مفتوحة المصدر وبتتغيّر بسرعة أحيانًا (زي ما حصل مع llama-4-scout
// اللي اتشال في يونيو 2026) - لو الموديل تحت اختفى، غيّره من هنا بس من
// غير أي تعديل تاني في باقي الكود
const groq = GROQ_API_KEY
  ? new OpenAI({
      apiKey: GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : null;

const nvidia = NVIDIA_API_KEY
  ? new OpenAI({
      apiKey: NVIDIA_API_KEY,
      baseURL: "https://integrate.api.nvidia.com/v1",
    })
  : null;

// موديلان من Gemini بكوتة يومية منفصلة لكل واحد فيهم (مش مشتركة) - يعني
// عمليًا بنضاعف فرصة النجاح على Gemini نفسه قبل ما ننزل لـ Groq خالص.
// gemini-3-flash-preview أحدث (وأقوى غالبًا) فبيتجرب الأول، ولو كوتته
// خلصت (أو فشل لأي سبب)، بيتجرب gemini-2.5-flash قبل النزول لـ Groq
const GEMINI_MODEL_PRIMARY = "gemini-3-flash-preview";
const GEMINI_MODEL = "gemini-2.5-flash";
// موديل Qwen بيقرا صور فعليًا على Groq (تحقّق يوليو 2026) - ملحوظة: حاليًا
// preview مش production-grade رسميًا، وتشكيلة موديلات الصور على Groq
// بتتغيّر بسرعة، فلو اختفى غيّره من هنا بس
const GROQ_MODEL = "qwen/qwen3.6-27b";
// موديل تاني مختلف تمامًا (Llama من Meta) على منصة NVIDIA - ملاذ أخير
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * بياخد نفس شكل params اللي كل الـ agents كانت مستخدماه قديمًا:
 * { messages: [{role:'system'|'user'|'assistant', content}], temperature, max_tokens, jsonMode, thinkingBudget }
 * وبيرجع نفس شكل رد OpenAI/Groq القديم: response.choices[0].message.content
 * عشان كل الكود اللي بيستخدمه (agents) يفضل شغال من غير أي تعديل تاني.
 *
 * الترتيب: Gemini -> Groq -> Llama (على NVIDIA)
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

  // 1. Gemini - نجرب الموديل الأحدث الأول، ولو فشل (كوتة أو أي خطأ)،
  // نجرب موديل Gemini التاني (كوتة منفصلة) قبل ما ننزل لـ Groq
  if (gemini) {
    const geminiContents = conversation.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    for (const model of [GEMINI_MODEL_PRIMARY, GEMINI_MODEL]) {
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

        return {
          choices: [{ message: { content: response.text } }],
          provider: "gemini",
        };
      } catch (err) {
        console.log(`Gemini (${model}) failed...`, err.message);
      }
    }
    console.log("All Gemini models failed, falling back to Groq...");
  }

  // 2. Groq (مستقل)
  if (groq) {
    try {
      const response = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        temperature,
        max_tokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return { ...response, provider: "groq" };
    } catch (err) {
      console.log(
        "Groq failed (strict JSON mode), retrying without it...",
        err.message,
      );

      // نفس فكرة openai.service.js - قبل ما ننزل لـ NVIDIA، نجرب Groq
      // مرة تانية من غير إجبار JSON صارم، لأن موديل Qwen (preview)
      // أحيانًا بيتعثر في الالتزام الصارم بالصيغة مش في الاتصال نفسه
      if (jsonMode) {
        try {
          const retryMessages = messages.map((m) =>
            m.role === "system"
              ? {
                  ...m,
                  content: `${m.content}\n\nIMPORTANT: Respond with ONLY valid JSON, no extra text, no markdown code fences.`,
                }
              : m,
          );

          const retryResponse = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: retryMessages,
            temperature,
            max_tokens,
          });

          return { ...retryResponse, provider: "groq" };
        } catch (retryErr) {
          console.log(
            "Groq retry also failed, falling back to Llama...",
            retryErr.message,
          );
        }
      }
    }
  }

  // 3. Llama على NVIDIA (ملاذ أخير)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا Groq ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
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
  groq,
  nvidia,
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL,
  GROQ_MODEL,
  NVIDIA_MODEL,
};
