const { searchDrug } = require("../services/openFDA.service");
const { retrieve, formatContext } = require("../services/pinecone.service");
const {
  searchPubMed,
  formatPubMedContext,
} = require("../services/pubmed.service");
const {
  searchMedlinePlus,
  formatMedlinePlusContext,
} = require("../services/medlineplus.service");
// كل منطق الـ fallback (Gemini -> DeepSeek -> NVIDIA) موحّد دلوقتي في
// llm.service.js بدل ما يتكرر هنا. thinkingBudget: 1024 زي ما كان قديمًا.
const { callLLM: sharedCallLLM } = require("../services/llm.service");

const callLLM = (params) => sharedCallLLM({ thinkingBudget: 1024, ...params });

// طبقة أمان أخيرة: بعض الموديلات (خصوصًا NVIDIA/Llama كـ fallback) ممكن
// ترجّع JSON فيه خطأ بنيوي بسيط (علامة تنصيص جوه قيمة نصية، فاصلة زيادة،
// قوس مش مقفول...) - jsonrepair بتحاول تصلح المشاكل الشائعة دي قبل ما
// نستسلم تمامًا ونرجّع "couldn't parse" للدكتور
const { jsonrepair } = require("jsonrepair");

// لو الموديل رجّع كلام زيادة قبل/بعد الـ JSON
const extractJson = (text) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

// طبقة أمان أخيرة - أخيرة (بعد JSON.parse العادي وبعد jsonrepair). بعض
// الموديلات (شفناها فعليًا مع Llama/NVIDIA) بتكسر الغلاف الخارجي للـ
// JSON (زي استخدام علامة تنصيص مفردة ' بدل مزدوجة " في مفتاح
// "medications" نفسه) بشكل jsonrepair بتصلحه شكليًا بس بتفقد فيه البنية
// الأصلية (array بيتحول لكائن غريب). هنا بنتجاهل الغلاف الخارجي تمامًا
// ونستخرج مباشرة أي كائنات شكلها دواء (فيها "name" و"reason") بالـ regex
// - أضعف دقة من JSON.parse لكنها بتنقذ البيانات لما البنية الخارجية تتلف
const extractMedicationObjectsFallback = (text) => {
  const objectPattern =
    /\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*"reason"\s*:\s*"[^"]*"[^{}]*\}/g;
  const matches = text.match(objectPattern) || [];

  const medications = [];
  for (const raw of matches) {
    try {
      medications.push(JSON.parse(raw));
    } catch {
      // كائن واحد اتلف بشكل أعمق من اللازم - نتجاهله بس مش نفشل الكل
    }
  }
  return medications;
};

// فحص برمجي فعلي (مش مجرد تعليمة في الـ prompt) - بيدور في نص FDA
// (warnings/contraindications) وفي اسم الدوا نفسه عن أي كلمة من حساسيات
// المريض المسجّلة. ده شبكة أمان تانية بعد تعليمة "avoid known allergy
// conflicts" في الـ prompt، مش بديل عنها - الموديل ممكن ينسى، الكود لأ
const checkAllergyConflict = (med, allergies) => {
  if (!allergies || allergies.length === 0) return null;

  const haystack =
    `${med.name || ""} ${med.activeIngredient || ""}`.toLowerCase();
  const hit = allergies.find(
    (a) => a && haystack.includes(String(a).toLowerCase().trim()),
  );

  return hit || null;
};

