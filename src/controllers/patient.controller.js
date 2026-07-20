const Patient = require("../models/Patient");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const Followup = require("../models/Followup");

// أدمن يقدر يوصل لأي مريض. الدكتور العادي لازم يكون هو اللي أنشأ المريض ده
// أو يكون ضايف نفسه في patient.doctors (عن طريق عمل consultation له قبل كده).
const canAccessPatient = (user, patient) => {
  if (user.role === "admin") return true;
  const userId = String(user.id);

  // patient.createdBy ممكن يكون ID نصي عادي، أو object كامل لو الكويري
  // عملتله .populate("createdBy") (زي getPatientHistory) - لازم ناخد
  // الـ _id بتاعه في الحالة دي، مش نعمل String() على الـ object نفسه
  // (اللي كان بيرجّع "[object Object]" ودايمًا يفشل في المقارنة).
  const createdById = patient.createdBy?._id
    ? String(patient.createdBy._id)
    : String(patient.createdBy);
  if (createdById === userId) return true;

  // نفس الفكرة لو doctors[] فيها عناصر populated بدل IDs عادية
  return (patient.doctors || []).some(
    (d) => String(d?._id || d) === userId,
  );
};

// Build readable display fields for a structured medication, matching what
// the frontend (PatientHistory, PrescriptionsList, PatientReport) expects:
// dosage, frequency, duration as plain strings. Defensive: also handles
// older documents saved before dosageAmount/frequencyCount/etc existed.
const decorateMedicationForDisplay = (med) => {
  if (!med) return med;

  const hasStructuredDosage = med.dosageAmount !== undefined && med.dosageUnit !== undefined;
  const hasStructuredFrequency = med.frequencyCount !== undefined && med.frequencyPeriod !== undefined;
  const hasStructuredDuration = med.durationValue !== undefined && med.durationUnit !== undefined;

  return {
    ...med,
    dosage: hasStructuredDosage ? `${med.dosageAmount}${med.dosageUnit}` : med.dosage || med.dose || '',
    frequency: hasStructuredFrequency ? `${med.frequencyCount}x ${med.frequencyPeriod}` : med.frequency || '',
    duration: med.isChronic
      ? 'Lifelong (Chronic)'
      : hasStructuredDuration
        ? `${med.durationValue} ${med.durationUnit}`
        : med.duration || '',
  };
};

