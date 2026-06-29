const Consultation = require("../models/Consultation");
const Followup = require("../models/Followup");
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
    } = req.body;

            const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    if (patient.createdBy.toString() !== req.user.id.toString()) {
      await Patient.findByIdAndUpdate(patientId, {
        $addToSet: { doctors: req.user.id }
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
      language: language || "en",
      status: "completed",
      followUpDate: followUpDate || undefined,
      followupId: followupId || null,
    });

    // لو الكونسلتيشن دي من فولو أب → غير status الفولو أب لـ confirmed
    // وحدّث الـ instructions بالـ structuredNote الجديدة
    if (followupId) {
      await Followup.findByIdAndUpdate(followupId, {
        $set: {
          status: "confirmed",
          instructions: agentResult.structuredNote || rawInput,
        },
      });
    }

    // لو الدكتور حدد تاريخ فولو أب جديد، اعمل Followup تلقائي
    if (followUpDate) {
      await Followup.create({
        consultationId: consultation._id,
        patientId,
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
  console.log(req.user);
  

  try {
    const consultations = await Consultation.find({
      doctorId: req.user.id,
    })
      .populate("patientId", "name age")
      .sort({ createdAt: -1 });
console.log(consultations);

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
    const consultation = await Consultation.findById(req.params.id).populate(
      "patientId",
      "name age",
    );
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

    
    await Followup.deleteMany({ consultationId: consultation._id });

    await consultation.deleteOne();

    res.status(200).json({
      success: true,
      message: "Consultation and related follow-ups deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAIRecommendation = async (req, res) => {
  try {
    const {
      symptoms,
      diagnosis,
      rawInput,
      language,
    } = req.body;

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
  getAIRecommendation
};
