const Groq = require('groq-sdk');
const { GROQ_API_KEY } = require('../config/env');

const groq = new Groq({ apiKey: GROQ_API_KEY });

const chatCompletion = async ({ systemPrompt, userMessage }) => {
  const startTime = Date.now();

  try {
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

  } catch (error) {
    throw new Error(`Groq API failed: ${error.message}`);
  }
};

const streamCompletion = async ({ systemPrompt, userMessage, res }) => {
  try {
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      temperature: 0.3,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

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