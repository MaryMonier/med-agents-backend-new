const Consultation = require("../models/Consultation");
const Followup = require("../models/Followup");
const { runClinicalRecAgent } = require("../agents/clinicalRecAgent");

// ─── Helper: جيب بداية اليوم بتوقيت مصر (Africa/Cairo) ─────────────────────
const getStartOfTodayInEgypt = () => {
  const now = new Date();

  // بنجيب التاريخ بتوقيت مصر كـ string زي "2026-06-15"
  const egyptDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // نحوله لـ Date بداية اليوم UTC، عشان نقارن بالتواريخ الجاية من الفرونت بشكل ثابت
  return new Date(`${egyptDateStr}T00:00:00.000Z`);
};

const createConsultation = async (req, res) => {
  try {
    const { patientId, symptoms, diagnosis, rawInput, language, followUpDate } =
      req.body;

    // ─── Validate followUpDate ──────────────────────────────────────────────
    if (followUpDate) {
      const followUp = new Date(followUpDate);

      if (isNaN(followUp.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid followUpDate",
        });
      }

      // بداية اليوم الحالي بتوقيت مصر
      const today = getStartOfTodayInEgypt();

      // بداية يوم بكرة - أي تاريخ يوم 15 بطوله (من 00:00 لـ 23:59) لازم يترفض
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // لازم يكون من بداية بكرة وبعدها
      if (followUp < tomorrow) {
        return res.status(400).json({
          success: false,
          message: "followUp Date must be after today",
        });
      }

      // أقصى حد 6 شهور من بكرة (بتوقيت مصر)
      const maxDate = new Date(tomorrow);
      maxDate.setMonth(maxDate.getMonth() + 6);

      if (followUp > maxDate) {
        return res.status(400).json({
          success: false,
          message: "followUp Date cannot be more than 6 months from today",
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
    });

    // لو الدكتور حدد تاريخ فولو أب، اعمل Followup تلقائي مربوط بالـ consultation دي
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
    const consultations = await Consultation.find({ doctorId: req.user.id })
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
    const consultation = await Consultation.findById(req.params.id).populate(
      "patientId",
      "name age",
    );

    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: "Consultation not found",
      });
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
      return res.status(404).json({
        success: false,
        message: "Consultation not found",
      });
    }

    res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteConsultation = async (req, res) => {
  try {
    const consultation = await Consultation.findByIdAndDelete(req.params.id);

    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: "Consultation not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Consultation deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
};
