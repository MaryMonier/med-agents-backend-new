const {
  gemini,
  groq,
  nvidia,
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL,
  GROQ_MODEL,
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
  // بس هو اللي شايف كل أنواع الملفات فعليًا (vision) — Groq/NVIDIA
  // fallback نصي بس (مفيش عندهم الملفات دي أصلاً) إلا لو صورة، شوف تحت.
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

  // نفس فكرة geminiContents فوق، بس بصيغة Groq/OpenAI-compatible: content
  // array فيه نص + كل صورة كـ image_url بصيغة data URL. موديل Qwen على
  // Groq بيدعم vision فعليًا (على عكس NVIDIA/Llama اللي نصي بس)، فلو
  // Gemini سقط، الصور تفضل شغالة مع Groq بدل ما تختفي تمامًا. بنبعتله
  // الصور بس (image/*) - مش PDF، لأن صيغة الـ vision القياسية دي مخصصة
  // للصور مش للمستندات
  const imageFileParts = fileParts.filter(
    (f) => f.mimeType && f.mimeType.startsWith("image/"),
  );
  const groqUserContent =
    imageFileParts.length > 0
      ? [
          { type: "text", text: userMessage },
          ...imageFileParts.map((f) => ({
            type: "image_url",
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
          })),
        ]
      : userMessage;

  // Gemini - نجرب الموديل الأحدث الأول، ولو فشل (كوتة أو أي خطأ)، نجرب
  // الموديل التاني (كوتة يومية منفصلة تمامًا) قبل ما ننزل لـ Groq
  if (gemini) {
    for (const model of [GEMINI_MODEL_PRIMARY, GEMINI_MODEL]) {
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
    console.log("All Gemini models failed, falling back to Groq...");
  }

  // Groq fallback (مستقل)
  try {
    if (groq) {
      const response = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: groqUserContent },
        ],
        temperature: 0.3,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });

      return {
        content: response.choices[0].message.content,
        tokensUsed: response.usage?.total_tokens || 0,
        costUSD: 0,
        latencyMs: Date.now() - startTime,
        provider: "groq",
      };
    }
  } catch (err) {
    console.log(
      "Groq failed (strict JSON mode), retrying without it...",
      err.message,
    );

    // موديل Qwen (preview) أحيانًا بيتعثر في الالتزام الصارم بـ
    // response_format: json_object خصوصًا مع prompts طويلة. قبل ما ننزل
    // مباشرة لـ NVIDIA، بنجرب مرة واحدة تانية بنفس الموديل بس من غير
    // الإجبار الصارم، معتمدين بس على تعليمة النص في systemPrompt إنه
    // يرجّع JSON - ده بيقلل اعتمادنا على الملاذ الأخير (Llama) لمجرد
    // مشكلة تنسيق مش مشكلة حقيقية في الاتصال
    try {
      if (groq && jsonMode) {
        const retryResponse = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: `${systemPrompt}\n\nIMPORTANT: Respond with ONLY valid JSON, no extra text, no markdown code fences.`,
            },
            { role: "user", content: groqUserContent },
          ],
          temperature: 0.3,
        });

        return {
          content: retryResponse.choices[0].message.content,
          tokensUsed: retryResponse.usage?.total_tokens || 0,
          costUSD: 0,
          latencyMs: Date.now() - startTime,
          provider: "groq",
        };
      }
    } catch (retryErr) {
      console.log(
        "Groq retry also failed, falling back to Llama...",
        retryErr.message,
      );
    }
  }

  // Llama fallback (ملاذ أخير، على NVIDIA)
  if (!nvidia) {
    throw new Error(
      "لا Gemini ولا Groq ولا NVIDIA شغالين — لازم تحطي API key واحد منهم على الأقل",
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
        model: GEMINI_MODEL_PRIMARY,
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

    if (groq) {
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

    throw new Error("لا Gemini ولا Groq ولا NVIDIA شغالين");
  } catch (error) {
    throw new Error(`Streaming failed: ${error.message}`);
  }
};

module.exports = { chatCompletion, streamCompletion };
