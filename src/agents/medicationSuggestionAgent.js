const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");
const { GEMINI_API_KEY, GROQ_API_KEY } = require("../config/env");

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;
const groqClient = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "openai/gpt-oss-120b";

// نفس الـ fallback بتاع باقي الإيجنتس (Gemini أول، Groq لو فشلت)، مع jsonMode
// عشان نضمن رد JSON نظيف قدر الإمكان
const callLLM = async ({
  messages,
  temperature,
  max_tokens,
  jsonMode = false,
}) => {
  const systemPrompt = messages.find((m) => m.role === "system")?.content || "";
  const userMessage = messages.find((m) => m.role === "user")?.content || "";

  try {
    if (!gemini) throw new Error("Gemini API key مش موجود");

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: userMessage,
      config: {
        systemInstruction: systemPrompt,
        temperature,
        maxOutputTokens: max_tokens,
        // بدل ما نقفل التفكير تمامًا (0)، بنديله ميزانية صغيرة (256 توكن) -
        // كفاية إنه "يفكر" شوية في اختيار الدواء المناسب، بس من غير ما ياكل
        // كل ميزانية الـ maxOutputTokens ويسبب قطع في الـ JSON زي الأول
        thinkingConfig: { thinkingBudget: 256 },
        ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    });

    return { choices: [{ message: { content: response.text } }] };
  } catch (err) {
    console.log("Gemini failed, falling back to Groq...", err.message);

    if (!groqClient) throw new Error("لا Gemini ولا Groq شغالين");

    return await groqClient.chat.completions.create({
      messages,
      temperature,
      max_tokens,
      model: GROQ_MODEL,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });
  }
};

// لو الموديل رجّع كلام زيادة قبل/بعد الـ JSON
const extractJson = (text) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

