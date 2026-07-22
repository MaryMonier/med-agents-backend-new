const { chatCompletion } = require("../services/openai.service");
const { retrieve, formatContext } = require("../services/pinecone.service");

/**
 * reportGenAgent
 *
 * بيتعامل مع قايمة كونسلتيشنز بدل ما يشتغل على واحدة بس —
 * عشان يقدر يولّد ريبورت شامل (سنوي / شهري / كونسلتيشن واحد)
 *
 * @param {{
 *   consultations: Array,   // قايمة الكونسلتيشنز المفلترة (مع الروشتة جواها لو موجودة)
 *   patient: Object,        // بيانات المريض الأساسية
 *   scopeLabel: string,     // "Yearly Report" / "Monthly Report" / "Specific Consultation"
 *   rangeLabel: string,     // "Year 2024" / "March 2024" / "Diagnosis — date"
 *   language?: "en"|"ar"
 * }} params
 */
const reportGenAgent = async ({
  consultations = [],
  patient,
  scopeLabel,
  rangeLabel,
  language = "en",
}) => {
  try {
    // بنجمع كل الأعراض من الكونسلتيشنز عشان نعمل RAG بيهم
    const allSymptoms = [
      ...new Set(consultations.flatMap((c) => c.symptoms || [])),
    ];
    const ragQuery =
      allSymptoms.join(" ") || patient?.name || "general medical report";

    const ragDocs = await retrieve(ragQuery, language, 3);
    const context = formatContext(ragDocs, language);

    // بنبني ملخص لكل كونسلتيشن في شكل نص منظم يبعته للـ AI
    const buildConsultationSummary = (c) => {
      const meds =
        c.prescription?.medications?.map((m) => m.name).join(", ") ||
        (language === "ar" ? "لا يوجد" : "None");
      const warnings =
        c.prescription?.warnings?.join(", ") ||
        (language === "ar" ? "لا يوجد" : "None");
      const date = c.date
        ? new Date(c.date).toLocaleDateString()
        : language === "ar"
          ? "غير معروف"
          : "Unknown";

      // رؤية إيجنت التشخيص التفريقي (Differential Diagnosis Agent): بنفضّل
      // القطع المنظمة (clinicalReading + possibleDiagnoses، وكل تشخيص فيها
      // معاه بروتوكوله الخاص) لو موجودة، ولو لأ (كونسلتيشن قديمة قبل إضافة
      // الحقول دي) بنرجع للنص المجمّع structuredNote كـ fallback
      const formatDiagnosesList = (list) =>
        (list || [])
          .map((d) =>
            language === "ar"
              ? `${d.diagnosis} (${d.likelihood}) — مؤيد: ${d.supportingReasoning}؛ غير مؤيد: ${d.againstReasoning}؛ فحوصات: ${d.recommendedTests}؛ بروتوكول العلاج: ${d.protocol}`
              : `${d.diagnosis} (${d.likelihood}) — for: ${d.supportingReasoning}; against: ${d.againstReasoning}; tests: ${d.recommendedTests}; protocol: ${d.protocol}`,
          )
          .join(" | ");

      const differentialDiagnosisInsight =
        c.clinicalReading || c.possibleDiagnoses?.length
          ? language === "ar"
            ? [
                c.clinicalReading ? `القراءة السريرية: ${c.clinicalReading}` : null,
                c.possibleDiagnoses?.length
                  ? `التشخيص التفريقي: ${formatDiagnosesList(c.possibleDiagnoses)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" | ")
            : [
                c.clinicalReading ? `Clinical reading: ${c.clinicalReading}` : null,
                c.possibleDiagnoses?.length
                  ? `Differential diagnosis: ${formatDiagnosesList(c.possibleDiagnoses)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" | ")
          : c.structuredNote || (language === "ar" ? "لا يوجد" : "N/A");

      if (language === "ar") {
        return `
[كونسلتيشن — ${date}]
الأعراض: ${c.symptoms?.join("، ") || "غير محدد"}
التشخيص: ${c.diagnosis || "غير محدد"}
رؤية إيجنت التشخيص التفريقي: ${differentialDiagnosisInsight}
مستوى الخطورة: ${c.urgencyLevel || "غير محدد"}
التخصص المقترح: ${c.suggestedSpecialist || "لا يوجد"}
الأدوية: ${meds}
التحذيرات: ${warnings}`.trim();
      }
      return `
[Consultation — ${date}]
Symptoms: ${c.symptoms?.join(", ") || "N/A"}
Diagnosis: ${c.diagnosis || "Not determined"}
Differential Diagnosis Agent Insight: ${differentialDiagnosisInsight}
Urgency: ${c.urgencyLevel || "N/A"}
Specialist: ${c.suggestedSpecialist || "None"}
Medications: ${meds}
Warnings: ${warnings}`.trim();
    };

    const consultationsSummary = consultations
      .map(buildConsultationSummary)
      .join("\n\n---\n\n");

    const patientInfo =
      language === "ar"
        ? `المريض: ${patient?.name || "غير معروف"} | فصيلة الدم: ${patient?.bloodType || "غير معروفة"} | الحالات المزمنة: ${patient?.chronicConditions?.join("، ") || "لا يوجد"} | الحساسيات: ${patient?.allergies?.join("، ") || "لا يوجد"}`
        : `Patient: ${patient?.name || "Unknown"} | Blood Type: ${patient?.bloodType || "N/A"} | Chronic Conditions: ${patient?.chronicConditions?.join(", ") || "None"} | Allergies: ${patient?.allergies?.join(", ") || "None"}`;

    const systemPrompt =
      language === "ar"
        ? `أنت متخصص في إعداد التقارير الطبية الشاملة. استخدم الإرشادات الطبية التالية: ${context}. أجب فقط بـ JSON صالح بدون أي نص إضافي.`
        : `You are a specialist in generating comprehensive medical reports. Use these medical guidelines: ${context}. Respond ONLY with valid JSON, no extra text.`;

    const userMessage =
      language === "ar"
        ? `أنشئ تقريراً طبياً شاملاً لـ (${scopeLabel} — ${rangeLabel}):

${patientInfo}

عدد الكونسلتيشنز: ${consultations.length}

${consultationsSummary}

أرجع JSON بهذا الشكل بالظبط:
{
  "reportTitle": "عنوان التقرير",
  "executiveSummary": "ملخص تنفيذي شامل للحالة خلال الفترة",
  "patientCondition": "تقييم الحالة الصحية العامة للمريض",
  "clinicalFindings": "أبرز الاستنتاجات السريرية من مراجعة الكونسلتيشنز",
  "treatmentPlan": "خطة العلاج الموصى بها بناءً على التاريخ المرضي",
  "recommendations": "توصيات طبية للمتابعة",
  "followupNotes": "ملاحظات المتابعة والخطوات القادمة"
}`
        : `Generate a comprehensive medical report for (${scopeLabel} — ${rangeLabel}):

${patientInfo}

Total Consultations: ${consultations.length}

${consultationsSummary}

Return JSON in exactly this format:
{
  "reportTitle": "Report title",
  "executiveSummary": "Comprehensive executive summary of the patient's condition over this period",
  "patientCondition": "Overall patient health assessment",
  "clinicalFindings": "Key clinical findings from reviewing the consultations",
  "treatmentPlan": "Recommended treatment plan based on medical history",
  "recommendations": "Medical recommendations and follow-up actions",
  "followupNotes": "Follow-up notes and next steps"
}`;

    const result = await chatCompletion({ systemPrompt, userMessage });
    const cleaned = result.content.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

    return { success: true, data: parsed };
  } catch (error) {
    console.error("[reportGenAgent] error:", error);
    return {
      success: false,
      error: true,
      message: "Report generation failed",
      fallback: {
        reportTitle: scopeLabel || "Medical Report",
        executiveSummary:
          "Unable to generate summary — please review manually.",
        patientCondition: "Unable to assess",
        clinicalFindings: `${consultations.length} consultation(s) reviewed.`,
        treatmentPlan: "Please review manually",
        recommendations: "Consult with specialist",
        followupNotes: "Schedule follow-up appointment",
      },
    };
  }
};

module.exports = reportGenAgent;
