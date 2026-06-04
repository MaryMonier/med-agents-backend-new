



const { chatCompletion } = require('../services/openai.service');
// const { retrieve, formatContext } = require('../services/rag.service');
const { retrieve, formatContext } = require('../services/pinecone.service'); // ✅

const runClinicalRecAgent = async ({
  rawInput = "",
  symptoms = [],
  diagnosis = "",
  language = "en",
}) => {
  const formattedSymptoms =
    Array.isArray(symptoms) && symptoms.length
      ? symptoms.join(", ")
      : "Not specified";

  try {
    // جيب الـ RAG context
    // const ragDocs = await retrieve(formattedSymptoms, language);
    const ragDocs = await retrieve(formattedSymptoms, language, 3);
    const context = formatContext(ragDocs, language);

    const systemPrompt = `
You are a clinical recommendation assistant for doctors.
Use the following medical guidelines to inform your response:
${context}

STRICT RULES:
- Respond ONLY in ${language === "ar" ? "Arabic" : "English"}
- Output ONLY valid JSON
- Never provide final diagnosis
- If uncertain, urgencyLevel must be "critical"
    `;

    const userMessage = `
Doctor Input: ${rawInput}
Symptoms: ${formattedSymptoms}
Diagnosis: ${diagnosis || "Not yet determined"}

Return JSON:
{
  "structuredNote": "...",
  "suggestedSpecialist": "...",
  "urgencyLevel": "low | medium | critical"
}
    `;

    const result = await chatCompletion({ systemPrompt, userMessage });
    const cleaned = result.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const allowedUrgency = ["low", "medium", "critical"];
    if (
      typeof parsed.structuredNote !== "string" ||
      typeof parsed.suggestedSpecialist !== "string" ||
      !allowedUrgency.includes(parsed.urgencyLevel)
    ) {
      throw new Error("Invalid AI response structure");
    }

    return parsed;

  } catch (error) {
    console.error("AI Error:", error);
    return {
      error: true,
      message: "AI request failed",
      fallback: {
        structuredNote: "Unable to generate clinical summary",
        suggestedSpecialist: "General Practitioner",
        urgencyLevel: "medium",
      },
    };
  }
};

module.exports = { runClinicalRecAgent };