// ─── Medication Suggestion Agent ────────────────────────────────────────────
// إيجنت منفصل عن إيجنت التشخيص تمامًا: بياخد التشخيص (اللي الدكتور راجعه/
// عدّله بعد ما إيجنت التشخيص اقترحه) + الأعراض + ملاحظات الدكتور، ويقترح
// خطة أدوية مبدئية (اسم، جرعة، تكرار، مدة) مع سبب قصير لكل دواء. النتيجة دي
// اقتراح أولي بس - لسه بتعدي على فحص quickDrugCheckAgent العادي وقت ما
// الدكتور فعليًا يضيفها للروشتة، فمفيش خطورة إنها تتفحصش قبل الحفظ.
//
// activeMedications: نفس شكل الأدوية الشغالة حاليًا عند المريض (لو موجودة)،
// عشان الاقتراح يراعي إنه مايكررش دواء موجود أصلاً أو يقترح حاجة متعارضة
// بشكل واضح من الأول (الفحص النهائي هيمسك أي حاجة فاتت برضو).
//
// previousPrescription: الأدوية اللي اتكتبت في الكونسلتيشن/الفولو أب اللي
// فاتت بالتفصيل (جرعة + تكرار)، مستخدمة بس لما isFollowup=true — عشان
// الإيجنت يقارن ويقرر: يزود الجرعة، يغيّر الدواء لحاجة تانية، يسيبه زي
// ما هو، أو يضيف دواء جديد فوقه - بدل ما يقترح خطة من الصفر كإن مفيش
// تاريخ علاجي أصلاً
const runMedicationSuggestionAgent = async ({
  diagnosis = "",
  symptoms = [],
  rawInput = "",
  allergies = [],
  activeMedications = [],
  patientAge = null,
  language = "en",
  isFollowup = false,
  previousPrescription = [],
  recentlyPrescribedForSameDiagnosis = [],
}) => {
  if (!diagnosis || !diagnosis.trim()) {
    return { success: false, message: "Diagnosis is required", data: [] };
  }

  try {
    const lang = language === "ar" ? "Arabic" : "English";
    const formattedSymptoms =
      Array.isArray(symptoms) && symptoms.length
        ? symptoms.join(", ")
        : "Not specified";
    const allergiesList =
      allergies.length > 0 ? allergies.join(", ") : "None reported";
    const activeMedsList =
      activeMedications.length > 0
        ? activeMedications
            .map(
              (m) =>
                `${m.name}${m.activeIngredient ? ` (${m.activeIngredient})` : ""}${m.isChronic ? " [chronic]" : ""}`,
            )
            .join(", ")
        : "None on record";
    const ageInfo = patientAge !== null ? `${patientAge} years old` : "Unknown";
    const previousMedsList =
      Array.isArray(previousPrescription) && previousPrescription.length > 0
        ? previousPrescription
            .map((m) => {
              const dose =
                m.dosageAmount && m.dosageUnit
                  ? `${m.dosageAmount}${m.dosageUnit}`
                  : null;
              const freq =
                m.frequencyCount && m.frequencyPeriod
                  ? `${m.frequencyCount}x ${m.frequencyPeriod}`
                  : null;
              const parts = [m.name, dose, freq].filter(Boolean);
              return parts.join(" ") + (m.isChronic ? " [chronic]" : "");
            })
            .join(", ")
        : "None recorded";

    const followupBlock =
      isFollowup && previousPrescription.length > 0
        ? `

This is a FOLLOW-UP visit. The patient was already prescribed this at the PREVIOUS visit:
${previousMedsList}

Compare the current diagnosis/symptoms against this prior treatment and decide the right move
for EACH relevant drug — don't just repeat the same plan by default:
- If the condition improved and treatment is working: keep the same medication/dose (you may omit it, or include it unchanged only if it still needs to appear in the plan)
- If there's no improvement or it's worsening: increase the dose, switch to a different/stronger medication, OR add a second agent on top of the existing one — pick whichever is clinically most appropriate. Partial/inadequate response to a single agent is a common, valid reason to suggest combination therapy — don't hesitate to suggest 2 medications together when that's the standard next step.
- If the condition has resolved: don't re-suggest that medication
State the change (or the decision to keep it) briefly in "reason" (e.g. "no improvement, increasing dose" / "switching due to poor response").
`
        : "";

    // عشان الإيجنت ميرجعش نفس الكومبينيشن بالظبط كل مرة لنفس التشخيص - بنديله
    // شفافية على آخر مرات كتب فيها دواء لنفس التشخيص للمريض ده (من زيارات
    // سابقة مختلفة، مش الفولو أب الحالي)، ونطلب منه يفكر في بديل معقول لو
    // فيه أكتر من خيار أول-خط صالح طبيًا
    const varietyBlock =
      !isFollowup && recentlyPrescribedForSameDiagnosis.length > 0
        ? `

VARIETY: For this same diagnosis, this patient was recently prescribed: ${recentlyPrescribedForSameDiagnosis.join(", ")}.
If there is more than one clinically valid first-line option for this diagnosis (per WHO
guidelines), prefer a reasonable alternative to what's listed above instead of defaulting to
the exact same drug again — unless the diagnosis/guidelines genuinely only support one specific
option, or the patient's specific presentation makes that same drug clearly the best choice
again. Do not force a worse or unusual choice just for the sake of variety — this only applies
when multiple options are truly equivalent.
`
        : "";

    const systemPrompt = `You are a medication-planning assistant for a licensed doctor. Suggest an INITIAL prescription plan based on an already-confirmed diagnosis. Do not re-diagnose.

Rules:
- Text fields in ${lang} (drug names stay in standard English/generic form)
- Output ONLY raw minified JSON — no markdown, no whitespace/newlines, no explanation
- Base your choices on WHO treatment guidelines / WHO Model List of Essential Medicines for this
  diagnosis where one exists — prefer WHO first-line recommended agents over alternatives, unless
  the patient's allergies/active medications/age rule them out
- Suggest as many medications as are CLINICALLY APPROPRIATE for this diagnosis (up to 4 total, including any symptomatic/protective add-ons below) — do not default to just one out of caution. If standard practice for this diagnosis is combination therapy, or if this is a follow-up showing inadequate response to a single agent, suggest the full appropriate regimen, not just one drug.
- SYMPTOMATIC RELIEF: if the symptoms or doctor's notes mention pain/ache/soreness of any kind, include a short-course analgesic appropriate for the diagnosis and pain severity (e.g. paracetamol for mild pain; escalate per WHO pain ladder only if the description indicates moderate/severe pain) — don't leave pain unaddressed just because it's not the primary diagnosis.
- GASTRIC PROTECTION: if the plan (including the patient's existing active medications) includes any drug well-known to irritate the stomach or GI tract (e.g. NSAIDs, aspirin, oral corticosteroids), add a gastroprotective agent (e.g. a PPI) to the plan, unless one is already active or clearly not needed for a very short course.
- Consider allergies and active medications; don't repeat an active med (unless a dose change is clearly needed); avoid known allergy conflicts
- "reason" is max 8 words, tied to diagnosis/symptoms
- This is a draft for doctor review, not final
${followupBlock}${varietyBlock}
JSON shape (minified, no pretty-printing):
{"medications":[{"name":str,"activeIngredient":str|null,"dosageAmount":num,"dosageUnit":"mg"|"mcg"|"g","frequencyCount":num,"frequencyPeriod":"per day"|"per week"|"per month","durationValue":num|null,"durationUnit":"days"|"weeks"|"months"|null,"isChronic":bool,"reason":str}]}
If isChronic is true, durationValue/durationUnit must be null.`;

    const userPrompt = `Diagnosis: ${diagnosis}
Symptoms: ${formattedSymptoms}
Notes: ${rawInput || "none"}
Age: ${ageInfo}
Allergies: ${allergiesList}
Active meds: ${activeMedsList}`;

    const callAndParse = async (maxTokens) => {
      const response = await callLLM({
        temperature: 0.3,
        max_tokens: maxTokens,
        jsonMode: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const raw = response.choices[0].message.content.trim();
      const cleaned = raw
        .replace(/^```(json)?/i, "")
        .replace(/```$/, "")
        .trim();

      return JSON.parse(extractJson(cleaned));
    };

    let parsed;
    try {
      // المحاولة الأساسية: ميزانية توكينز صغيرة كفاية لـ 3 أدوية مضغوطة
      parsed = await callAndParse(1400);
    } catch (firstErr) {
      // نادر جدًا بعد التصغير، بس لو حصل قطع برضو، نجرب مرة واحدة بس
      // بمساحة أكبر شوية بدل ما نفشل على طول
      console.log(
        "Medication Suggestion Agent: first attempt failed to parse, retrying with more room...",
      );
      try {
        parsed = await callAndParse(2000);
      } catch (secondErr) {
        console.error(
          "Medication Suggestion Agent: failed to parse JSON after retry:",
          secondErr.message,
        );
        return {
          success: false,
          message: "Could not parse suggestions",
          data: [],
        };
      }
    }

    const medications = Array.isArray(parsed.medications)
      ? parsed.medications
      : [];

    return { success: true, data: medications };
  } catch (error) {
    console.error("Medication Suggestion Agent Error:", error);
    return { success: false, message: error.message, data: [] };
  }
};

module.exports = { runMedicationSuggestionAgent };
