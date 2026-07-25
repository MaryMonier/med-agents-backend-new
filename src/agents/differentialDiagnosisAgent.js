const { chatCompletion } = require("../services/openai.service");
const { retrieve, formatContext } = require("../services/pinecone.service");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Differential Diagnosis Agent ──────────────────────────────────────────
// الإيجنت الرئيسي اللي بيشتغل مع الكونسلتيشن والفولو أب (بديل إيجنت
// "Clinical Recommendation" القديم). شغلته: ياخد كلام الدكتور + الأعراض
// ويرجّع تشخيص تفريقي حقيقي منظم: قراءة سريرية، بعدين ليستة تشخيصات تفريقية
// مرتبة بالأرجح الأول - كل تشخيص فيها معاه:
//   - الاحتمالية (high / moderate / low)
//   - الأسباب اللي بتخليه محتمل (supportingReasoning)
//   - الأسباب اللي بتخليه مش محتمل / أقل تأكيد (againstReasoning)
//   - الفحوصات/الأشعة الموصى بيها لإثبات أو استبعاد التشخيص ده (recommendedTests)
//   - بروتوكول العلاج الخاص بالتشخيص ده تحديدًا لو اتأكد (protocol) - مش
//     بروتوكول واحد عام للحالة كلها، كل تشخيص بروتوكوله مكتوب تحته مباشرة
// بالإضافة للتخصص المقترح ومستوى الخطورة - عشان أي حاجة معتمدة عليهم (توليد
// الريبورت، مقارنة الفولو أب بالزيارة اللي فاتت، الـ Patient History) تفضل
// شغالة من غير أي كسر.
//
// مستقل تمامًا عن إيجنت اقتراح الأدوية (medicationSuggestionAgent) - ده بياخد
// بس التشخيص اللي الدكتور دخله يدويًا + الأعراض + ملاحظات الدكتور، ومش بيقرا
// أي حاجة من الإيجنت ده خالص (لا clinicalReading ولا possibleDiagnoses).
const runDifferentialDiagnosisAgent = async ({
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
  // السياق الطبي المزمن للمريض - مهم جدًا في أي تشخيص تفريقي حقيقي (مثلاً
  // مريض سكري بيشتكي من عطش وتعب، أو مريض بيتعالج بأدوية بتأثر على الصورة
  // السريرية)
  allergies = [],
  chronicConditions = [],
  chronicMedications = [],
  // ملفات التحاليل المعملية/تقارير الأشعة اللي الدكتور رفعها (اختياري).
  // كل عنصر: { mimeType, data (base64), originalName }. بس Gemini (مش
  // Groq fallback) قادر يشوفهم فعليًا كصور/PDF — بنبعتهم كـ fileParts
  // لـ chatCompletion، وبنذكرهم في الـ prompt النصي كمان عشان أي fallback
  // نصي يعرف إنهم موجودين حتى لو مش قادر يفتحهم.
  labFiles = [],
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

You MUST explicitly compare the patient's CURRENT presentation (below) against the PREVIOUS
visit above:
- In "clinicalReading", state clearly whether the patient has improved, stayed the same, or
  gotten worse since the previous visit — and why (e.g. symptom resolved, new symptom
  appeared, same complaint persists despite treatment). Take the medications they were already
  prescribed into account when judging response to treatment (e.g. "still symptomatic despite
  being on X" or "improved after starting Y"). Do NOT treat this as a brand-new, unrelated case.
- Let this comparison actively shape the differential diagnosis itself: if a previously
  suspected diagnosis is now confirmed/ruled out by the treatment response, reflect that in its
  "likelihood" and in "supportingReasoning"/"againstReasoning" (e.g. "less likely — improved on
  antibiotics targeting X" or "more likely — unchanged despite adequate trial of Y").
`
      : "";

  const systemPrompt = `
You are a differential diagnosis assistant for licensed doctors.
Use the following medical guidelines:
${context}
${followupBlock}
STRICT RULES:
- Respond ONLY in ${language === "ar" ? "Arabic" : "English"}
- Output ONLY valid JSON, no extra text
- ALWAYS factor the patient's age and gender (given below) into your reasoning BEFORE settling
  on a differential diagnosis/urgency — some conditions are age- or gender-specific, more/less
  likely at certain ages, or present differently by age (e.g. pediatric vs. elderly
  presentations, pregnancy-related considerations for female patients of reproductive age,
  age-typical causes of a given symptom). If age or gender is unknown, reason as generally as
  the evidence allows and don't assume unstated demographic risk factors.
- ALWAYS factor the patient's chronic conditions, current chronic medications, and known
  allergies (given below) into your reasoning:
  * A chronic condition can directly explain or worsen the current presentation (e.g. a
    diabetic patient with polyuria/fatigue, a hypertensive patient with a headache) — raise
    the likelihood of related diagnoses accordingly and say so explicitly in
    "supportingReasoning".
  * A chronic medication can be the CAUSE of the current symptoms (a side effect or drug
    interaction) rather than a new disease — consider this as a candidate diagnosis in its own
    right when plausible (e.g. a cough in a patient on an ACE inhibitor).
  * NEVER suggest a "recommendedTests" or "protocol" that conflicts with a known allergy.
  * If chronic conditions/medications/allergies are "None reported", do not assume any exist.

Your answer MUST be organized in this exact order of reasoning:
1. First, read and interpret the clinical picture (the "reading"): what the symptoms/notes
   indicate clinically, any relevant patterns, and (for follow-ups) how the patient's condition
   has changed since the last visit.
2. Second, based on that reading, build the DIFFERENTIAL DIAGNOSIS — a ranked list of candidate
   diagnoses, most likely first. For EACH candidate diagnosis you MUST give:
   - "likelihood": how likely it is ("high", "moderate", or "low")
   - "supportingReasoning": the specific findings/symptoms/history that argue FOR this diagnosis
   - "againstReasoning": what argues AGAINST it or makes it less certain — a missing typical
     feature, an atypical finding, or an alternative that fits better. If truly nothing argues
     against it given the information available, say so explicitly (e.g. "No findings against
     it in the given information") — never leave this empty or omit it.
   - "recommendedTests": the specific test(s), lab work, or imaging that would help CONFIRM or
     RULE OUT this particular diagnosis (e.g. "Chest X-ray", "CBC with differential", "Rapid
     strep test"). If nothing specific is needed beyond clinical judgment/history, say so
     explicitly instead of leaving it empty.
   - "protocol": the standard clinical protocol, guideline-based management, or medication class
     specifically indicated IF THIS diagnosis turns out to be correct — written under that
     diagnosis, not as one protocol for the whole case (each diagnosis can call for a different
     treatment approach). If nothing specific applies, say so plainly instead of inventing one.

URGENCY LEVEL DEFINITIONS:
- "low": mild medical symptoms (cold, mild headache, minor fatigue, skin rash)
- "medium": symptoms needing attention (high fever, severe cough, persistent pain)
- "critical": life-threatening symptoms (chest pain, stroke, difficulty breathing)
- "unknown": input has NO medical content whatsoever (e.g. "hello", "test 123", random text)

IMPORTANT: If rawInput and symptoms contain NO medical terms at all, you MUST return "unknown"
for urgencyLevel and an empty possibleDiagnoses array.
${
  labFiles.length > 0
    ? `
ATTACHED LAB RESULTS / IMAGING FILES:
The doctor has attached ${labFiles.length} lab result(s) and/or radiology report(s) (images or
PDFs) for this patient, provided below as part of this message. You MUST actively examine them
and factor their findings into "clinicalReading" and into each diagnosis's "supportingReasoning"
/ "againstReasoning" (e.g. an elevated WBC count, an abnormal chest X-ray finding, a positive
culture result). If a file is unreadable/irrelevant, ignore it silently rather than commenting
on file quality.`
    : ""
}
    `;

  const labFilesNote =
    labFiles.length > 0
      ? `\nAttached files (${labFiles.length}): ${labFiles
          .map((f) => f.originalName || "file")
          .join(", ")}`
      : "";

  const userMessage = `
Doctor Input: ${rawInput}
Symptoms: ${formattedSymptoms}
Diagnosis: ${diagnosis || "Not yet determined"}
Patient age: ${patientAge !== null ? `${patientAge} years old` : "Unknown"}
Patient gender: ${patientGender || "Unknown"}
Chronic conditions: ${chronicConditions.length ? chronicConditions.join(", ") : "None reported"}
Current chronic medications: ${chronicMedications.length ? chronicMedications.join(", ") : "None reported"}
Known allergies: ${allergies.length ? allergies.join(", ") : "None reported"}${labFilesNote}

Return JSON only, in this exact shape:
{
  "clinicalReading": "... your interpretation of the clinical picture, 1-3 sentences ...",
  "possibleDiagnoses": [
    {
      "diagnosis": "most likely diagnosis name",
      "likelihood": "high | moderate | low",
      "supportingReasoning": "... why this diagnosis fits, based on the findings ...",
      "againstReasoning": "... what argues against it / makes it uncertain, or an explicit statement that nothing does ...",
      "recommendedTests": "... test(s)/imaging that would confirm or rule this out, or an explicit statement that none is needed ...",
      "protocol": "... the standard protocol / medication class / next clinical step IF this specific diagnosis is confirmed, or a clear statement that none applies ..."
    }
  ],
  "suggestedSpecialist": "... the specialist the patient should be referred to, if any, otherwise an empty string ...",
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
  // تعليمات الفولو أب، توليد الريبورت، إلخ) يشوف نفس الترتيب المطلوب:
  // القراية، بعدين التشخيص التفريقي، بعدين البروتوكول
  const composeStructuredNote = (parsed) => {
    const readingLabel =
      language === "ar" ? "القراءة السريرية" : "Clinical Reading";
    const diagnosesLabel =
      language === "ar" ? "التشخيص التفريقي" : "Differential Diagnosis";
    const likelihoodLabel = language === "ar" ? "الاحتمالية" : "Likelihood";
    const forLabel =
      language === "ar" ? "الأسباب المؤيدة" : "Supporting reasoning";
    const againstLabel = language === "ar" ? "الأسباب غير المؤيدة" : "Against";
    const testsLabel =
      language === "ar" ? "الفحوصات الموصى بها" : "Recommended tests";
    const protocolLabel = language === "ar" ? "بروتوكول العلاج" : "Protocol";

    const diagnosesText = (parsed.possibleDiagnoses || []).length
      ? parsed.possibleDiagnoses
          .map(
            (d, i) =>
              `${i + 1}. ${d.diagnosis} (${likelihoodLabel}: ${d.likelihood})\n` +
              `   ${forLabel}: ${d.supportingReasoning}\n` +
              `   ${againstLabel}: ${d.againstReasoning}\n` +
              `   ${testsLabel}: ${d.recommendedTests}\n` +
              `   ${protocolLabel}: ${d.protocol}`,
          )
          .join("\n\n")
      : language === "ar"
        ? "لا يوجد"
        : "None";

    return [
      `${readingLabel}:\n${parsed.clinicalReading}`,
      `${diagnosesLabel}:\n${diagnosesText}`,
    ].join("\n\n");
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await chatCompletion({
        systemPrompt,
        userMessage,
        fileParts: labFiles.map((f) => ({
          mimeType: f.mimeType,
          data: f.data,
        })),
      });
      const cleaned = result.content.replace(/```json|```/g, "").trim();
      // لو رجع كلام زيادة قبل/بعد الـ JSON رغم json_object mode، بنطلع
      // الجزء اللي من أول { لحد آخر } بس
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

      const allowedUrgency = ["low", "medium", "critical", "unknown"];
      const allowedLikelihood = ["high", "moderate", "low"];
      const diagnosesValid =
        Array.isArray(parsed.possibleDiagnoses) &&
        parsed.possibleDiagnoses.every(
          (d) =>
            d &&
            typeof d.diagnosis === "string" &&
            allowedLikelihood.includes(d.likelihood) &&
            typeof d.supportingReasoning === "string" &&
            typeof d.againstReasoning === "string" &&
            typeof d.recommendedTests === "string" &&
            typeof d.protocol === "string",
        );

      if (
        typeof parsed.clinicalReading !== "string" ||
        !diagnosesValid ||
        typeof parsed.suggestedSpecialist !== "string" ||
        !allowedUrgency.includes(parsed.urgencyLevel)
      ) {
        throw new Error("Invalid AI response structure");
      }

      return {
        // الشكل القديم (لسه بيتخزن وبيتقرا من أماكن تانية في السيستم)
        structuredNote: composeStructuredNote(parsed),
        // suggestedSpecialist بيتحط فاضي ("") من الموديل لو مفيش تخصص واضح
        // مناسب للحالة - بنسيبها زي ما هي، والفرونت/الكونترولر بيتعاملوا مع
        // الفاضي كـ "مفيش اقتراح تخصص" بدل ما نخترع واحد
        suggestedSpecialist: parsed.suggestedSpecialist,
        urgencyLevel: parsed.urgencyLevel,
        // القطع المنظمة الخام - يستخدمها الفرونت يعرضهم في أقسام منفصلة،
        // وكمان بيتحفظوا على الكونسلتيشن نفسها عشان الـ Patient History
        // يقدر يعرضهم منظمين برضو (مش بس النص المجمّع). كل تشخيص هنا معاه
        // بروتوكول العلاج الخاص بيه (protocol) - مش بروتوكول واحد عام للحالة
        clinicalReading: parsed.clinicalReading,
        possibleDiagnoses: parsed.possibleDiagnoses,
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

module.exports = { runDifferentialDiagnosisAgent };
