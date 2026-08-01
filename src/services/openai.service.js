const {
  gemini,
  nvidia,
  isValidJson,
  GEMINI_MODELS,
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
  // بيشوف كل الأنواع (صور + PDF). NVIDIA/Llama-4-Maverick بيشوف الصور بس
  // (image_url بصيغة OpenAI-compatible) - مش PDF.
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

  const imageFileParts = fileParts.filter(
    (f) => f.mimeType && f.mimeType.startsWith("image/"),
  );
  const nvidiaUserContent =
    imageFileParts.length > 0
      ? [
          { type: "text", text: userMessage },
          ...imageFileParts.map((f) => ({
            type: "image_url",
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
          })),
        ]
      : userMessage;

  // Gemini - نجرب كل الموديلات التلاتة بالترتيب (كل واحد كوتة يومية
  // منفصلة تمامًا) قبل ما ننزل لـ NVIDIA
  if (gemini) {
    for (const model of GEMINI_MODELS) {
      try {
        const response = await gemini.models.generateContent({
          model,
          contents: geminiContents,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.3,
            ...(jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        });

        if (jsonMode && !isValidJson(response.text)) {
          throw new Error("Gemini returned non-JSON content despite jsonMode");
        }

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
      } catch (err) {
        console.log(`Gemini (${model}) failed...`, err.message);
      }
    }
    console.log("All Gemini models failed, falling back to Llama...");
  }

  // Llama-4-Maverick fallback (ملاذ أخير، على NVIDIA) - بيقرا صور فعليًا
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
    );
  }

  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    max_tokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: nvidiaUserContent },
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
        model: GEMINI_MODELS[0],
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

    throw new Error("لا Gemini ولا NVIDIA شغالين");
  } catch (error) {
    throw new Error(`Streaming failed: ${error.message}`);
  }
};

module.exports = { chatCompletion, streamCompletion };