const getAllPatientsByDoctor = async (request, response) => {
  try {
    const createdBy = request.user.id;
    const { search, page = 1, limit = 10 } = request.query;

    const skip = (page - 1) * limit;

    if (search) {
      const allPatients = await Patient.find({
        $and: [
          { $or: [{ createdBy }, { doctors: createdBy }] },
          {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { nationalID: { $regex: search, $options: "i" } },
            ],
          },
        ],
      });

      return response.status(200).json({
        success: true,
        data: allPatients,
        pagination: null,
      });
    }
    const totalPatients = await Patient.countDocuments({$or:[{ createdBy},{ doctors:createdBy}]});
    const allPatients = await Patient.find({$or:[{ createdBy},{ doctors:createdBy}]}).sort({ createdAt: -1 })
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

    // مش بس المرضى اللي الدكتور ده أنشأهم (createdBy) - كمان المرضى اللي كانوا
    // موجودين قبل كده (أنشأهم دكتور تاني) وعمل الدكتور ده لهم consultation
    // (وده بيضيفه لـ patient.doctors تلقائي في createConsultation)
    const doctorFilter = { $or: [{ createdBy: doctorId }, { doctors: doctorId }] };

    const totalPatients = await Patient.countDocuments(doctorFilter);
    const patients = await Patient.find(doctorFilter)
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
    // ده الـ endpoint اللي بيرجع كل مرضى النظام من غير أي فلترة - مخصّص
    // للأدمن داشبورد بس. أي دكتور عادي المفروض يستخدم /patients/doctor
    // (getAllPatientsByDoctor) اللي بيرجعله مرضاه هو بس
    if (request.user.role !== "admin") {
      return response.status(403).json({
        success: false,
        message: "Access denied. Admins only.",
      });
    }

    const { search, page = 1, limit = 10 } = request.query;

    const skip = (page - 1) * limit;
    if (search) {
      const allPatients = await Patient.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { nationalID: { $regex: search, $options: "i" } },
        ],
      })
        .sort({ createdAt: -1 })
        .populate("createdBy", "name specialty");

      return response.status(200).json({
        success: true,
        data: allPatients,
        pagination: null,
      });
    }

    const totalPatients = await Patient.countDocuments({});
    const allPatients = await Patient.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("createdBy", "name specialty");

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
    if (!canAccessPatient(request.user, patient)) {
      return response.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
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
      chronicMedications,
      nationalID,
    } = request.body;
    const createdBy = request.user.id;

    if (!name || !dateOfBirth || !gender || !bloodType) {
      return response
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    // الرقم القومي اختياري - لو اتبعت، لازم يكون 14 رقم
    if (nationalID && nationalID.length !== 14) {
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
      chronicMedications,
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
    const id = request.params.id;
    const patient = await Patient.findById(id);
    if (!patient) {
      return response
        .status(404)
        .json({ success: false, message: "patient not found" });
    }
    if (!canAccessPatient(request.user, patient)) {
      return response.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
    }

    // نمسح كل حاجة مرتبطة بالمريض ده عشان مايفضلش سجلات يتيمة (كونسلتيشنز/
    // روشتات/فولو أبس) معلّقة على patientId اتمسح
    await Prescription.deleteMany({ patientId: id });
    await Followup.deleteMany({ patientId: id });
    await Consultation.deleteMany({ patientId: id });
    await Patient.findByIdAndDelete(id);

    return response
      .status(200)
      .json({ success: true, message: "patient and all related records deleted successfully" });
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message });
  }
};
const updatePatient = async (request, response) => {
  try {
    const id = request.params.id;
    const existingPatient = await Patient.findById(id);
    if (!existingPatient) {
      return response
        .status(404)
        .json({ success: false, message: "patient not found" });
    }
    if (!canAccessPatient(request.user, existingPatient)) {
      return response.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
    }

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
        "name dateOfBirth gender bloodType allergies chronicConditions chronicMedications createdBy discontinuedMedications",
      )
      .populate("createdBy", "name specialty email");

    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }
    if (!canAccessPatient(req.user, patient)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
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
        "diagnosis symptoms urgencyLevel suggestedSpecialist structuredNote followupId rawInput createdAt",
      )
      .sort({ createdAt: -1 });

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
          isFollowup: !!consultation.followupId,
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
    if (!canAccessPatient(req.user, patient)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
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

    // لو الدواء ده كان مكتوب في خانة chronicMedications بنفس الاسم، نشيله من
    // هناك كمان عشان الخانة تفضل معبّرة عن اللي المريض فعلاً بياخده دلوقتي
    patient.chronicMedications = (patient.chronicMedications || []).filter(
      (name) =>
        name.trim().toLowerCase() !== medication.name.trim().toLowerCase(),
    );

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
    if (!canAccessPatient(req.user, patient)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This patient is not under your care.",
      });
    }

    const discontinuedEntry = (patient.discontinuedMedications || []).find(
      (d) => String(d.medicationId) === String(medicationId),
    );

    patient.discontinuedMedications = (
      patient.discontinuedMedications || []
    ).filter((d) => String(d.medicationId) !== String(medicationId));

    // نرجع اسم الدواء لخانة chronicMedications تاني (لو كان اتشال من هناك
    // وقت الـ discontinue، ومش موجود بالفعل)
    if (discontinuedEntry?.medicationName) {
      const nameLower = discontinuedEntry.medicationName.trim().toLowerCase();
      const alreadyThere = (patient.chronicMedications || []).some(
        (n) => n.trim().toLowerCase() === nameLower,
      );
      if (!alreadyThere) {
        patient.chronicMedications = [
          ...(patient.chronicMedications || []),
          discontinuedEntry.medicationName,
        ];
      }
    }

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