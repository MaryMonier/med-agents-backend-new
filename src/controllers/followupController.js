const mongoose = require("mongoose");
const Followup = require("../models/Followup");
const Consultation = require("../models/Consultation");
require("../models/Patient");

const createFollowup = async (req, res) => {
  try {
    const {
      consultationId,
      patientId,
      instructions,
      scheduledDate,
      reminderSent,
      status,
      language,
    } = req.body;

    if (!consultationId || !patientId || !instructions) {
      return res.status(400).json({
        success: false,
        message: "consultationId, patientId, and instructions are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid consultationId",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid patientId",
      });
    }

    const consultation =
      await Consultation.findById(consultationId).select("doctorId");

    const followup = await Followup.create({
      consultationId,
      patientId,
      doctorId: consultation?.doctorId,
      instructions,
      scheduledDate,
      reminderSent,
      status,
      language,
    });

    res.status(201).json({
      success: true,
      message: "Followup created successfully",
      data: followup,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating followup",
      error: error.message,
    });
  }
};

const getFollowups = async (req, res) => {
  try {
    // الدكتور العادي يشوف الفولو أبس بتاعته بس (باستخدام doctorId المسجل
    // على الفولو أب نفسه)، والأدمن يشوف الكل. ده أبسط وأصح من إن الفرونت
    // يجيب كل الفولو أبس ويحاول يفلترها بالاعتماد على endpoint تاني بيستبعد
    // كونسلتيشنز الفولو أب أصلاً (فكانت الفولو أبس الجديدة بتختفي غلط)
    const isAdmin = req.user.role === "admin";
    const filter = isAdmin
      ? { patientId: { $ne: null } }
      : { patientId: { $ne: null }, doctorId: req.user.id };
    const followups = await Followup.find(filter)
      .populate("patientId", "name phone")
      .populate({
        path: "consultationId",
        select:
          "doctorId structuredNote diagnosis symptoms rawInput language isChronic followUpDate",
        populate: { path: "doctorId", select: "name" },
      })
      .populate({
        path: "completionConsultationId",
        select:
          "doctorId structuredNote diagnosis symptoms rawInput language isChronic followUpDate",
        populate: { path: "doctorId", select: "name" },
      })
      .sort({ createdAt: -1 });

    const data = followups.map((f) => ({
      ...f.toObject(),
      lastConsultationNote:
        f.completionConsultationId?.structuredNote ||
        f.consultationId?.structuredNote ||
        null,
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching followups",
      error: error.message,
    });
  }
};

const getFollowupsByDoctorId = async (req, res) => {
  try {
    const { doctorId } = req.params;

    if (req.user.role !== "admin" && req.user.id !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own follow-ups.",
      });
    }

    const followups = await Followup.find({ doctorId })
      .populate("patientId", "name phone")
      .populate({
        path: "consultationId",
        select:
          "structuredNote diagnosis symptoms rawInput language isChronic followUpDate",
      })
      .populate({
        path: "completionConsultationId",
        select:
          "structuredNote diagnosis symptoms rawInput language isChronic followUpDate",
      })
      .sort({ createdAt: -1 });

    const data = followups.map((f) => ({
      ...f.toObject(),
      lastConsultationNote:
        f.completionConsultationId?.structuredNote ||
        f.consultationId?.structuredNote ||
        null,
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching follow-ups for doctor",
      error: error.message,
    });
  }
};

const getFollowupById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid followup id",
      });
    }

    const followup = await Followup.findById(id)
      .populate(
        "patientId",
        "name allergies chronicConditions dateOfBirth gender phone",
      )
      .populate({
        path: "consultationId",
        populate: { path: "doctorId", select: "name" },
      })
      .populate({
        path: "completionConsultationId",
        populate: { path: "doctorId", select: "name" },
      });

    if (!followup) {
      return res.status(404).json({
        success: false,
        message: "Followup not found",
      });
    }
    if (
      req.user.role !== "admin" &&
      String(followup.doctorId) !== String(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own follow-ups.",
      });
    }

    res.status(200).json({
      success: true,
      data: followup,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching followup",
      error: error.message,
    });
  }
};

const updateFollowup = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid followup id",
      });
    }

    const existingFollowup = await Followup.findById(id).select("doctorId");
    if (!existingFollowup) {
      return res.status(404).json({
        success: false,
        message: "Followup not found",
      });
    }
    if (
      req.user.role !== "admin" &&
      String(existingFollowup.doctorId) !== String(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only edit your own follow-ups.",
      });
    }

    const followup = await Followup.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Followup updated successfully",
      data: followup,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating followup",
      error: error.message,
    });
  }
};

const deleteFollowup = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid followup id",
      });
    }

    const followup = await Followup.findById(id).select("doctorId");
    if (!followup) {
      return res.status(404).json({
        success: false,
        message: "Followup not found",
      });
    }
    if (
      req.user.role !== "admin" &&
      String(followup.doctorId) !== String(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete your own follow-ups.",
      });
    }

    await Followup.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Followup deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting followup",
      error: error.message,
    });
  }
};

module.exports = {
  createFollowup,
  getFollowups,
  getFollowupsByDoctorId,
  getFollowupById,
  updateFollowup,
  deleteFollowup,
};
