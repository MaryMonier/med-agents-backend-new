const { chatCompletion } = require("../services/openai.service");
const { retrieve, formatContext } = require("../services/pinecone.service");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runClinicalRecAgent = async ({
  rawInput = "",
  symptoms = [],
  diagnosis = "",
  language = "en",
  isFollowup = false,
  previousDiagnosis = "",
  previousSymptoms = "",
  previousInstructions = "",
  previousPrescription = "",
  patientAge = null,
  patientGender = null,
}) => {
  const formattedSymptoms =
    Array.isArray(symptoms) && symptoms.length
      ? symptoms.join(", ")
      : "Not specified";

  // لو الـ RAG retrieval فشل، نكمّل من غير context بدل ما نفشّل الطلب كله
  let context = "";
  try {
    const ragDocs = await retrieve(formattedSymptoms, language, 3);
    context = formatContext(ragDocs, language);
  } catch (ragError) {
    console.error(
      "RAG retrieval failed, continuing without context:",
      ragError.message,
    );
  }

  const followupBlock =
    isFollowup &&
    (previousDiagnosis ||
      previousSymptoms ||
      previousInstructions ||
      previousPrescription)
      ? `
This is a FOLLOW-UP visit. Here is what was recorded at the PREVIOUS visit for the SAME patient:
- Previous diagnosis: ${previousDiagnosis || "Not recorded"}
- Previous symptoms: ${previousSymptoms || "Not recorded"}
- Previous doctor's note / instructions: ${previousInstructions || "Not recorded"}
- Medications prescribed at that visit: ${previousPrescription || "None recorded"}

You MUST explicitly compare the patient's CURRENT presentation (below) against the previous
visit above, and state in the structuredNote whether the patient has improved, stayed the
same, or gotten worse — and why (e.g. symptom resolved, new symptom appeared, same complaint
persists despite treatment). Take the medications they were already prescribed into account
when judging response to treatment (e.g. "still symptomatic despite being on X"). Do not
treat this as a brand-new, unrelated case.
`
      : "";

  const systemPrompt = `
You are a clinical recommendation assistant for licensed doctors.
Use the following medical guidelines:
${context}
${followupBlock}
STRICT RULES:
- Respond ONLY in ${language === "ar" ? "Arabic" : "English"}
- Output ONLY valid JSON, no extra text
- ALWAYS factor the patient's age and gender (given below) into your reasoning BEFORE settling
  on a diagnosis/urgency — some conditions are age- or gender-specific, more/less likely at
  certain ages, or present differently by age (e.g. pediatric vs. elderly presentations,
  pregnancy-related considerations for female patients of reproductive age, age-typical causes
  of a given symptom). If age or gender is unknown, reason as generally as the evidence allows
  and don't assume unstated demographic risk factors.

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
Patient age: ${patientAge !== null ? `${patientAge} years old` : "Unknown"}
Patient gender: ${patientGender || "Unknown"}

Return JSON only:
{
  "structuredNote": "...",
  "suggestedSpecialist": "...",
  "urgencyLevel": "low | medium | critical | unknown"
}
    `;

  // الموديل (خصوصًا Groq fallback) ممكن يرجع JSON ناقص أو متلخبط من غير سبب واضح
  // كل شوية، فبدل ما نرجّع نتيجة وهمية بصمت، بنعيد المحاولة لحد 3 مرات قبل
  // ما نبلّغ الكولر بفشل حقيقي (يخلي الدكتور ميحتاجش يدوس الزرار كذا مرة بنفسه)
  const MAX_ATTEMPTS = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await chatCompletion({ systemPrompt, userMessage });
      const cleaned = result.content.replace(/```json|```/g, "").trim();
      // لو رجع كلام زيادة قبل/بعد الـ JSON رغم json_object mode، بنطلع
      // الجزء اللي من أول { لحد آخر } بس
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

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
      lastError = error;
      console.error(
        `AI Error (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        error.message,
      );
      if (attempt < MAX_ATTEMPTS) {
        await delay(700 * attempt);
      }
    }
  }

  // كل المحاولات فشلت فعلاً → نرمي الخطأ عشان الكنترولر يرجّع إيرور حقيقي
  // (مش fallback مزيف) فالـ retry اللي في الفرونت إند يقدر يتصرف صح
  throw new Error(
    lastError?.message || "AI request failed after multiple attempts",
  );
};

module.exports = { runClinicalRecAgent };
