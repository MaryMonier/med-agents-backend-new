
const { chatCompletion } = require('../services/openai.service');
// const { retrieve, formatContext } = require('../services/rag.service');
const { retrieve, formatContext } = require('../services/pinecone.service'); // ✅
const Consultation = require('../models/Consultation');
const Patient = require('../models/Patient');
const Prescription = require('../models/Prescription');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runFollowupAgent = async ({
  patientSummary = '',
  consultationSummary = '',
  diagnosis = '',
  medications = [],
  scheduledDate = '',
  language = 'en',
}) => {
  const formattedMedications =
    Array.isArray(medications) && medications.length
      ? medications.join(', ')
      : 'Not specified';

  let context = '';
  try {
    const ragDocs = await retrieve(consultationSummary, language, 3);
    context = formatContext(ragDocs, language);
  } catch (ragError) {
    console.error('RAG retrieval failed, continuing without context:', ragError.message);
  }

  const systemPrompt = `
You are a follow-up assistant for licensed doctors.
Use these medical guidelines: ${context}

STRICT RULES:
- Respond ONLY in ${language === 'ar' ? 'Arabic' : 'English'}
- Output ONLY valid JSON
- Focus only on follow-up instructions, monitoring, red flags
      `;

  const userMessage = `
Patient Summary: ${patientSummary}
Consultation Summary: ${consultationSummary}
Diagnosis: ${diagnosis || 'Not specified'}
Current Medications: ${formattedMedications}
Scheduled Follow-up Date: ${scheduledDate || 'Not specified'}

Return JSON:
{
  "followupInstructions": "...",
  "recommendedFollowupDate": "...",
  "redFlags": ["..."],
  "reminderMessage": "...",
  "patientFriendlySummary": "..."
}
      `;

  // نفس فكرة الـ clinicalRecAgent: نعيد المحاولة لحد 3 مرات قبل ما نرجّع فولباك
  const MAX_ATTEMPTS = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await chatCompletion({ systemPrompt, userMessage });
      const cleaned = result.content.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

      return {
        success: true,
        data: parsed,
        meta: { tokensUsed: result.tokensUsed, latencyMs: result.latencyMs },
      };
    } catch (error) {
      lastError = error;
      console.error(`Followup Agent Error (attempt ${attempt}/${MAX_ATTEMPTS}):`, error.message);
      if (attempt < MAX_ATTEMPTS) {
        await delay(700 * attempt);
      }
    }
  }

  console.error('Followup Agent Error: all attempts failed:', lastError?.message);
  return {
    success: false,
    error: true,
    message: 'Followup agent failed',
    fallback: {
      followupInstructions: 'Unable to generate follow-up instructions.',
      recommendedFollowupDate: 'Based on doctor assessment',
      redFlags: [],
      reminderMessage: 'Please follow your doctor instructions.',
      patientFriendlySummary: 'Please contact the doctor if symptoms worsen.',
    },
  };
};

const generateFollowupPlan = async (req, res, next) => {
  try {
    const { consultationId, scheduledDate, language } = req.body;

    if (!consultationId) {
      const err = new Error('consultationId is required');
      err.status = 400;
      return next(err);
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      const err = new Error('Consultation not found');
      err.status = 404;
      return next(err);
    }

    const patient = await Patient.findById(consultation.patientId);
    const prescription = await Prescription.findOne({ consultationId });

    const patientSummary = `${patient?.name}, ${patient?.gender}, allergies: ${patient?.allergies?.join(', ') || 'None'}, chronic conditions: ${patient?.chronicConditions?.join(', ') || 'None'}`;
    const consultationSummary = `Symptoms: ${consultation.symptoms?.join(', ')}. Clinical note: ${consultation.structuredNote}. Urgency: ${consultation.urgencyLevel}. Suggested specialist: ${consultation.suggestedSpecialist}`;
    const medications = prescription?.medications?.map(m => `${m.name} ${m.dose} ${m.frequency}`) || [];

    const result = await runFollowupAgent({
      patientSummary,
      consultationSummary,
      diagnosis: consultation.diagnosis,
      medications,
      scheduledDate,
      language: language || consultation.language,
    });

    if (result.error) {
      return res.status(200).json({
        success: false,
        message: result.message,
        data: result.fallback,
      });
    }

    res.status(200).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });

  } catch (err) {
    next(err);
  }
};

module.exports = { runFollowupAgent, generateFollowupPlan };