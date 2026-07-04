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
      // القيم دي جاية من خطوة "Get AI Recommendation" اللي حصلت قبل كده على
      // طول (مش بنعمل نداء تاني للـ AI هنا) — عشان الحفظ نفسه يشتغل حتى لو
      // مفيش توكينز، ومايبقاش فيه اعتماد على الـ AI في لحظة الحفظ خالص
      structuredNote,
      suggestedSpecialist,
      urgencyLevel,
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

    const consultation = await Consultation.create({
      patientId,
      doctorId: req.user.id,
      symptoms,
      diagnosis,
      rawInput,
      structuredNote: structuredNote || rawInput,
      suggestedSpecialist: suggestedSpecialist || null,
      urgencyLevel: urgencyLevel || "unknown",
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
          instructions: consultation.structuredNote || rawInput,
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
    res.status(error.isRateLimit ? 429 : 500).json({
      success: false,
      message: error.message,
      isRateLimit: !!error.isRateLimit,
    });
  }
};

const getAllConsultations = async (req, res) => {
  try {
    const consultations = await Consultation.find({})
      .populate("patientId", "name age")
      .populate("doctorId", "name")
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
    console.log(
      `[updateConsultation] id=${req.params.id} payload keys=${Object.keys(req.body).join(",")}`,
    );

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

    console.log(
      `[updateConsultation] saved OK, new diagnosis="${consultation.diagnosis}"`,
    );

    if (req.body.isChronic) {
      await addDiagnosisToChronicConditions(
        consultation.patientId,
        req.body.diagnosis ?? consultation.diagnosis,
      );
    }

    res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    console.error("[updateConsultation] FAILED:", error.message);
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

    // بنمشي بالظبط على السلسلة المتصلة بالكونسلتيشن اللي هتتمسح، في
    // الاتجاهين:
    // • forward: فولو أبات اتجدولت من الكونسلتيشن دي (consultationId)
    // • backward: فولو أب خلصت (اتكملت) بزيارة هي الكونسلتيشن دي (completionConsultationId)
    // ولو أي فولو أب في السلسلة كانت خلصت بزيارة تانية (كونسلتيشن تانية)،
    // الزيارة دي بتتحسب هي كمان جزء من نفس السلسلة وبتتمسح خالص (مش بس
    // بريسكربتها) — عشان الفولو أب دي أصلاً محفوظة كـ"كونسلتيشن" في
    // الداتا بيز، فمفيش معنى تفضل الكونسلتيشن دي قاعدة من غير الفولو أب
    // اللي بتمثلها، ولا يفضل ظاهر كارت "Follow-up Visit" في الـ Patient
    // History من غير روشتة وراه
    const deadFollowupIds = new Set();
    const deadConsultationIds = new Set([String(consultation._id)]);
    const consultationsToWalk = [String(consultation._id)];
    const visitedConsultations = new Set();

    while (consultationsToWalk.length > 0) {
      const currentId = consultationsToWalk.shift();
      if (visitedConsultations.has(currentId)) continue;
      visitedConsultations.add(currentId);

      const forwardFollowups = await Followup.find({
        consultationId: currentId,
      });
      const backwardFollowups = await Followup.find({
        completionConsultationId: currentId,
      });

      for (const followup of [...forwardFollowups, ...backwardFollowups]) {
        const fid = String(followup._id);
        if (deadFollowupIds.has(fid)) continue;
        deadFollowupIds.add(fid);

        if (followup.completionConsultationId) {
          const compId = String(followup.completionConsultationId);
          deadConsultationIds.add(compId);
          consultationsToWalk.push(compId);
        }
      }
    }

    if (deadConsultationIds.size > 0) {
      await Prescription.deleteMany({
        consultationId: { $in: [...deadConsultationIds] },
      });
    }
    if (deadFollowupIds.size > 0) {
      await Followup.deleteMany({ _id: { $in: [...deadFollowupIds] } });
    }
    await Consultation.deleteMany({
      _id: { $in: [...deadConsultationIds] },
    });

    res.status(200).json({
      success: true,
      message:
        "Consultation and its full follow-up chain deleted successfully",
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
    res.status(error.isRateLimit ? 429 : 500).json({
      success: false,
      message: error.message,
      isRateLimit: !!error.isRateLimit,
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
