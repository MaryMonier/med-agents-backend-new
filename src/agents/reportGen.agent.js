const { chatCompletion } = require('../services/openai.service');

const reportGenAgent = async ({ consultation, prescription, language = 'en' }) => {
  const startTime = Date.now();

  try {
    const systemPrompt = language === 'ar'
      ? 'أنت متخصص في إعداد التقارير الطبية. قم بإنشاء تقرير طبي منظم ومهني باللغة العربية. أجب فقط بـ JSON.'
      : 'You are a medical report specialist. Generate a structured professional medical report. Respond ONLY with JSON.';

    const userMessage = language === 'ar'
      ? `أنشئ تقريراً طبياً بناءً على:
        الأعراض: ${consultation.symptoms?.join(', ')}
        التشخيص: ${consultation.diagnosis || 'غير محدد'}
        الملاحظة السريرية: ${consultation.structuredNote}
        مستوى الخطورة: ${consultation.urgencyLevel}
        التخصص المقترح: ${consultation.suggestedSpecialist}
        الأدوية: ${prescription?.medications?.map(m => m.name).join(', ') || 'لا يوجد'}
        التحذيرات: ${prescription?.warnings?.join(', ') || 'لا يوجد'}

        أرجع JSON بهذا الشكل:
        {
          "reportTitle": "...",
          "patientCondition": "...",
          "clinicalFindings": "...",
          "treatmentPlan": "...",
          "recommendations": "...",
          "followupNotes": "..."
        }`
      : `Generate a medical report based on:
        Symptoms: ${consultation.symptoms?.join(', ')}
        Diagnosis: ${consultation.diagnosis || 'Not determined'}
        Clinical Note: ${consultation.structuredNote}
        Urgency Level: ${consultation.urgencyLevel}
        Suggested Specialist: ${consultation.suggestedSpecialist}
        Medications: ${prescription?.medications?.map(m => m.name).join(', ') || 'None'}
        Warnings: ${prescription?.warnings?.join(', ') || 'None'}

        Return JSON exactly:
        {
          "reportTitle": "...",
          "patientCondition": "...",
          "clinicalFindings": "...",
          "treatmentPlan": "...",
          "recommendations": "...",
          "followupNotes": "..."
        }`;

    const result = await chatCompletion({ systemPrompt, userMessage });

    const cleaned = result.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return { success: true, data: parsed };

  } catch (error) {
    return {
      success: false,
      error: true,
      message: 'Report generation failed',
      fallback: {
        reportTitle: 'Medical Report',
        patientCondition: 'Unable to generate report',
        clinicalFindings: consultation.structuredNote || 'N/A',
        treatmentPlan: 'Please review manually',
        recommendations: 'Consult with specialist',
        followupNotes: 'Schedule follow-up appointment'
      }
    };
  }
};

module.exports = reportGenAgent;