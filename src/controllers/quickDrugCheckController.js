const { runQuickDrugCheck } = require("../agents/quickDrugCheckAgent");

// POST /api/drug-safety/quick-check
//
// ⚠️ باج تم إصلاحه: الإيجنت (runQuickDrugCheck) اتغيّر لـ batch check بياخد
// مصفوفة واحدة `medications` ويرجع `{ results: [...] }` (نتيجة مستقلة لكل دواء)
// لكن الكنترولر ده فضل بيبعت الشكل القديم { newDrug, activeMedications } اللي
// الإيجنت مبقاش بياخده خالص. زي ما الإيجنت بيعمل destructure لـ
// `medications = []` بس، أي حاجة تانية في الـ body كانت بتتجاهل، فـ
// medications كانت بتوصله فاضية دايمًا -> `if (medications.length === 0) return { results: [] }`
// يعني الفحص كان بيرجع "مفيش مشكلة" بصمت مهما كانت الأدوية.
//
// الإصلاح: نستقبل الشكل الجديد `medications` (اللي المفروض الفرونت إند
// يبعته)، ولو لسه وصل شكل قديم (newDrug + activeMedications) من نسخة فرونت
// إند قديمة، نحوله تلقائيًا لمصفوفة واحدة بدل ما نكسر الطلب أو نرجع نتيجة غلط.
const quickCheck = async (req, res, next) => {
  try {
    const {
      medications,
      newDrug,
      activeMedications,
      allergies,
      patientAge,
      patientGender,
      language,
    } = req.body;

    const medicationsList =
      Array.isArray(medications) && medications.length > 0
        ? medications
        : [
            ...(newDrug ? [newDrug] : []),
            ...(Array.isArray(activeMedications) ? activeMedications : []),
          ];

    if (medicationsList.length === 0) {
      const err = new Error("medications is required");
      err.status = 400;
      return next(err);
    }

    const result = await runQuickDrugCheck({
      medications: medicationsList,
      allergies: allergies || [],
      patientAge: patientAge ?? null,
      patientGender: patientGender || null,
      language: language || "en",
    });

    if (result.error) {
      return res.status(200).json({
        success: false,
        message: result.message,
        data: {
          results: medicationsList.map((m) => ({
            drug: m.name,
            hasIssue: false,
            message: null,
          })),
        },
      });
    }

    res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  }
};

module.exports = { quickCheck };