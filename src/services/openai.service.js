const OpenAI = require('openai');
const Groq = require('groq-sdk');
const { OPENAI_API_KEY, GROQ_API_KEY } = require('../config/env');

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const groq = new Groq({ apiKey: GROQ_API_KEY });

const chatCompletion = async ({ systemPrompt, userMessage }) => {
  const startTime = Date.now();

  // OpenAI أول، لو فشلت → Groq
  try {
    if (openai) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
      });
      return {
        content: response.choices[0].message.content,
        tokensUsed: response.usage.total_tokens,
        costUSD: (response.usage.total_tokens / 1000) * 0.0001,
        latencyMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    console.log('OpenAI failed, falling back to Groq...');
  }

  // Groq fallback
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
  });

  return {
    content: response.choices[0].message.content,
    tokensUsed: response.usage.total_tokens,
    costUSD: 0,
    latencyMs: Date.now() - startTime,
  };
};

const streamCompletion = async ({ systemPrompt, userMessage, res }) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const client = openai || groq;
    const model = openai ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile';

    const stream = await client.chat.completions.create({
      model,
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