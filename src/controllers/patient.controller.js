const Patient = require("../models/Patient");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");

const getAllPatientsByDoctor = async (request, response) => {
  try {
    const createdBy = request.user.id;
    const { search, page = 1, limit = 10 } = request.query;

    const skip = (page - 1) * limit;

    if (search) {
      const allPatients = await Patient.find({
        createdBy,
        $or: [
          { name: { $regex: search, $options: "i" } },
          { nationalID: { $regex: search, $options: "i" } },
        ],
      });

      return response.status(200).json({
        success: true,
        data: allPatients,
        pagination: null,
      });
    }
    const totalPatients = await Patient.countDocuments();
    const allPatients = await Patient.find({$or:[{ createdBy},{ doctors:createdBy}]})
      .skip(skip)
      .limit(Number(limit));

    return response.status(200).json({
      success: true,
      data: allPatients,
      pagination: {
        total: totalPatients,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalPatients / limit),
      },
    });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};

const getAllPatients = async (request, response) => {
  try {
    const { search, page = 1, limit = 10 } = request.query;

    const skip = (page - 1) * limit;
    if (search) {
      const allPatients = await Patient.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { nationalID: { $regex: search, $options: "i" } },
        ],
      });

      return response.status(200).json({
        success: true,
        data: allPatients,
        pagination: null,
      });
    }

    const totalPatients = await Patient.countDocuments({});
    const allPatients = await Patient.find({}).skip(skip).limit(Number(limit));

    return response.status(200).json({
      success: true,
      data: allPatients,
      pagination: {
        total: totalPatients,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalPatients / limit),
      },
    });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};

const getPatientById = async (request, response) => {
  try {
    const id = request.params.id;
    const patient = await Patient.findById(id);
    if (!patient) {
      return response
        .status(404)
        .json({ success: false, message: "patient not found" });
    }
    return response.status(200).json({ success: true, data: patient });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};

const createPatient = async (request, response) => {
  try {
    const {
      name,
      dateOfBirth,
      gender,
      bloodType,
      allergies,
      chronicConditions,
      nationalID,
    } = request.body;
    const createdBy = request.user.id;

    if (!name || !dateOfBirth || !gender || !bloodType || !nationalID) {
      return response
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    if (nationalID.length !== 14) {
      return response
        .status(400)
        .json({ success: false, message: "National ID Must be 14 numbers" });
    }

    const patient = await Patient.create({
      name,
      dateOfBirth,
      gender,
      bloodType,
      allergies,
      chronicConditions,
      createdBy,
      nationalID,
    });
    return response.status(201).json({ success: true, data: patient });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};

const deletePatient = async (request, response) => {
  try {
    console.log("Hello delete patient");
    const id = request.params.id;
    const deletedPatient = await Patient.findByIdAndDelete(id);
    if (!deletedPatient) {
      return response
        .status(404)
        .json({ success: false, message: "patient not found" });
    }
    return response
      .status(200)
      .json({ success: true, message: "patient deleted successfully" });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};
const updatePatient = async (request, response) => {
  try {
    console.log("Hello update patient");
    const id = request.params.id;
    const updatedPatient = await Patient.findByIdAndUpdate(id, request.body, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!updatedPatient) {
      return response
        .status(404)
        .json({ success: false, message: "patient not found" });
    }
    return response.status(200).json({ success: true, data: updatedPatient });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};
const getPatientHistory = async (req, res) => {
  try {
    const patientId = req.params.id;

    const patient = await Patient.findById(patientId).select(
      "name dateOfBirth gender bloodType allergies chronicConditions",
    );

    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    const consultations = await Consultation.find({ patientId })
      .select(
        "diagnosis symptoms urgencyLevel suggestedSpecialist structuredNote followupId createdAt",
      )
      .sort({ createdAt: -1 });

    const history = await Promise.all(
      consultations.map(async (consultation) => {
        const prescription = await Prescription.findOne({
          consultationId: consultation._id,
        }).select("medications interactions warnings");

        return {
          consultationId: consultation._id,
          date: consultation.createdAt,
          symptoms: consultation.symptoms,
          diagnosis: consultation.diagnosis || "Not determined yet",
          urgencyLevel: consultation.urgencyLevel,
          suggestedSpecialist: consultation.suggestedSpecialist || null,
          structuredNote: consultation.structuredNote || null,
          isFollowup: !!consultation.followupId, // لو كانت من فولو أب
          prescription: prescription
            ? {
                medications: prescription.medications,
                interactions: prescription.interactions,
                warnings: prescription.warnings,
              }
            : null,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      data: { patient, history },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllPatients,
  getPatientById,
  createPatient,
  deletePatient,
  updatePatient,
  getAllPatientsByDoctor,
  getPatientHistory,
};
