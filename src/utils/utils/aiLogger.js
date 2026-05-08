const AILog = require('../models/AILog');

const logAICall = async ({ consultationId, agentName, reasoningTrace, tokensUsed, costUSD, latencyMs, success, errorMessage }) => {
  try {
    await AILog.create({
      consultationId,
      agentName,
      reasoningTrace,
      tokensUsed,
      costUSD,
      latencyMs,
      success,
      errorMessage
    });
  } catch (error) {
    console.error('AI Log failed:', error.message);
  }
};

module.exports = logAICall;