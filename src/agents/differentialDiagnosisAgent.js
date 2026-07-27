const { chatCompletion } = require("../services/openai.service");
const { retrieve, formatContext } = require("../services/pinecone.service");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── استخلاص نص من ملفات التحاليل/الأشعة عشان تدخل في بحث المراجع ─────────
// PubMed/MedlinePlus/Pinecone كلهم بيشتغلوا على نص بس - مش قادرين "يشوفوا"
// صورة أو PDF. علشان نتايج الملفات المرفقة تدخل في بحث المراجع (مش بس في
// تشخيص Gemini النهائي)، بنعمل نداء منفصل وقصير لـ Gemini الأول (vision)
// نطلب منه بس "استخرج القيم/الملاحظات الموجودة فعليًا في الملفات دي كنص"
// من غير أي تشخيص أو تفسير - وبعدين النص ده بيتضاف لمصادر البحث الأخرى.
//
// لو Gemini فشل ورجع fallback لـ Groq، النداء ده هيرجع فاضي عمدًا (مش نص
// عشوائي) لأن Groq مش شايف الملفات أصلاً - رجّعله نص هيبقى مضلل مش مفيد.
const extractLabFileFindings = async (labFiles, language) => {
  if (!labFiles || labFiles.length === 0) return "";

  try {
    const result = await chatCompletion({
      systemPrompt: `You are given one or more attached lab result / radiology / imaging files.
Extract ONLY the concrete factual findings, values, or observations explicitly present in them
(e.g. "WBC 14,000", "chest X-ray shows right lower lobe consolidation", "elevated ALT/AST").
Do NOT diagnose, do NOT interpret, do NOT speculate, do NOT add any commentary or headings.
Return a short plain comma-separated list of findings only (max ~40 words total). If a file is
unreadable, blank, or contains no extractable medical content, silently skip it. If nothing at
all is extractable from any file, return an empty string.`,
      userMessage: "Extract the findings from the attached file(s).",
      jsonMode: false,
      fileParts: labFiles.map((f) => ({ mimeType: f.mimeType, data: f.data })),
    });

    // لو Gemini فشل والـ fallback كان Groq، يبقى النص اللي رجع مش شايف
    // الملفات فعليًا - نرجّع فاضي بدل ما ندخل نص مش حقيقي في بحث المراجع
    if (result.provider !== "gemini") return "";

    return (result.content || "").trim();
  } catch (err) {
    console.error("[extractLabFileFindings] failed:", err.message);
    return "";
  }
};

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

  // بدل ما نستخدم الأعراض بس في البحث عن مراجع خارجية، بنجمعها مع كلام
  // الدكتور الحر (rawInput) - فحوصات سريرية مهمة (زي "palpable gallbladder")
  // غالبًا بتتكتب هنا مش في خانة الأعراض، ولو ماستخدمناهاش في البحث، النظام
  // بيدور بجزء من الصورة السريرية بس ويفوّت مراجع مهمة كانت ممكن تتلاقى.
  //
  // وبنضيف كمان أي findings اتستخرجت فعليًا من ملفات التحاليل/الأشعة
  // المرفقة (لو موجودة) - عشان بحث PubMed/MedlinePlus/Pinecone كمان يعتمد
  // على نتايج الملفات مش بس على كلام الدكتور والأعراض النصية
  const labFileFindings = await extractLabFileFindings(labFiles, language);

  // مفيش تقصير للنص هنا خالص - بيتحط تقصير مختلف لكل مصدر تحت حسب طبيعته
  // (Pinecone بيفهم معنى نص طويل عادي عن طريق الـ embedding، لكن PubMed/
  // MedlinePlus محركات بحث بكلمات مفتاحية فبيحتاجوا سقف أعلى أوسع، مش قص
  // ملاحظة الدكتور الطبيعية)
  const retrievalQuery = [formattedSymptoms, rawInput, labFileFindings]
    .filter(Boolean)
    .join(" ");

  // سقف أمان بس لحالات نادرة جدًا (نص ضخم اتلصق بالغلط) - مش تقصير لملاحظة
  // دكتور عادية حتى لو طويلة، 2000 حرف كفاية لفقرة كاملة بسهولة
  const boundedQuery = retrievalQuery.slice(0, 2000);

  // PubMed/MedlinePlus مش بيفهموا جملة طبيعية كاملة زي محرك بحث عادي -
  // eutils بيتعامل مع الكلمات المفصولة بمسافة بمنطق قريب من AND ضمني، يعني
  // جملة طويلة فيها كلام حشو ("on examination there is") بتقلل احتمال
  // اللقاء نتيجة لصفر تقريبًا حتى لو الموضوع نفسه موجود في PubMed فعلاً.
  // بنشيل كلمات الحشو الشائعة، وبنربط الكلمات المتبقية بـ OR بدل الافتراضي
  // (AND ضمني) - عشان أي كلمة قوية لوحدها (زي "gallbladder") تقدر تجيب
  // نتيجة، بدل ما نحتاج كل الكلمات تتطابق مع بعض في نفس المقال
  const STOPWORDS = new Set([
    "a",
    "an",
    "the",
    "on",
    "in",
    "at",
    "of",
    "for",
    "to",
    "with",
    "and",
    "or",
    "is",
    "are",
    "was",
    "were",
    "there",
    "this",
    "that",
    "these",
    "those",
    "it",
    "as",
    "by",
    "be",
    "been",
    "has",
    "have",
    "had",
    "not",
    "no",
    "patient",
    "examination",
    "presents",
    "presenting",
    "complains",
    "complaining",
    "reports",
    "reported",
    "noted",
    "noticed",
    "since",
    "from",
    "into",
    "also",
    "any",
    "who",
  ]);

  const filteredTerms = boundedQuery
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));

  const keywordSearchQuery =
    filteredTerms.length > 0 ? filteredTerms.join(" OR ") : boundedQuery;

  // ─── فلترة: تطابق كلمة مفتاحية واحدة قوية مش كافي ──────────────────────
  // المشكلة اللي ظهرت فعليًا: بحث OR بيقبل أي نتيجة فيها تطابق مع أقوى
  // كلمة لوحدها (زي "gallbladder")، فمقال/صفحة عن gallbladder cancer لوحده
  // كان بيتقبل كـ "مرجع موثوق" حتى لو الصورة السريرية الكاملة (palpable +
  // jaundice مع بعض = Courvoisier's sign) بتأشر فعليًا على حاجة تانية
  // تمامًا (pancreatic cancer) ومفيش أي علاقة حقيقية بين النتيجة والصورة
  // الكاملة غير كلمة واحدة اتصادفت. أي نتيجة من أي مصدر (Pinecone/PubMed/
  // MedlinePlus) لازم تتطابق فعليًا مع أكتر من كلمة مفتاحية واحدة من كلام
  // الدكتور/الأعراض قبل ما نعتبرها "مرجع" ونحطها في الـ context اللي
  // الموديل مطالب يستخدمه - مش أي تطابق عشوائي بكلمة واحدة قوية.
  const requiredTermMatches =
    filteredTerms.length <= 1
      ? filteredTerms.length
      : Math.max(2, Math.ceil(filteredTerms.length / 2));

  const countMatchedTerms = (text) => {
    const lower = (text || "").toLowerCase();
    return filteredTerms.filter((t) => lower.includes(t.toLowerCase())).length;
  };

  // true لو مفيش كلمات مفتاحية أصلاً (نادر جدًا) أو لو النص فعلاً بيغطي
  // عدد كافٍ من الصورة السريرية الكاملة مش كلمة واحدة بس
  const passesMultiTermRelevance = (text) =>
    filteredTerms.length === 0 ||
    countMatchedTerms(text) >= requiredTermMatches;

  // ─── بناء السياق المرجعي من عدة مصادر ──────────────────────────────────
  // بدل ما نعتمد على Pinecone بس (10 مواضيع ثابتة + مقالات PubMed مخزّنة
  // وقت الـ seed)، بندور بالترتيب التالي، وكل مصدر بيتحط في السياق موسوم
  // باسمه صراحة عشان الموديل (والدكتور اللي بيراجع لاحقًا) يعرف مصدر كل
  // معلومة، مش يتلخبطوا في سلة واحدة:
  //   1. Pinecone (أسرع، مفهرس مسبقًا)
  //   2. PubMed live - لو Pinecone مالقاش حاجة، بنسأل PubMed مباشرة (نفس
  //      المنطق المستخدم في medicalAgent) بدل ما نكمل من غير أي مرجع خالص
  //   3. MedlinePlus (NIH/NLM) - طبقة إضافية دايمًا (مش بديلة) بتدي ملخصات
  //      سريرية معتمدة، بتوسّع التغطية لمواضيع مش موجودة في الـ 10 مواضيع
  //      الثابتة أصلاً
  // hasGroundedContext بتتبع لو لقينا أي مرجع حقيقي، عشان نطلب من الموديل
  // يوضح صراحة في رده أي جزء مبني على المراجع دي وأي جزء من معرفته العامة
  // (evidenceBasis) بدل ما نسيب ده غامض.
  let context = "";
  let hasGroundedContext = false;
  // بنسجّل أي مصدر فعليًا رجّع بيانات استخدمناها - ده الحقل اللي هيتضمن
  // اسم المصدر بشكل مؤكد (مش معتمد على إن الموديل "يفتكر" يكتبه في النص
  // زي evidenceBasis)، وهيترجع للفرونت والداتابيز صراحة
  const groundingSourcesUsed = [];

  // بنحتفظ بنص كل مصدر لوحده كمان (مش بس الـ context المدموج) - عشان لما
  // نحدد evidenceBasis لكل تشخيص، نقدر كمان نقول "جاي من PubMed تحديدًا"
  // أو "من MedlinePlus" أو "من قاعدة المعرفة الداخلية" - مش بس "فيه مرجع"
  // بشكل عام بدون تحديد أي مصدر بالظبط
  const sourceTexts = { pinecone: "", pubmed: "", medlineplus: "" };

  try {
    const ragDocsRaw = await retrieve(retrievalQuery, language, 3);
    // الـ score threshold في pinecone.service.js (0.75) مش ضمانة كافية
    // لوحدها إن المحتوى يغطي الصورة السريرية كاملة - ممكن embedding يقرب
    // بسبب كلمة واحدة قوية. نفس فلتر تعدد الكلمات المفتاحية بيتطبق هنا كمان
    const ragDocs = ragDocsRaw.filter((doc) =>
      passesMultiTermRelevance(doc.content),
    );
    if (ragDocs.length > 0) {
      context = formatContext(ragDocs, language);
      sourceTexts.pinecone = context;
      hasGroundedContext = true;
      groundingSourcesUsed.push("pinecone");
    }
  } catch (ragError) {
    console.error(
      "Pinecone retrieval failed, continuing without it:",
      ragError.message,
    );
  }

  if (!hasGroundedContext) {
    try {
      const {
        searchPubMed,
        formatPubMedContext,
      } = require("../services/pubmed.service");
      const pubmedArticlesRaw = await searchPubMed(keywordSearchQuery, 3);
      // بحث PubMed بمنطق OR بيرجّع مقالات ممكن تتطابق مع كلمة واحدة قوية
      // بس (زي "gallbladder") وتفوّت باقي الصورة السريرية تمامًا - بنرفض
      // أي مقال ماعندوش تطابق حقيقي مع أكتر من كلمة مفتاحية واحدة
      const pubmedArticles = pubmedArticlesRaw.filter((article) =>
        passesMultiTermRelevance(`${article.title} ${article.abstract}`),
      );
      if (pubmedArticles.length > 0) {
        context = formatPubMedContext(pubmedArticles);
        sourceTexts.pubmed = context;
        hasGroundedContext = true;
        groundingSourcesUsed.push("pubmed");
      }
    } catch (pubmedError) {
      console.error(
        "PubMed retrieval failed, continuing without it:",
        pubmedError.message,
      );
    }
  }

  try {
    const {
      searchMedlinePlus,
      formatMedlinePlusContext,
    } = require("../services/medlineplus.service");
    const medlineTopicsRaw = await searchMedlinePlus(keywordSearchQuery, 2);
    // نفس الفلتر - MedlinePlus عنده صفحة مخصصة "Gallbladder Diseases" ممكن
    // تتطابق مع كلمة "gallbladder" لوحدها وتفوّت باقي الصورة السريرية
    const medlineTopics = medlineTopicsRaw.filter((topic) =>
      passesMultiTermRelevance(`${topic.title} ${topic.summary}`),
    );
    if (medlineTopics.length > 0) {
      const medlineContext = formatMedlinePlusContext(medlineTopics);
      sourceTexts.medlineplus = medlineContext;
      context = [context, medlineContext].filter(Boolean).join("\n\n");
      hasGroundedContext = true;
      groundingSourcesUsed.push("medlineplus");
    }
  } catch (medlineError) {
    console.error(
      "MedlinePlus retrieval failed, continuing without it:",
      medlineError.message,
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
   - "evidenceBasis": be honest about where this diagnosis's reasoning/protocol actually comes
     from — "referenced" if it is substantively supported by the CLINICAL REFERENCES provided
     above (Pinecone/PubMed/MedlinePlus), or "general_knowledge" if none of the provided
     references cover it and you are relying on your own medical training. Do NOT mark something
     "referenced" just because a reference exists somewhere above — only if it actually supports
     THIS specific diagnosis/protocol.

TRANSPARENCY RULE: it is completely fine, and expected, for most diagnoses to be
"general_knowledge" — the references provided are a small supplementary set, not a complete
guideline database. Never fabricate a connection to the references just to mark something
"referenced".

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
      "protocol": "... the standard protocol / medication class / next clinical step IF this specific diagnosis is confirmed, or a clear statement that none applies ...",
      "evidenceBasis": "referenced | general_knowledge"
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
  const composeStructuredNote = (parsed, labFilesReviewedFlag) => {
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
    const evidenceLabel =
      language === "ar" ? "الأساس المعرفي" : "Evidence basis";
    const sourceDisplayNames = {
      pinecone:
        language === "ar"
          ? "قاعدة المعرفة الداخلية"
          : "internal knowledge base",
      pubmed: "PubMed",
      medlineplus: "MedlinePlus",
    };
    const evidenceText = (basis, referenceSource) => {
      if (basis === "referenced") {
        const sourceName = sourceDisplayNames[referenceSource] || null;
        return language === "ar"
          ? `مستند لمرجع موثّق${sourceName ? ` (${sourceName})` : ""}`
          : `Backed by a cited reference${sourceName ? ` (${sourceName})` : ""}`;
      }
      return language === "ar"
        ? "معرفة عامة للنموذج (غير مستند لمرجع مباشر)"
        : "Model's general medical knowledge (no direct reference)";
    };

    const diagnosesText = (parsed.possibleDiagnoses || []).length
      ? parsed.possibleDiagnoses
          .map(
            (d, i) =>
              `${i + 1}. ${d.diagnosis} (${likelihoodLabel}: ${d.likelihood})\n` +
              `   ${forLabel}: ${d.supportingReasoning}\n` +
              `   ${againstLabel}: ${d.againstReasoning}\n` +
              `   ${testsLabel}: ${d.recommendedTests}\n` +
              `   ${protocolLabel}: ${d.protocol}\n` +
              `   ${evidenceLabel}: ${evidenceText(d.evidenceBasis, d.referenceSource)}`,
          )
          .join("\n\n")
      : language === "ar"
        ? "لا يوجد"
        : "None";

    // اسم/أسماء المصادر اللي فعليًا رجّعت بيانات استُخدمت - سطر مضمون
    // (مش معتمد على الموديل يكتبه بنفسه) بيتحط أول النص لو فيه أي مصدر
    const sourcesLabel =
      language === "ar" ? "المصادر المستخدمة" : "Sources consulted";
    const sourceNames = {
      pinecone:
        language === "ar"
          ? "قاعدة المعرفة الداخلية"
          : "Internal knowledge base",
      pubmed: "PubMed",
      medlineplus: "MedlinePlus",
    };
    const sourcesLine = groundingSourcesUsed.length
      ? `${sourcesLabel}: ${groundingSourcesUsed.map((s) => sourceNames[s] || s).join(", ")}`
      : `${sourcesLabel}: ${language === "ar" ? "لا يوجد (معرفة عامة للنموذج)" : "None (model's general knowledge)"}`;

    // تحذير مضمون (مش نص عام) لو فيه ملفات مرفقة بس ماتقرتش فعليًا -
    // بيظهر بس في الحالة دي تحديدًا، عشان الدكتور ميفترضش إن أي ملف مرفق
    // اتراجع تلقائيًا
    const filesWarningLine =
      labFiles.length > 0 && !labFilesReviewedFlag
        ? language === "ar"
          ? `⚠️ تنبيه: فيه ${labFiles.length} ملف مرفق، لكن النموذج المستخدم في توليد الرد ده مايقدرش يقرا صور/PDF، فمحتوى الملفات دي ماتراجعش فعليًا.`
          : `⚠️ Note: ${labFiles.length} file(s) were attached, but the model used to generate this response cannot read images/PDFs, so their content was NOT actually reviewed.`
        : null;

    return [
      filesWarningLine,
      sourcesLine,
      `${readingLabel}:\n${parsed.clinicalReading}`,
      `${diagnosesLabel}:\n${diagnosesText}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  // ─── طبقة تحقق برمجية إضافية (مش بس اعتماد على التزام الموديل بالـ prompt) ─
  // حتى مع تعليمات واضحة في الـ prompt ("NEVER suggest ... that conflicts
  // with a known allergy")، الموديل ممكن يغلط أو ينسى. الفحص ده بيدور
  // بالكود نفسه (مش سؤال تاني للموديل) على نص كل protocol/recommendedTests
  // عن أي ذكر حرفي لحساسية مسجّلة للمريض، ولو لقى تطابق بيحط تحذير آلي
  // صريح فوق النص - شبكة أمان مستقلة عن سلوك الموديل، مش بديل عن مراجعة
  // الدكتور (فحص بالكلمات المفتاحية بسيط ومش هيمسك كل الحالات، لكنه أفضل
  // من الاعتماد على الـ prompt بس).
  const flagAllergyConflicts = (diagnoses, allergyList) => {
    if (!Array.isArray(diagnoses) || !allergyList.length) return diagnoses;

    return diagnoses.map((d) => {
      const textToScan =
        `${d.protocol || ""} ${d.recommendedTests || ""}`.toLowerCase();
      const matchedAllergy = allergyList.find(
        (a) => a && a.trim() && textToScan.includes(a.toLowerCase().trim()),
      );

      if (!matchedAllergy) return d;

      const warning =
        language === "ar"
          ? `⚠️ تحذير آلي: النص التالي بيحتوي على ذكر لـ "${matchedAllergy}" وهو مسجّل كحساسية عند المريض — راجعي هذا البند قبل الاعتماد عليه.`
          : `⚠️ Automated warning: the text below mentions "${matchedAllergy}", which is on this patient's recorded allergy list — review this item before relying on it.`;

      return { ...d, protocol: `${warning}\n${d.protocol}` };
    });
  };

  // بناء استعلام كلمات مفتاحية من نص حر - نفس منطق تنضيف كلمات الحشو
  // المستخدم فوق مع الأعراض/الملاحظات، بس معمول كدالة قابلة لإعادة
  // الاستخدام عشان نطبّقها كمان على أسماء التشخيصات تحت
  const buildKeywordQuery = (text) => {
    const terms = text
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
    return terms.length > 0 ? terms.join(" OR ") : text;
  };

  // ─── تحديد evidenceBasis + المصدر بالظبط بشكل حتمي (مش رأي الموديل) ────
  // قبل كده، evidenceBasis كان حقل بيرجّعه الموديل نفسه في الـ JSON بناءً
  // على تقييمه الشخصي - وده بـ temperature 0.3 مش ثابت، فنفس السياق ممكن
  // يترجم "referenced" مرة و"general_knowledge" مرة تانية من غير أي سبب
  // حقيقي غير عشوائية الموديل. الدالة دي بتاخد قرار evidenceBasis (وكمان
  // اسم المصدر بالظبط - pinecone/pubmed/medlineplus) بعيدًا عن رأي الموديل
  // خالص - بتفحص بالكود (تطابق كلمات مفتاحية) هل اسم التشخيص فعلاً
  // موجود/مذكور في نص كل مصدر لوحده.
  const matchesReference = (matchText, referenceText) => {
    if (!referenceText) return false;

    const significantWords = matchText
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()));

    if (significantWords.length === 0) return false;

    const referenceTextLower = referenceText.toLowerCase();
    const matchCount = significantWords.filter((w) =>
      referenceTextLower.includes(w.toLowerCase()),
    ).length;

    // نطلب على الأقل نص الكلمات المهمة (أو كلمة واحدة لو الاسم قصير) تكون
    // موجودة فعليًا في المرجع، مش مجرد كلمة عامة اتصادفت
    const requiredMatches = Math.max(1, Math.ceil(significantWords.length / 2));
    return matchCount >= requiredMatches;
  };

  // بيرجع { evidenceBasis, referenceSource } - referenceSource بيبقى
  // "pinecone" / "pubmed" / "medlineplus" لو اتطابق مع مصدر واحد بالظبط،
  // أو أول مصدر اتطابق لو اتطابق مع أكتر من واحد، أو null لو مفيش تطابق
  //
  // بنفحص التطابق على اسم التشخيص + supportingReasoning مع بعض، مش اسم
  // التشخيص لوحده - اسم التشخيص نص حر بيتصاغ من جديد كل مرة (Gemini بـ
  // temperature 0.3)، فنفس التشخيص ممكن يتكتب "Pancreatic head
  // adenocarcinoma" مرة و"Adenocarcinoma of the head of the pancreas" مرة
  // تانية، وده كان بيغيّر نتيجة evidenceBasis رغم إن المعنى الطبي واحد.
  // supportingReasoning بيستخدم مصطلحات أقرب لكلام الدكتور نفسه (زي
  // "palpable gallbladder", "jaundice") فبيديّ تطابق أثبت وأقل حساسية
  // لاختلاف صياغة اسم التشخيص من مرة للتانية.
  const computeEvidenceBasis = (diagnosisObj, sources) => {
    const matchText = [diagnosisObj.diagnosis, diagnosisObj.supportingReasoning]
      .filter(Boolean)
      .join(" ");

    const sourceOrder = ["pinecone", "pubmed", "medlineplus"];
    for (const src of sourceOrder) {
      if (matchesReference(matchText, sources[src])) {
        return { evidenceBasis: "referenced", referenceSource: src };
      }
    }
    return { evidenceBasis: "general_knowledge", referenceSource: null };
  };

  // ─── محاولة أخيرة: بحث بأسماء التشخيصات نفسها بعد رد الموديل ────────────
  // البحث الأساسي (فوق) بيحصل بالأعراض/الملاحظات النصية بس - قبل ما الموديل
  // يشوف الملفات المرفوعة (أشعة/تحاليل) أصلًا. يعني لو التشخيص الحقيقي طلع
  // بناءً على قراءة الموديل لصورة/تقرير (مش من النص المكتوب)، البحث الأول
  // مايقدرش يعرف بيه من الأساس. هنا، بعد ما عندنا أسماء التشخيصات (اللي
  // بتعكس كل حاجة الموديل شافها، بما فيها الملفات)، بندور بيها كمحاولة
  // أخيرة - بس لو كل محاولات البحث اللي فوق فشلت (hasGroundedContext لسه
  // false)، عشان مانضيفش وقت شبكة زيادة في الحالة العادية اللي أصلًا لقت
  // مرجع كويس من الأول. مفيش نداء تاني للموديل هنا خالص - بحث فقط.
  const attemptDiagnosisBasedGrounding = async (diagnoses) => {
    if (hasGroundedContext || !Array.isArray(diagnoses) || !diagnoses.length) {
      return diagnoses;
    }

    const diagnosisQuery = buildKeywordQuery(
      diagnoses.map((d) => d.diagnosis).join(" "),
    );

    let extraContext = "";
    let extraSource = null;

    try {
      const ragDocs = await retrieve(diagnosisQuery, language, 3);
      if (ragDocs.length > 0) {
        extraContext = formatContext(ragDocs, language);
        extraSource = "pinecone";
      }
    } catch (e) {
      console.error("Diagnosis-based Pinecone retrieval failed:", e.message);
    }

    if (!extraContext) {
      try {
        const {
          searchPubMed,
          formatPubMedContext,
        } = require("../services/pubmed.service");
        const articles = await searchPubMed(diagnosisQuery, 3);
        if (articles.length > 0) {
          extraContext = formatPubMedContext(articles);
          extraSource = "pubmed";
        }
      } catch (e) {
        console.error("Diagnosis-based PubMed retrieval failed:", e.message);
      }
    }

    if (!extraContext) {
      try {
        const {
          searchMedlinePlus,
          formatMedlinePlusContext,
        } = require("../services/medlineplus.service");
        const topics = await searchMedlinePlus(diagnosisQuery, 2);
        if (topics.length > 0) {
          extraContext = formatMedlinePlusContext(topics);
          extraSource = "medlineplus";
        }
      } catch (e) {
        console.error(
          "Diagnosis-based MedlinePlus retrieval failed:",
          e.message,
        );
      }
    }

    if (!extraContext || !extraSource) return diagnoses;

    groundingSourcesUsed.push(extraSource);
    sourceTexts[extraSource] = [sourceTexts[extraSource], extraContext]
      .filter(Boolean)
      .join("\n\n");

    // ترقية evidenceBasis بس لو فيه تطابق فعلي لكلمات التشخيص المهمة في
    // النص اللي رجع - نفس دالة computeEvidenceBasis الحتمية اللي بتتطبق
    // في كل حالة تانية، مش فحص مكرر هنا
    return diagnoses.map((d) => {
      if (d.evidenceBasis === "referenced") return d;
      return { ...d, ...computeEvidenceBasis(d, sourceTexts) };
    });
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
      // مضمون من الكود، مش افتراض - الملفات (صور/PDF) بيشوفها Gemini بس.
      // لو الرد جه من Groq (fallback صامت لما Gemini يفشل)، الملفات
      // المرفقة معملهاش خالص، حتى لو كانت موجودة أصلًا في الطلب
      const labFilesReviewed =
        labFiles.length > 0 && result.provider === "gemini";
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

      // evidenceBasis + referenceSource: مش بنسيبها لتقييم الموديل الشخصي
      // (ده كان بيتغير من مرة للتانية بسبب temperature) - بنحسم القيمة دي
      // بالكود نفسه (تطابق كلمات مفتاحية حقيقي مع نص كل مصدر لوحده)، مش
      // برأي الموديل. referenceSource بتقول بالظبط المصدر (pinecone/pubmed/
      // medlineplus) لو فيه تطابق، أو null لو مفيش
      parsed.possibleDiagnoses = parsed.possibleDiagnoses.map((d) => ({
        ...d,
        ...computeEvidenceBasis(d, sourceTexts),
      }));

      // محاولة أخيرة بأسماء التشخيصات - بتتفعّل بس لو البحث الأول (بالأعراض/
      // الملاحظات) مالقاش حاجة خالص، بما فيها احتمال إن الملفات المرفوعة
      // (أشعة/تحاليل) هي اللي أدّت للتشخيص ده، مش الأعراض النصية
      parsed.possibleDiagnoses = await attemptDiagnosisBasedGrounding(
        parsed.possibleDiagnoses,
      );

      // تطبيق طبقة التحقق البرمجي من تعارض الحساسية قبل ما نرجّع النتيجة
      parsed.possibleDiagnoses = flagAllergyConflicts(
        parsed.possibleDiagnoses,
        allergies,
      );

      return {
        // الشكل القديم (لسه بيتخزن وبيتقرا من أماكن تانية في السيستم)
        structuredNote: composeStructuredNote(parsed, labFilesReviewed),
        // suggestedSpecialist بيتحط فاضي ("") من الموديل لو مفيش تخصص واضح
        // مناسب للحالة - بنسيبها زي ما هي، والفرونت/الكونترولر بيتعاملوا مع
        // الفاضي كـ "مفيش اقتراح تخصص" بدل ما نخترع واحد
        suggestedSpecialist: parsed.suggestedSpecialist,
        urgencyLevel: parsed.urgencyLevel,
        // مضمون ومش معتمد على الموديل - أسماء المصادر الخارجية اللي فعليًا
        // رجّعت بيانات استُخدمت وقت التوليد ده (ممكن تبقى فاضية [] لو مفيش
        // أي مصدر رجّع حاجة، يبقى كل الرد اعتمد على معرفة الموديل العامة)
        groundingSourcesUsed,
        // مضمون من الكود (مش نص عام زي "الملفات اتراجعت") - true بس لو فعلًا
        // فيه ملفات مرفقة والرد جه من Gemini (القادر يشوفهم). false لو مفيش
        // ملفات أصلًا، أو لو حصل fallback لـ Groq وقت الطلب ده تحديدًا - عشان
        // الفرونت يقدر يعرض تحذير صريح بدل ما يفترض دايمًا إن الملفات اتقرت
        labFilesReviewed,
        // القطع المنظمة الخام - يستخدمها الفرونت يعرضهم في أقسام منفصلة،
        // وكمان بيتحفظوا على الكونسلتيشن نفسها عشان الـ Patient History
        // يقدر يعرضهم منظمين برضو (مش بس النص المجمّع). كل تشخيص هنا معاه
        // بروتوكول العلاج الخاص بيه (protocol) - مش بروتوكول واحد عام للحالة
        // كل عنصر هنا فيه evidenceBasis ("referenced" / "general_knowledge")
        // بالإضافة لأي تحذير آلي اتضاف تلقائيًا في "protocol" لو فيه تعارض
        // حساسية - عشان الفرونت يقدر يعرضهم بشكل مميز (badge/لون مختلف)
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
