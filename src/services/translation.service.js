const { chatCompletion } = require('./openai.service');

const translateToArabic = async (text) => {
  try {
    const result = await chatCompletion({
      systemPrompt: 'You are a medical translator. Translate the following medical text to Arabic accurately.',
      userMessage: text,
      language: 'ar'
    });
    return result.content;
  } catch (error) {
    return text;
  }
};

const getSystemPromptByLanguage = (language) => {
  if (language === 'ar') {
    return 'أنت مساعد طبي ذكي متخصص في الطب الباطني. أجب دائماً باللغة العربية بشكل دقيق ومهني.';
  }
  return 'You are an intelligent medical assistant specialized in internal medicine. Always respond in English accurately and professionally.';
};

module.exports = { translateToArabic, getSystemPromptByLanguage };