const Patient = require("../models/Patient");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");

// Build readable display fields for a structured medication, matching what
// the frontend (PatientHistory, PrescriptionsList, PatientReport) expects:
// dosage, frequency, duration as plain strings. Defensive: also handles
// older documents saved before dosageAmount/frequencyCount/etc existed.
const decorateMedicationForDisplay = (med) => {
  if (!med) return med;

  const hasStructuredDosage =
    med.dosageAmount !== undefined && med.dosageUnit !== undefined;
  const hasStructuredFrequency =
    med.frequencyCount !== undefined && med.frequencyPeriod !== undefined;
  const hasStructuredDuration =
    med.durationValue !== undefined && med.durationUnit !== undefined;

  return {
    ...med,
    dosage: hasStructuredDosage
      ? `${med.dosageAmount}${med.dosageUnit}`
      : med.dosage || med.dose || "",
    frequency: hasStructuredFrequency
      ? `${med.frequencyCount}x ${med.frequencyPeriod}`
      : med.frequency || "",
    duration: med.isChronic
      ? "Lifelong (Chronic)"
      : hasStructuredDuration
        ? `${med.durationValue} ${med.durationUnit}`
        : med.duration || "",
  };
};

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
    const totalPatients = await Patient.countDocuments({ createdBy });
    const allPatients = await Patient.find({
      $or: [{ createdBy }, { doctors: createdBy }],
    })
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

const getPatientsByDoctorId = async (request, response) => {
  try {
    const { doctorId } = request.params;

    // Admins can view any doctor's patients. Doctors can only view their own.
    if (request.user.role !== "admin" && request.user.id !== doctorId) {
      return response.status(403).json({
        success: false,
        message: "Access denied. You can only view your own patients.",
      });
    }

    const { page = 1, limit = 10 } = request.query;
    const skip = (page - 1) * limit;

    const filter = { $or: [{ createdBy: doctorId }, { doctors: doctorId }] };

    const totalPatients = await Patient.countDocuments(filter);
    const patients = await Patient.find(filter)
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    return response.status(200).json({
      success: true,
      data: patients,
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

    const patient = await Patient.findById(patientId)
      .select(
        "name dateOfBirth gender bloodType allergies chronicConditions createdBy discontinuedMedications",
      )
      .populate("createdBy", "name specialty email");

    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    // خريطة سريعة: medicationId -> تفاصيل التوقف (لو موجود)
    const discontinuedMap = new Map(
      (patient.discontinuedMedications || []).map((d) => [
        String(d.medicationId),
        d,
      ]),
    );

    const consultations = await Consultation.find({ patientId })
      .select(
        "diagnosis symptoms urgencyLevel suggestedSpecialist structuredNote rawInput followUpDate followupId createdAt",
      )
      .sort({ createdAt: -1 });

    console.log(
      `[getPatientHistory] patientId=${patientId} found ${consultations.length} consultations, ` +
        `first diagnosis="${consultations[0]?.diagnosis}"`,
    );

    const history = await Promise.all(
      consultations.map(async (consultation) => {
        const prescription = await Prescription.findOne({
          consultationId: consultation._id,
        }).select("_id medications");

        return {
          consultationId: consultation._id,
          date: consultation.createdAt,
          symptoms: consultation.symptoms,
          diagnosis: consultation.diagnosis || "Not determined yet",
          urgencyLevel: consultation.urgencyLevel,
          suggestedSpecialist: consultation.suggestedSpecialist || null,
          structuredNote: consultation.structuredNote || null,
          doctorNotes: consultation.rawInput || null,
          followUpDate: consultation.followUpDate || null,
          isFollowup: !!consultation.followupId, // لو كانت من فولو أب
          prescription: prescription
            ? {
                _id: prescription._id,
                medications: prescription.medications.map((m) => {
                  const plain = decorateMedicationForDisplay(
                    m.toObject ? m.toObject() : m,
                  );
                  const discontinuedInfo = discontinuedMap.get(
                    String(plain._id),
                  );
                  return {
                    ...plain,
                    isDiscontinued: !!discontinuedInfo,
                    discontinuedAt: discontinuedInfo?.discontinuedAt || null,
                    discontinuedReason: discontinuedInfo?.reason || null,
                  };
                }),
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

// ─── Discontinue a medication from a PAST prescription without touching that
// prescription at all — just records the event on the patient so future
// interaction/active-medication checks stop counting it as still being taken.
const discontinueMedication = async (req, res) => {
  try {
    const patientId = req.params.id;
    const { prescriptionId, medicationId, reason, discontinuedAt } = req.body;

    if (!prescriptionId || !medicationId) {
      return res.status(400).json({
        success: false,
        message: "prescriptionId and medicationId are required",
      });
    }

    // نتأكد إن الروشتة والدواء دول فعلاً بتوع المريض ده قبل ما نسجل حاجة
    const prescription = await Prescription.findOne({
      _id: prescriptionId,
      patientId,
    }).select("medications");
    if (!prescription) {
      return res
        .status(404)
        .json({ success: false, message: "Prescription not found" });
    }
    const medication = prescription.medications.id(medicationId);
    if (!medication) {
      return res
        .status(404)
        .json({ success: false, message: "Medication not found" });
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    // لو كان متسجل قبل كده، شيل القديم واستبدله (يسمح بتحديث السبب/التاريخ)
    patient.discontinuedMedications = (
      patient.discontinuedMedications || []
    ).filter((d) => String(d.medicationId) !== String(medicationId));

    patient.discontinuedMedications.push({
      prescriptionId,
      medicationId,
      medicationName: medication.name,
      discontinuedAt: discontinuedAt || new Date(),
      discontinuedBy: req.user.id,
      reason: reason || null,
    });

    await patient.save();

    return res.status(200).json({
      success: true,
      message: "Medication marked as discontinued",
      data: patient.discontinuedMedications,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Undo a discontinuation (in case of a mistake) ───────────────────────────
const reactivateMedication = async (req, res) => {
  try {
    const patientId = req.params.id;
    const { medicationId } = req.body;

    if (!medicationId) {
      return res
        .status(400)
        .json({ success: false, message: "medicationId is required" });
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    patient.discontinuedMedications = (
      patient.discontinuedMedications || []
    ).filter((d) => String(d.medicationId) !== String(medicationId));

    await patient.save();

    return res.status(200).json({
      success: true,
      message: "Medication reactivated",
      data: patient.discontinuedMedications,
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
  getPatientsByDoctorId,
  getPatientHistory,
  discontinueMedication,
  reactivateMedication,
};
