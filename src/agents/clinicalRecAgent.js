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

Your answer MUST be organized in this exact order of reasoning:
1. First, read and interpret the clinical picture (the "reading"): what the symptoms/notes
   indicate clinically, any relevant patterns, and (for follow-ups) how the patient's condition
   has changed since the last visit.
2. Second, based on that reading, list the diagnosis or differential diagnoses you are
   considering — the most likely one first.
3. Third, if there is a standard clinical protocol, guideline-based next step, or medication
   class typically indicated for this presentation, state it. If nothing specific applies
   (not enough information, or the input has no real medical content), say so plainly instead
   of inventing one.

URGENCY LEVEL DEFINITIONS:
- "low": mild medical symptoms (cold, mild headache, minor fatigue, skin rash)
- "medium": symptoms needing attention (high fever, severe cough, persistent pain)
- "critical": life-threatening symptoms (chest pain, stroke, difficulty breathing)
- "unknown": input has NO medical content whatsoever (e.g. "hello", "test 123", random text)

IMPORTANT: If rawInput and symptoms contain NO medical terms at all, you MUST return "unknown"
for urgencyLevel, an empty possibleDiagnoses array, and say there is no protocol to follow.
    `;

  const userMessage = `
Doctor Input: ${rawInput}
Symptoms: ${formattedSymptoms}
Diagnosis: ${diagnosis || "Not yet determined"}
Patient age: ${patientAge !== null ? `${patientAge} years old` : "Unknown"}
Patient gender: ${patientGender || "Unknown"}

Return JSON only, in this exact shape:
{
  "clinicalReading": "... your interpretation of the clinical picture, 1-3 sentences ...",
  "possibleDiagnoses": ["most likely diagnosis", "next possibility", "..."],
  "recommendedProtocol": "... the standard protocol / medication class / next clinical step to follow, or a clear statement that none applies ...",
  "suggestedSpecialist": "...",
  "urgencyLevel": "low | medium | critical | unknown"
}
    `;

  // الموديل (خصوصًا Groq fallback) ممكن يرجع JSON ناقص أو متلخبط من غير سبب واضح
  // كل شوية، فبدل ما نرجّع نتيجة وهمية بصمت، بنعيد المحاولة لحد 3 مرات قبل
  // ما نبلّغ الكولر بفشل حقيقي (يخلي الدكتور ميحتاجش يدوس الزرار كذا مرة بنفسه)
  const MAX_ATTEMPTS = 3;
  let lastError;

  // بنبني نص "structuredNote" التقليدي (اللي بيتخزن في الكونسلتيشن) من
  // القطع التلاتة، بعناوين واضحة، عشان أي حد بيقرا الحقل ده بس (تخزين قديم،
  // تعليمات الفولو أب، إلخ) يشوف نفس الترتيب المطلوب: القراية، بعدين
  // التشخيصات، بعدين البروتوكول
  const composeStructuredNote = (parsed) => {
    const readingLabel =
      language === "ar" ? "القراءة السريرية" : "Clinical Reading";
    const diagnosesLabel =
      language === "ar" ? "التشخيصات المحتملة" : "Possible Diagnoses";
    const protocolLabel =
      language === "ar"
        ? "البروتوكول/الأدوية الموصى بها"
        : "Recommended Protocol";

    const diagnosesText = (parsed.possibleDiagnoses || []).length
      ? parsed.possibleDiagnoses.map((d, i) => `${i + 1}. ${d}`).join("\n")
      : language === "ar"
        ? "لا يوجد"
        : "None";

    return [
      `${readingLabel}:\n${parsed.clinicalReading}`,
      `${diagnosesLabel}:\n${diagnosesText}`,
      `${protocolLabel}:\n${parsed.recommendedProtocol}`,
    ].join("\n\n");
  };

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
        typeof parsed.clinicalReading !== "string" ||
        !Array.isArray(parsed.possibleDiagnoses) ||
        typeof parsed.recommendedProtocol !== "string" ||
        typeof parsed.suggestedSpecialist !== "string" ||
        !allowedUrgency.includes(parsed.urgencyLevel)
      ) {
        throw new Error("Invalid AI response structure");
      }

      return {
        // الشكل القديم (لسه بيتخزن وبيتقرا من أماكن تانية في السيستم)
        structuredNote: composeStructuredNote(parsed),
        suggestedSpecialist: parsed.suggestedSpecialist,
        urgencyLevel: parsed.urgencyLevel,
        // القطع المنظمة الخام - يستخدمها الفرونت يعرضهم في 3 أقسام منفصلة
        clinicalReading: parsed.clinicalReading,
        possibleDiagnoses: parsed.possibleDiagnoses,
        recommendedProtocol: parsed.recommendedProtocol,
      };
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
