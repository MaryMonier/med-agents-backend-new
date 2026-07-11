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
- If there's no improvement or it's worsening: increase the dose, or switch to a different/stronger medication — pick whichever is clinically more appropriate
- If the condition has resolved: don't re-suggest that medication
- You may add a new medication on top of the existing plan if the presentation calls for it
State the change (or the decision to keep it) briefly in "reason" (e.g. "no improvement, increasing dose" / "switching due to poor response").
`
        : "";

    const systemPrompt = `You are a medication-planning assistant for a licensed doctor. Suggest an INITIAL prescription plan based on an already-confirmed diagnosis. Do not re-diagnose.

Rules:
- Text fields in ${lang} (drug names stay in standard English/generic form)
- Output ONLY raw minified JSON — no markdown, no whitespace/newlines, no explanation
- 1 to 3 medications max, focused first-line plan
- Consider allergies and active medications; don't repeat an active med (unless a dose change is clearly needed); avoid known allergy conflicts
- "reason" is max 8 words, tied to diagnosis/symptoms
- This is a draft for doctor review, not final
${followupBlock}
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
      parsed = await callAndParse(800);
    } catch (firstErr) {
      // نادر جدًا بعد التصغير، بس لو حصل قطع برضو، نجرب مرة واحدة بس
      // بمساحة أكبر شوية بدل ما نفشل على طول
      console.log(
        "Medication Suggestion Agent: first attempt failed to parse, retrying with more room...",
      );
      try {
        parsed = await callAndParse(1400);
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
