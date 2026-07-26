const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");
const { GEMINI_API_KEY, GROQ_API_KEY } = require("../config/env");

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "openai/gpt-oss-120b";

const chatCompletion = async ({
  systemPrompt,
  userMessage,
  jsonMode = true,
  fileParts = [],
}) => {
  const startTime = Date.now();

  // لو فيه ملفات مرفقة (صور/PDF)، بنبني contents كـ array من parts (نص +
  // كل ملف كـ inlineData) بدل ما نبعت userMessage كـ string عادي. Gemini
  // بس هو اللي شايف الملفات فعليًا (vision) — Groq fallback نصي بس.
  const geminiContents =
    fileParts.length > 0
      ? [
          {
            role: "user",
            parts: [
              { text: userMessage },
              ...fileParts.map((f) => ({
                inlineData: { mimeType: f.mimeType, data: f.data },
              })),
            ],
          },
        ]
      : userMessage;

  // Gemini أول، لو فشلت أو مش متظبطة → Groq
  try {
    if (gemini) {
      const response = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents: geminiContents,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.3,
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      });

      // usageMetadata بترجع عدد التوكينز المستخدمة فعليًا (input + output)
      const tokensUsed =
        (response.usageMetadata?.promptTokenCount || 0) +
        (response.usageMetadata?.candidatesTokenCount || 0);

      return {
        content: response.text,
        tokensUsed,
        costUSD: 0, // Gemini free tier
        latencyMs: Date.now() - startTime,
        // مضمون من الكود - مش افتراض. أي كولر بيحتاج يعرف "هل الملفات
        // اتقرت فعليًا" لازم يتحقق من الحقل ده بدل ما يفترض إن Gemini
        // اشتغل دايمًا
        provider: "gemini",
      };
    }
  } catch (err) {
    console.log("Gemini failed, falling back to Groq...", err.message);
  }

  // Groq fallback
  if (!groq) {
    throw new Error(
      "لا Gemini ولا Groq شغالين — لازم تحطي API key واحد منهم على الأقل",
    );
  }

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return {
    content: response.choices[0].message.content,
    tokensUsed: response.usage.total_tokens,
    costUSD: 0,
    latencyMs: Date.now() - startTime,
    // Groq نصي بس - لو كان فيه fileParts في الطلب ده، اعتبريها ماتقرتش خالص
    provider: "groq",
  };
};

const streamCompletion = async ({ systemPrompt, userMessage, res }) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  try {
    if (gemini) {
      const stream = await gemini.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.3,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!groq) throw new Error("لا Gemini ولا Groq شغالين");

    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
      temperature: 0.3,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    throw new Error(`Streaming failed: ${error.message}`);
  }
};

module.exports = { chatCompletion, streamCompletion };