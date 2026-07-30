const {
  gemini,
  kimi,
  deepseek,
  nvidia,
  GEMINI_MODEL,
  KIMI_MODEL,
  DEEPSEEK_MODEL,
  NVIDIA_MODEL,
} = require("./llm.service");

const chatCompletion = async ({
  systemPrompt,
  userMessage,
  jsonMode = true,
  fileParts = [],
}) => {
  const startTime = Date.now();

  // لو فيه ملفات مرفقة (صور/PDF)، بنبني contents كـ array من parts (نص +
  // كل ملف كـ inlineData) بدل ما نبعت userMessage كـ string عادي. Gemini
  // بس هو اللي شايف الملفات فعليًا (vision) — Kimi/DeepSeek/NVIDIA
  // fallback نصي بس (مفيش عندهم الملفات دي أصلاً).
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

  // نفس فكرة geminiContents فوق، بس بصيغة Kimi/OpenAI-compatible: content
  // array فيه نص + كل صورة كـ image_url بصيغة data URL. Kimi K3 بيدعم
  // vision فعليًا (على عكس DeepSeek وNVIDIA/Llama اللي نصيين بس)، فلو
  // Gemini سقط، الصور تفضل شغالة مع Kimi بدل ما تختفي تمامًا. بنبعتله
  // الصور بس (image/*) - مش PDF، لأن صيغة الـ vision القياسية دي مخصصة
  // للصور مش للمستندات
  const imageFileParts = fileParts.filter(
    (f) => f.mimeType && f.mimeType.startsWith("image/"),
  );
  const kimiUserContent =
    imageFileParts.length > 0
      ? [
          { type: "text", text: userMessage },
          ...imageFileParts.map((f) => ({
            type: "image_url",
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
          })),
        ]
      : userMessage;

  // Gemini أول، لو فشلت أو مش متظبطة → Kimi → DeepSeek (مستقل) → NVIDIA/Llama
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

      const tokensUsed =
        (response.usageMetadata?.promptTokenCount || 0) +
        (response.usageMetadata?.candidatesTokenCount || 0);

      return {
        content: response.text,
        tokensUsed,
        costUSD: 0,
        latencyMs: Date.now() - startTime,
        provider: "gemini",
      };
    }
  } catch (err) {
    console.log("Gemini failed, falling back to Kimi...", err.message);
  }

  // Kimi fallback (Moonshot AI - مستقل)
  try {
    if (kimi) {
      const response = await kimi.chat.completions.create({
        model: KIMI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: kimiUserContent },
        ],
        temperature: 0.3,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return {
        content: response.choices[0].message.content,
        tokensUsed: response.usage?.total_tokens || 0,
        costUSD: 0,
        latencyMs: Date.now() - startTime,
        provider: "kimi",
      };
    }
  } catch (err) {
    console.log("Kimi failed, falling back to DeepSeek...", err.message);
  }

  // DeepSeek fallback (الرسمي - مستقل عن NVIDIA)
  try {
    if (deepseek) {
      const response = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return {
        content: response.choices[0].message.content,
        tokensUsed: response.usage?.total_tokens || 0,
        costUSD: 0,
        latencyMs: Date.now() - startTime,
        provider: "deepseek",
      };
    }
  } catch (err) {
    console.log("DeepSeek failed, falling back to Llama...", err.message);
  }

  // Llama fallback (ملاذ أخير، على NVIDIA)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا Kimi ولا DeepSeek ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
    );
  }

  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
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
    provider: "nvidia",
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

    if (kimi) {
      const stream = await kimi.chat.completions.create({
        model: KIMI_MODEL,
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
      return;
    }

    if (deepseek) {
      const stream = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
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
      return;
    }

    if (nvidia) {
      const stream = await nvidia.chat.completions.create({
        model: NVIDIA_MODEL,
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
      return;
    }

    throw new Error("لا Gemini ولا Kimi ولا DeepSeek ولا NVIDIA شغالين");
  } catch (error) {
    throw new Error(`Streaming failed: ${error.message}`);
  }
};

module.exports = { chatCompletion, streamCompletion };