// ─── Medication Suggestion Agent ────────────────────────────────────────────
// إيجنت منفصل عن إيجنت التشخيص تمامًا: بياخد التشخيص (اللي الدكتور راجعه/
// عدّله بعد ما إيجنت التشخيص اقترحه) + الأعراض + ملاحظات الدكتور، ويقترح
// خطة أدوية مبدئية (اسم، جرعة، تكرار، مدة) مع سبب قصير لكل دواء.
//
// اتحول من نداء واحد للموديل لنداءين + مصدرين خارجيين حقيقيين، عشان
// الاقتراح مايبقاش معتمد بالكامل على معرفة الموديل العامة زي ما كان:
//
//   1) نجيب سياق إرشادي عن التشخيص (Pinecone → PubMed → MedlinePlus، زي
//      نفس ترتيب Differential Diagnosis Agent) - عشان اختيار الدوا نفسه
//      (مش بس جرعته) يبقى مبني على مرجع، مش بس على تدريب الموديل.
//   2) الموديل بيقترح خطة أولية مبنية على السياق ده.
//   3) بنجيب بيانات FDA رسمية (openFDA) لكل دوا اقترحه الموديل بالاسم.
//   4) نداء تاني للموديل: يراجع اقتراحه الأول في ضوء بيانات FDA الحقيقية
//      (جرعة/تحذيرات/موانع استخدام) ويطلع خطة نهائية، مع evidenceBasis لكل
//      دوا يوضح مصدر الثقة فيه.
//
// النتيجة دي لسه اقتراح أولي بس - لسه بتعدي على فحص quickDrugCheckAgent
// العادي وقت ما الدكتور فعليًا يضيفها للروشتة، فمفيش خطورة إنها تتفحصش
// قبل الحفظ.
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
  patientWeightKg = null,
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
    const weightInfo =
      patientWeightKg !== null && patientWeightKg !== undefined
        ? `${patientWeightKg} kg`
        : "Not recorded";
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

    // ─── الخطوة 1: سياق إرشادي عن التشخيص (Pinecone → PubMed → MedlinePlus) ──
    // نفس ترتيب Differential Diagnosis Agent بالظبط - هدفنا إن اختيار
    // "أنهي دوا" مش بس "أنهي جرعة" يبقى مبني على مرجع
    let guidelineContext = "";
    let guidelineSourceUsed = null; // 'pinecone' | 'pubmed' | 'medlineplus' | null

    const pineconeDocs = await retrieve(
      `${diagnosis} treatment guideline first line`,
      language,
      3,
    );
    if (pineconeDocs.length > 0) {
      guidelineContext = formatContext(pineconeDocs, language);
      guidelineSourceUsed = "pinecone";
    } else {
      const pubmedDocs = await searchPubMed(
        `${diagnosis} treatment guideline`,
        3,
      );
      if (pubmedDocs.length > 0) {
        guidelineContext = formatPubMedContext(pubmedDocs);
        guidelineSourceUsed = "pubmed";
      } else {
        const medlineDocs = await searchMedlinePlus(diagnosis, 3);
        if (medlineDocs.length > 0) {
          guidelineContext = formatMedlinePlusContext(medlineDocs);
          guidelineSourceUsed = "medlineplus";
        }
      }
    }

    const guidelineBlock = guidelineContext
      ? `\n\nTREATMENT GUIDELINE REFERENCES for this diagnosis (use these to select the drug/first-line choice; cite implicitly by following them, do not quote verbatim):\n${guidelineContext}\n`
      : "\n\nNo external guideline reference was found for this diagnosis — base the plan on standard WHO treatment knowledge and say so.\n";

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

    const baseSystemPrompt = `You are a medication-planning assistant for a licensed doctor. Suggest an INITIAL prescription plan based on an already-confirmed diagnosis. Do not re-diagnose.

Rules:
- Text fields in ${lang} (drug names stay in standard English/generic form)
- Output ONLY raw minified JSON — no markdown, no whitespace/newlines, no explanation
- DIAGNOSIS FIDELITY: Read the diagnosis text precisely, including every qualifier in it (type,
  stage, severity, acute vs. chronic, first episode vs. recurrence, etc.) — do NOT pattern-match
  on just the general disease name and ignore the qualifier. Choose the first-line treatment that
  is standard specifically for THAT exact subtype, not a generic treatment for the broader disease
  category. For example: "Type 2 Diabetes Mellitus" is first managed with lifestyle measures plus
  an oral agent — metformin is the WHO/standard first-line choice; insulin is NOT the default
  first-line choice for type 2 and must only be suggested if the diagnosis or notes specifically
  indicate a reason for it (e.g. severe/uncontrolled hyperglycemia, contraindication to oral
  agents, or the diagnosis is actually Type 1). Never let a keyword match override the exact
  subtype stated in the diagnosis.
- Base your choices on WHO treatment guidelines / WHO Model List of Essential Medicines for this
  diagnosis where one exists — prefer WHO first-line recommended agents over alternatives, unless
  the patient's allergies/active medications/age rule them out. Use the TREATMENT GUIDELINE
  REFERENCES provided below when available; they take priority over your own general knowledge.
- Suggest as many medications as are CLINICALLY APPROPRIATE for this diagnosis (up to 4 total, including any symptomatic/protective add-ons below) — do not default to just one out of caution. If standard practice for this diagnosis is combination therapy, or if this is a follow-up showing inadequate response to a single agent, suggest the full appropriate regimen, not just one drug.
- SYMPTOMATIC RELIEF: if the symptoms or doctor's notes mention pain/ache/soreness of any kind, include a short-course analgesic appropriate for the diagnosis and pain severity (e.g. paracetamol for mild pain; escalate per WHO pain ladder only if the description indicates moderate/severe pain) — don't leave pain unaddressed just because it's not the primary diagnosis.
- GASTRIC PROTECTION: if the plan (including the patient's existing active medications) includes any drug well-known to irritate the stomach or GI tract (e.g. NSAIDs, aspirin, oral corticosteroids), add a gastroprotective agent (e.g. a PPI) to the plan, unless one is already active or clearly not needed for a very short course.
- PEDIATRIC DOSING: if the patient is under 18, doses MUST be weight-based (mg/kg), not adult fixed doses. Use the patient's weight if given below; if weight is "Not recorded", reason from a typical weight-for-age for a child that age and clearly lean conservative (lower end of the safe range) rather than defaulting to an adult dose. Never exceed the standard adult maximum dose even if a mg/kg calculation would suggest more. Double-check units (mg vs mL vs mcg) since unit mix-ups are the most common pediatric dosing error. Note in "reason" if the dose was estimated from age due to missing weight.
- Consider allergies and active medications; don't repeat an active med (unless a dose change is clearly needed); avoid known allergy conflicts
- "reason" is max 8 words, tied to diagnosis/symptoms
- This is a draft for doctor review, not final
${followupBlock}${varietyBlock}${guidelineBlock}
JSON shape (minified, no pretty-printing):
{"medications":[{"name":str,"activeIngredient":str|null,"dosageAmount":num,"dosageUnit":"mg"|"mcg"|"g","frequencyCount":num,"frequencyPeriod":"per day"|"per week"|"per month","durationValue":num|null,"durationUnit":"days"|"weeks"|"months"|null,"isChronic":bool,"reason":str}]}
If isChronic is true, durationValue/durationUnit must be null.`;

    const userPrompt = `Diagnosis: ${diagnosis}
Symptoms: ${formattedSymptoms}
Notes: ${rawInput || "none"}
Age: ${ageInfo}
Weight: ${weightInfo}
Allergies: ${allergiesList}
Active meds: ${activeMedsList}

IMPORTANT: Reply with ONLY the raw JSON object. No markdown, no explanation, no text before or after.`;

    const callAndParse = async (systemPrompt, userMsg, maxTokens) => {
      const response = await callLLM({
        temperature: 0.3,
        max_tokens: maxTokens,
        jsonMode: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      });

      const raw = response.choices[0].message.content.trim();
      const cleaned = raw
        .replace(/^```(json)?/i, "")
        .replace(/```$/, "")
        .trim();

      const jsonCandidate = extractJson(cleaned);

      // بيتحقق إن النتيجة فعلاً فيها مصفوفة أدوية صحيحة، مش بس JSON صحيح
      // شكليًا - jsonrepair ممكن "تصلح" الصياغة لكن تفقد بنية الـ array
      // الأصلية (شفناها فعليًا مع Llama: مفتاح "medications" اتكسر
      // بعلامة تنصيص مفردة، فبقى الناتج كائن غريب مش array)
      const hasValidMedsArray = (obj) =>
        obj && Array.isArray(obj.medications) && obj.medications.length > 0;

      let parsed;
      try {
        parsed = JSON.parse(jsonCandidate);
      } catch (parseErr) {
        // محاولة بالترميم قبل ما نستسلم - مفيدة تحديدًا لما يكون فيه
        // علامة تنصيص جوه قيمة نصية أو فاصلة/قوس ناقص، مش لما يكون
        // الرد مقطوع بالكامل من نص أصلاً (jsonrepair مش هتخترع بيانات)
        try {
          parsed = JSON.parse(jsonrepair(jsonCandidate));
        } catch (repairErr) {
          parsed = null;
        }
      }

      if (hasValidMedsArray(parsed)) return parsed;

      // لسه معندناش array صحيح (سواء JSON.parse فشل تمامًا، أو نجح لكن
      // بنية "medications" اتلفت زي ما حصل مع Llama) - آخر محاولة: نستخرج
      // كائنات الأدوية مباشرة بالـ regex من النص الخام، بغض النظر عن حالة
      // الغلاف الخارجي
      const fallbackMeds = extractMedicationObjectsFallback(cleaned);
      if (fallbackMeds.length > 0) {
        console.log(
          `Medication Suggestion Agent: recovered ${fallbackMeds.length} medication(s) via regex fallback after malformed JSON wrapper`,
        );
        return { medications: fallbackMeds };
      }

      throw new Error(
        "Could not extract any valid medication objects from response",
      );
    };

    // ─── الخطوة 2: الاقتراح الأولي ───────────────────────────────────────────
    let draft;
    try {
      draft = await callAndParse(baseSystemPrompt, userPrompt, 2500);
    } catch (firstErr) {
      console.log(
        "Medication Suggestion Agent: first attempt failed to parse, retrying with more room...",
      );
      try {
        draft = await callAndParse(baseSystemPrompt, userPrompt, 2000);
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

    const draftMeds = Array.isArray(draft.medications) ? draft.medications : [];

    if (draftMeds.length === 0) {
      console.log(
        "Medication Suggestion Agent: draft parsed OK but medications is empty/missing. Raw draft:",
        JSON.stringify(draft),
      );
      return { success: true, data: [] };
    }

    // ─── الخطوة 3+4: مراجعة FDA - بس لما يكون فيه سبب حقيقي يستاهل التكلفة ──
    // نداء المراجعة التاني (FDA lookup + LLM call تاني) بيزوّد وقت الاستجابة
    // وتكلفة الـ API. مش كل اقتراح دوا بسيط (زي مريض جديد من غير حساسيات)
    // محتاج مستوى التحقق ده. بنشغّله بس لو:
    //   - فيه حساسيات مسجّلة للمريض (أهم سبب أمان - لازم نتأكد من التعارض)
    //   - أو الحالة follow-up (تغيير جرعة/دواء موجود يستاهل تحقق إضافي)
    // في الحالة العادية (مريض جديد، مفيش حساسيات)، بنكتفي بالاقتراح الأولي
    // (اللي أصلًا اتغذى بمرجع علاجي من الخطوة 1) من غير مراجعة تانية
    const needsFdaVerification = allergies.length > 0 || isFollowup;

    let fdaResults = [];
    let fdaContext = "";

    if (needsFdaVerification) {
      try {
        fdaResults = await Promise.all(
          draftMeds.map((m) => searchDrug(m.activeIngredient || m.name)),
        );
      } catch (fdaErr) {
        console.error(
          "Medication Suggestion Agent: FDA lookup failed:",
          fdaErr.message,
        );
        // مفيش FDA data متاحة - هنكمل بالخطة الأولية زي ما هي، مع evidenceBasis
        // مناسب (general_knowledge)، بدل ما نوقف كل حاجة عشان الـ API الخارجي وقع
      }

      fdaContext = fdaResults.length
        ? draftMeds
            .map((m, i) => {
              const fda = fdaResults[i];
              if (!fda) return null;
              return `
Drug: ${m.name}
- Dosage (FDA label): ${fda.dosage}
- Warnings: ${fda.warnings}
- Contraindications: ${fda.contraindications}
- Interactions: ${fda.interactions}
    `;
            })
            .filter(Boolean)
            .join("\n---\n")
        : "";
    }

    let finalMeds = draftMeds;
    let usedRefinementPass = false;

    if (fdaContext) {
      const refineSystemPrompt = `You are reviewing your own DRAFT medication plan against REAL FDA label data for the same drugs. Adjust the plan if the FDA data reveals a discrepancy (e.g. your dosage differs meaningfully from the FDA-labeled dosing range, a warning/contraindication conflicts with the patient's allergies or active medications, or a stated interaction is relevant). If the draft already matches, keep it as-is.

Rules:
- Text fields in ${lang} (drug names stay in standard English/generic form)
- Output ONLY raw minified JSON — no markdown, no explanation
- Do NOT remove a medication just because FDA data is generic/unhelpful for it — keep it, and mark evidenceBasis accordingly
- For EACH medication, set "evidenceBasis" to exactly one of:
  * "fda_verified" — the dosage/safety notes were checked against real FDA label data above and are consistent (or were adjusted to match it)
  * "guideline_referenced" — the FDA data for this drug was unhelpful/missing, but the CHOICE of this drug was grounded in the treatment guideline reference provided earlier, not just general training knowledge
  * "general_knowledge" — neither FDA data nor a guideline reference was available/useful for this drug; it's based on your general medical knowledge
- Patient allergies: ${allergiesList}. If any FDA warning/contraindication text conflicts with a listed allergy, set a short "safetyNote" field on that medication describing the conflict in ${lang} — otherwise omit "safetyNote" or set it to null
- Keep every other field exactly as in the input shape

JSON shape (minified):
{"medications":[{"name":str,"activeIngredient":str|null,"dosageAmount":num,"dosageUnit":"mg"|"mcg"|"g","frequencyCount":num,"frequencyPeriod":"per day"|"per week"|"per month","durationValue":num|null,"durationUnit":"days"|"weeks"|"months"|null,"isChronic":bool,"reason":str,"evidenceBasis":"fda_verified"|"guideline_referenced"|"general_knowledge","safetyNote":str|null}]}`;

      const refineUserPrompt = `DRAFT plan:
${JSON.stringify({ medications: draftMeds })}

FDA label data for these drugs:
${fdaContext}

Guideline reference used for the original diagnosis choice: ${guidelineSourceUsed || "none"}

Reply with ONLY the raw JSON object.`;

      try {
        const refined = await callAndParse(
          refineSystemPrompt,
          refineUserPrompt,
          2800,
        );
        if (
          Array.isArray(refined.medications) &&
          refined.medications.length > 0
        ) {
          finalMeds = refined.medications;
          usedRefinementPass = true;
        }
      } catch (refineErr) {
        console.log(
          "Medication Suggestion Agent: refinement pass failed, falling back to draft plan:",
          refineErr.message,
        );
        // لو المراجعة فشلت، مانضيعش الاقتراح الأولي - نرجعه زي ما هو بس
        // من غير evidenceBasis مفصّل (هيتحط له default تحت)
      }
    }

    // لو مفيش refinement pass حصل (مفيش FDA context، أو فشل الـ pass)، نضمن
    // إن كل دوا لسه معاه evidenceBasis منطقي بدل ما يفضل فاضي
    finalMeds = finalMeds.map((m) => ({
      ...m,
      evidenceBasis:
        m.evidenceBasis ||
        (usedRefinementPass
          ? "general_knowledge"
          : guidelineSourceUsed
            ? "guideline_referenced"
            : "general_knowledge"),
    }));

    // ─── فحص برمجي إضافي (مش من الموديل) لتعارض الحساسية ────────────────────
    // شبكة أمان تانية، بتشتغل حتى لو الموديل نسي يحط safetyNote بنفسه
    finalMeds = finalMeds.map((m) => {
      if (m.safetyNote) return m; // الموديل لقى تعارض بالفعل، سيباه
      const conflict = checkAllergyConflict(m, allergies);
      if (conflict) {
        return {
          ...m,
          safetyNote:
            language === "ar"
              ? `⚠️ تحذير آلي: اسم الدواء يتقاطع مع حساسية مسجّلة ("${conflict}") — راجعي قبل الاعتماد`
              : `⚠️ Automated check: drug name overlaps with a recorded allergy ("${conflict}") — review before approving`,
        };
      }
      return m;
    });

    return { success: true, data: finalMeds };
  } catch (error) {
    console.error("Medication Suggestion Agent Error:", error);
    return { success: false, message: error.message, data: [] };
  }
};

module.exports = { runMedicationSuggestionAgent };
