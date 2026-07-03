const Groq = require('groq-sdk');
const { GROQ_API_KEY } = require('../config/env');

const groq = new Groq({ apiKey: GROQ_API_KEY });

// بنكتشف تحديدًا لو الخطأ ده بسبب rate limit (429) — عشان الكولر يقدر
// يتصرف بحكمة (يوقف الـ retry فورًا بدل ما يحاول تاني في نفس الدقيقة
// وهيفشل بنفس الطريقة)، ويورّي رسالة واضحة للدكتور بدل الـ JSON الخام
const isRateLimitError = (err) => {
  return (
    err?.status === 429 ||
    err?.error?.code === 'rate_limit_exceeded' ||
    /rate limit/i.test(err?.message || '')
  );
};

const chatCompletion = async ({ systemPrompt, userMessage, jsonMode = true }) => {
  const startTime = Date.now();

  // jsonMode بيفرض على الموديل إنه يرجّع JSON صالح فعلاً (مش بس نطلب منه في
  // البرومبت) — ده بيقفل غالبية حالات الفشل اللي كانت بتحصل لما الموديل
  // يضيف كلام زيادة قبل/بعد الـ JSON أو يرجّع شكل ملخبط
  const responseFormat = jsonMode ? { type: 'json_object' } : undefined;

  // معندناش OpenAI key، فبنعتمد على Groq بس — لكن سايبين الـ try/catch عشان
  // نكتشف أخطاء الـ rate limit ونرجّع رسالة واضحة للفرونت بدل الـ JSON الخام
  try {
    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    return {
      content: response.choices[0].message.content,
      tokensUsed: response.usage.total_tokens,
      costUSD: 0,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    if (isRateLimitError(err)) {
      const cleanError = new Error(
        "You've reached your plan's daily limit for AI-powered recommendations. Please upgrade your subscription to continue using this feature.",
      );
      cleanError.isRateLimit = true;
      throw cleanError;
    }
    throw err;
  }
};

const streamCompletion = async ({ systemPrompt, userMessage, res }) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const stream = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      temperature: 0.3,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    throw new Error(`Streaming failed: ${error.message}`);
  }
};

module.exports = { chatCompletion, streamCompletion };
