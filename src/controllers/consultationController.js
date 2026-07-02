const Consultation = require("../models/Consultation");
const Patient = require("../models/Patient");
const Followup = require("../models/Followup");
const Prescription = require("../models/Prescription");

const { runClinicalRecAgent } = require("../agents/clinicalRecAgent");

const getStartOfTodayInEgypt = () => {
  const now = new Date();
  const egyptDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${egyptDateStr}T00:00:00.000Z`);
};

// لو الدكتور حدد إن الدايجنوزز دي مرض مزمن، نضيفها لـ Patient.chronicConditions
// (من غير تكرار لو هي موجودة بالفعل)
const addDiagnosisToChronicConditions = async (patientId, diagnosis) => {
  if (!diagnosis || !diagnosis.trim()) return;
  const trimmed = diagnosis.trim();
  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedNew = normalize(trimmed);

  const patient = await Patient.findById(patientId).select("chronicConditions");
  if (!patient) return;

  // مش بس exact match — بنشيك كمان لو التشخيص الجديد جزء من حالة مسجلة
  // بالفعل أو العكس (زي "Diabetes" الموجودة و"Type 2 Diabetes" الجديدة)
  // عشان مانضيفش نفس المرض تاني بصياغة مختلفة شوية
  const alreadyExists = (patient.chronicConditions || []).some((c) => {
    const normalizedExisting = normalize(c);
    return (
      normalizedExisting === normalizedNew ||
      normalizedExisting.includes(normalizedNew) ||
      normalizedNew.includes(normalizedExisting)
    );
  });
  if (alreadyExists) return;

  await Patient.findByIdAndUpdate(patientId, {
    $push: { chronicConditions: trimmed },
  });
};

const createConsultation = async (req, res) => {
  try {
    const {
      patientId,
      symptoms,
      diagnosis,
      rawInput,
      language,
      followUpDate,
      followupId,
      isChronic,
    } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    if (patient.createdBy.toString() !== req.user.id.toString()) {
      await Patient.findByIdAndUpdate(patientId, {
        $addToSet: { doctors: req.user.id },
      });
    }

    if (followUpDate) {
      const followUp = new Date(followUpDate);
      if (isNaN(followUp.getTime())) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid followUpDate" });
      }
      const today = getStartOfTodayInEgypt();
      const followUpDateOnly = new Date(
        followUp.toISOString().split("T")[0] + "T00:00:00.000Z",
      );
      const todayDateOnly = new Date(
        today.toISOString().split("T")[0] + "T00:00:00.000Z",
      );
      if (followUpDateOnly <= todayDateOnly) {
        return res.status(400).json({
          success: false,
          message: "followUpDate must be after today",
        });
      }
      const maxDate = new Date(todayDateOnly);
      maxDate.setMonth(maxDate.getMonth() + 6);
      if (followUpDateOnly > maxDate) {
        return res.status(400).json({
          success: false,
          message: "followUpDate cannot be more than 6 months from today",
        });
      }
    }

    const agentResult = await runClinicalRecAgent({
      rawInput,
      symptoms,
      diagnosis,
      language: language || "en",
    });

    const consultation = await Consultation.create({
      patientId,
      doctorId: req.user.id,
      symptoms,
      diagnosis,
      rawInput,
      structuredNote: agentResult.structuredNote,
      suggestedSpecialist: agentResult.suggestedSpecialist,
      urgencyLevel: agentResult.urgencyLevel,
      isChronic: !!isChronic,
      language: language || "en",
      status: "completed",
      followUpDate: followUpDate || undefined,
      followupId: followupId || null,
    });

    if (isChronic) {
      await addDiagnosisToChronicConditions(patientId, diagnosis);
    }

    // لو الكونسلتيشن دي من فولو أب → غير status الفولو أب لـ confirmed،
    // حدّث الـ instructions بالـ structuredNote الجديدة، واربط
    // completionConsultationId بزيارة الإكمال دي (من غير ما نلمس
    // consultationId الأصلية) عشان نقدر نرجع للزيارة الأصلية ولزيارة
    // الإكمال الاتنين وقت اللزوم (تعديل، حذف، عرض تفاصيل)
    if (followupId) {
      await Followup.findByIdAndUpdate(followupId, {
        $set: {
          status: "confirmed",
          instructions: agentResult.structuredNote || rawInput,
          completionConsultationId: consultation._id,
        },
      });
    }

    // لو الدكتور حدد تاريخ فولو أب جديد، اعمل Followup تلقائي
    if (followUpDate) {
      await Followup.create({
        consultationId: consultation._id,
        patientId,
        doctorId: req.user.id,
        instructions: "-",
        scheduledDate: followUpDate,
        language: language || "en",
      });
    }

    res.status(201).json({
      success: true,
      message: "Consultation created successfully",
      data: consultation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllConsultations = async (req, res) => {
  try {
    const consultations = await Consultation.find({})
      .populate("patientId", "name age")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllConsultationsByDoctor = async (req, res) => {
  try {
    // الكونسلتيشن اللي جاية من فولو أب (followupId موجود) مش بتظهر هنا،
    // دي بتظهر بس في صفحة Follow-ups تحت تاب Completed، وفي Patient History
    const consultations = await Consultation.find({
      doctorId: req.user.id,
      followupId: null,
    })
      .populate("patientId", "name age")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConsultationsByDoctorId = async (req, res) => {
  try {
    const { doctorId } = req.params;

    if (req.user.role !== "admin" && req.user.id !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own consultations.",
      });
    }

    const consultations = await Consultation.find({ doctorId })
      .populate("patientId", "name age")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConsultationById = async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id)
      .populate("patientId", "name age")
      .populate("doctorId", "name");
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }
    res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateConsultation = async (req, res) => {
  try {
    const consultation = await Consultation.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    if (req.body.isChronic) {
      await addDiagnosisToChronicConditions(
        consultation.patientId,
        req.body.diagnosis ?? consultation.diagnosis,
      );
    }

    res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteConsultation = async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id);
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    const patientId = consultation.patientId;

    // امسح البريسكربشن المرتبطة بالكونسلتيشن دي مباشرة، وبعدين امسح
    // الكونسلتيشن نفسها
    await Prescription.deleteMany({ consultationId: consultation._id });
    await consultation.deleteOne();

    // تنضيف شامل لكل فولو أبات نفس المريض: كل فولو أب بيتحدد صلاحيتها
    // بمرجع واحد بس حسب حالتها —
    // • لو confirmed (يعني اتكملت): المرجع الصحيح هو completionConsultationId
    //   (زيارة الإكمال الفعلية)، مش الكونسلتيشن الأصلية اللي جدولتها
    // • لو لسه pending: المرجع هو consultationId (الكونسلتيشن اللي جدولتها)
    // لو المرجع بتاعها بقى مش موجود في الداتا بيز (زي الكونسلتيشن اللي
    // اتمسحت دلوقتي)، الفولو أب دي بقت يتيمة وبتتمسح خالص من غير ما ترجع
    // pending أو تفضل معلقة
    const patientFollowups = await Followup.find({ patientId });

    for (const followup of patientFollowups) {
      const refToCheck =
        followup.status === "confirmed" && followup.completionConsultationId
          ? followup.completionConsultationId
          : followup.consultationId;

      const stillExists = refToCheck
        ? await Consultation.exists({ _id: refToCheck })
        : false;

      if (!stillExists) {
        if (followup.completionConsultationId) {
          await Prescription.deleteMany({
            consultationId: followup.completionConsultationId,
          });
        }
        await Followup.findByIdAndDelete(followup._id);
      }
    }

    res.status(200).json({
      success: true,
      message:
        "Consultation and related follow-ups/prescriptions deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAIRecommendation = async (req, res) => {
  try {
    const { symptoms, diagnosis, rawInput, language } = req.body;

    const agentResult = await runClinicalRecAgent({
      rawInput,
      symptoms,
      diagnosis,
      language: language || "en",
    });

    res.status(200).json({
      success: true,
      data: agentResult,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
module.exports = {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
  getAllConsultationsByDoctor,

  getConsultationsByDoctorId,
  getAIRecommendation,
};
