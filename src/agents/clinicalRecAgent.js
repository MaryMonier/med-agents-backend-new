const { chatCompletion } = require('../services/openai.service');
const { retrieve, formatContext } = require('../services/pinecone.service');

const runClinicalRecAgent = async ({
  rawInput = "",
  symptoms = [],
  diagnosis = "",
  language = "en",
}) => {
  const formattedSymptoms = Array.isArray(symptoms) && symptoms.length
    ? symptoms.join(", ")
    : "Not specified";

  try {
    const ragDocs = await retrieve(formattedSymptoms, language, 3);
    const context = formatContext(ragDocs, language);

    const systemPrompt = `
You are a clinical recommendation assistant for licensed doctors.
Use the following medical guidelines:
${context}

STRICT RULES:
- Respond ONLY in ${language === "ar" ? "Arabic" : "English"}
- Output ONLY valid JSON, no extra text


URGENCY LEVEL DEFINITIONS:
- "low": mild medical symptoms (cold, mild headache, minor fatigue, skin rash)
- "medium": symptoms needing attention (high fever, severe cough, persistent pain)
- "critical": life-threatening symptoms (chest pain, stroke, difficulty breathing)
- "unknown": input has NO medical content whatsoever (e.g. "hello", "test 123", random text)

IMPORTANT: If rawInput and symptoms contain NO medical terms at all, you MUST return "unknown".
    `;

    const userMessage = `
Doctor Input: ${rawInput}
Symptoms: ${formattedSymptoms}
Diagnosis: ${diagnosis || "Not yet determined"}

Return JSON only:
{
  "structuredNote": "...",
  "suggestedSpecialist": "...",
  "urgencyLevel": "low | medium | critical | unknown"
}
    `;

    const result = await chatCompletion({ systemPrompt, userMessage });
    const cleaned = result.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const allowedUrgency = ["low", "medium", "critical", "unknown"];
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