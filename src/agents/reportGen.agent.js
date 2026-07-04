const { chatCompletion } = require("../services/openai.service");
// const { retrieve, formatContext } = require('../services/rag.service');
const { retrieve, formatContext } = require("../services/pinecone.service"); // ✅

const reportGenAgent = async ({
  consultation,
  prescription,
  language = "en",
}) => {
  try {
    const ragDocs = await retrieve(
      consultation.symptoms?.join(" "),
      language,
      3,
    );
    const context = formatContext(ragDocs, language);

    const systemPrompt =
      language === "ar"
        ? `أنت متخصص في إعداد التقارير الطبية. استخدم الإرشادات الطبية التالية: ${context}. أجب فقط بـ JSON.`
        : `You are a medical report specialist. Use these medical guidelines: ${context}. Respond ONLY with JSON.`;

    const userMessage =
      language === "ar"
        ? `أنشئ تقريراً طبياً:
        الأعراض: ${consultation.symptoms?.join(", ")}
        التشخيص: ${consultation.diagnosis || "غير محدد"}
        الملاحظة السريرية: ${consultation.structuredNote}
        مستوى الخطورة: ${consultation.urgencyLevel}
        التخصص المقترح: ${consultation.suggestedSpecialist}
        الأدوية: ${prescription?.medications?.map((m) => m.name).join(", ") || "لا يوجد"}
        التحذيرات: ${prescription?.warnings?.join(", ") || "لا يوجد"}

        أرجع JSON:
        {
          "reportTitle": "...",
          "patientCondition": "...",
          "clinicalFindings": "...",
          "treatmentPlan": "...",
          "recommendations": "...",
          "followupNotes": "..."
        }`
        : `Generate medical report:
        Symptoms: ${consultation.symptoms?.join(", ")}
        Diagnosis: ${consultation.diagnosis || "Not determined"}
        Clinical Note: ${consultation.structuredNote}
        Urgency: ${consultation.urgencyLevel}
        Specialist: ${consultation.suggestedSpecialist}
        Medications: ${prescription?.medications?.map((m) => m.name).join(", ") || "None"}
        Warnings: ${prescription?.warnings?.join(", ") || "None"}

        Return JSON:
        {
          "reportTitle": "...",
          "patientCondition": "...",
          "clinicalFindings": "...",
          "treatmentPlan": "...",
          "recommendations": "...",
          "followupNotes": "..."
        }`;

    const result = await chatCompletion({ systemPrompt, userMessage });
    const cleaned = result.content.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: true,
      message: "Report generation failed",
      fallback: {
        reportTitle: "Medical Report",
        patientCondition: "Unable to generate report",
        clinicalFindings: consultation.structuredNote || "N/A",
        treatmentPlan: "Please review manually",
        recommendations: "Consult with specialist",
        followupNotes: "Schedule follow-up appointment",
      },
    };
  }
};

module.exports = reportGenAgent;
