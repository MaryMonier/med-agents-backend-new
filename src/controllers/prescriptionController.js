const Prescription = require("../models/Prescription");
const Consultation = require("../models/Consultation");
const Patient = require("../models/Patient");
const { runQuickDrugCheck } = require("../agents/quickDrugCheckAgent");

// ─── Helper: Age from date of birth ──────────────────────────────────────────
const calculateAge = (dob) => {
  if (!dob) return null;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

// ─── Helper: Build a readable display string for a structured medication ────
// Kept so existing UI (PatientHistory / PrescriptionsList) that reads
// med.dose / med.frequency / med.duration keeps working without changes.
// Defensive: also handles older documents saved before dosageAmount/
// frequencyCount/etc existed, which only have the old flat dose/frequency/
// duration strings.
const decorateMedication = (med) => {
  const plain = med?.toObject ? med.toObject() : med;
  if (!plain) return plain;

  const hasStructuredDosage =
    plain.dosageAmount !== undefined && plain.dosageUnit !== undefined;
  const hasStructuredFrequency =
    plain.frequencyCount !== undefined && plain.frequencyPeriod !== undefined;
  const hasStructuredDuration =
    plain.durationValue !== undefined && plain.durationUnit !== undefined;

  const dose = hasStructuredDosage
    ? `${plain.dosageAmount}${plain.dosageUnit}`
    : plain.dose || "";

  const frequency = hasStructuredFrequency
    ? `${plain.frequencyCount}x ${plain.frequencyPeriod}`
    : plain.frequency || "";

  const duration = plain.isChronic
    ? "Lifelong (Chronic)"
    : hasStructuredDuration
      ? `${plain.durationValue} ${plain.durationUnit}`
      : plain.duration || "";

  return { ...plain, dose, frequency, duration };
};

const decorateMedications = (medications = []) =>
  medications.map(decorateMedication);

// ─── Helper: end date for a (non-chronic) medication, given a start date ─────
const getMedicationEndDate = (startDate, med) => {
  if (med.isChronic) return null; // never ends
  const end = new Date(startDate);
  const value = Number(med.durationValue) || 0;
  if (med.durationUnit === "days") end.setDate(end.getDate() + value);
  else if (med.durationUnit === "weeks") end.setDate(end.getDate() + value * 7);
  else if (med.durationUnit === "months") end.setMonth(end.getMonth() + value);
  return end;
};

// ─── Helper: is a medication from a past prescription still "active" now ────
// Active = isChronic (lifelong) OR end date (createdAt + duration) is in the future.
const isMedicationStillActive = (prescriptionCreatedAt, med) => {
  if (med.isChronic) return true;
  const end = getMedicationEndDate(prescriptionCreatedAt, med);
  if (!end) return true;
  return end.getTime() > Date.now();
};

// ─── Helper: find ongoing medications for a patient (excluding one prescription) ─
const findOngoingMedicationConflicts = async (
  patientId,
  newMedications,
  excludePrescriptionId = null,
) => {
  const query = { patientId };
  if (excludePrescriptionId) query._id = { $ne: excludePrescriptionId };

  const pastPrescriptions = await Prescription.find(query).sort({
    createdAt: -1,
  });

  const conflicts = [];
  const newNames = newMedications.map((m) => m.name.trim().toLowerCase());
  const newIngredients = newMedications
    .map((m) => m.activeIngredient?.trim().toLowerCase())
    .filter(Boolean);

  pastPrescriptions.forEach((presc) => {
    presc.medications.forEach((med) => {
      if (!isMedicationStillActive(presc.createdAt, med)) return;

      const matchesName = newNames.includes(med.name.trim().toLowerCase());
      const matchesIngredient =
        med.activeIngredient &&
        newIngredients.includes(med.activeIngredient.trim().toLowerCase());
      if (!matchesName && !matchesIngredient) return;

      conflicts.push({
        name: med.name,
        activeIngredient: med.activeIngredient || null,
        prescriptionId: presc._id,
        consultationId: presc.consultationId,
        prescribedOn: presc.createdAt,
        isChronic: med.isChronic,
        endsOn: med.isChronic
          ? null
          : getMedicationEndDate(presc.createdAt, med),
      });
    });
  });

  return conflicts;
};

// ─── Helper: run the Quick Drug Check agent for every medication in a
// prescription, attaching a single short sentence (or null) to each one.
// Each medication is checked against: the OTHER medications in this same
// prescription + any still-active medications from the patient's previous
// prescriptions (the "ongoing conflict" case is folded into this single
// message instead of being a separate warning), plus allergies and age.
const runQuickCheckForMedications = async (
  medications,
  patient,
  ongoingConflicts = [],
) => {
  try {
    const age = calculateAge(patient?.dateOfBirth);
    const allergies = patient?.allergies || [];

    const ongoingAsActive = ongoingConflicts.map((c) => ({
      name: c.name,
      activeIngredient: c.activeIngredient || null,
      isChronic: c.isChronic,
    }));

    const results = await Promise.all(
      medications.map(async (med, index) => {
        const otherMedsInThisPrescription = medications
          .filter((_, i) => i !== index)
          .map((m) => ({
            name: m.name,
            activeIngredient: m.activeIngredient || null,
          }));

        const activeMedications = [
          ...otherMedsInThisPrescription,
          ...ongoingAsActive,
        ];

        const result = await runQuickDrugCheck({
          newDrug: {
            name: med.name,
            activeIngredient: med.activeIngredient || null,
            dosageAmount: med.dosageAmount || null,
            dosageUnit: med.dosageUnit || null,
            frequencyCount: med.frequencyCount || null,
            frequencyPeriod: med.frequencyPeriod || null,
          },
          activeMedications,
          allergies,
          patientAge: age,
          patientGender: patient?.gender || null,
          language: "en",
        });

        return result?.success ? result.data?.message || null : null;
    }),
  );

  return medications.map((med, i) => ({
    ...med,
    quickCheckMessage: results[i],
  }));
  } catch (error) {
    // مهما حصل هنا، السيف الفعلي بتاع الروشتة (الجرعة/التكرار/المدة) أهم
    // من رسالة الـ quick check — فمنسيبش الإكسبشن يوقف عملية الحفظ خالص
    console.error(
      "Quick check pass failed, saving medications without check messages:",
      error.message,
    );
    return medications.map((med) => ({ ...med, quickCheckMessage: null }));
  }
};

// ─── Search Drugs from FDA (for autocomplete dropdown) ───────────────────────
// GET /api/prescriptions/drugs/search?name=aspirin
const searchDrugs = async (req, res, next) => {
  try {
    const { name } = req.query;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Drug name is required",
      });
    }

    const drugName = encodeURIComponent(name.trim());
    const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${drugName}"+openfda.generic_name:"${drugName}"&limit=10`;

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    const data = await response.json();
    const results = data.results || [];

    // بنرجع بيانات مبسطة مش الـ response كامل
    const seen = new Set();
    const drugs = [];
    results.forEach((drug) => {
      const brandName = drug.openfda?.brand_name?.[0] || null;
      const genericName = drug.openfda?.generic_name?.[0] || null;
      const displayName = brandName || genericName || "N/A";
      const key = displayName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      drugs.push({
        brandName: brandName || "N/A",
        genericName: genericName || "N/A",
        displayName,
        manufacturer: drug.openfda?.manufacturer_name?.[0] || "N/A",
        dosageForms: drug.openfda?.dosage_form || [],
        route: drug.openfda?.route?.[0] || "N/A",
      });
    });

    res.status(200).json({
      success: true,
      count: drugs.length,
      data: drugs,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Check medication safety (Quick Drug Check agent) ────────────────────────
// Used live by the consultation form while the doctor is building the
// prescription, BEFORE hitting "Save Prescription". Returns one short
// sentence per medication (or null when clean) — same agent/format used by
// the dashboard's Quick Drug Check.
// POST /api/prescriptions/safety-check
// body: { patientId, medications: [{ name, dosageAmount, dosageUnit, ... }] }
const checkPrescriptionSafety = async (req, res, next) => {
  try {
    const { patientId, medications } = req.body;

    if (!patientId) {
      return res
        .status(400)
        .json({ success: false, message: "patientId is required" });
    }
    if (!Array.isArray(medications) || medications.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "medications array is required" });
    }
    if (!medications.every((m) => m.name && m.name.trim())) {
      return res
        .status(400)
        .json({ success: false, message: "Each medication must have a name" });
    }

    const patient = await Patient.findById(patientId).select(
      "name gender allergies chronicConditions dateOfBirth",
    );
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    const age = calculateAge(patient.dateOfBirth);

    const ongoingConflicts = await findOngoingMedicationConflicts(
      patientId,
      medications,
      req.body.excludePrescriptionId || null,
    );

    const checkedMedications = await runQuickCheckForMedications(
      medications,
      patient,
      ongoingConflicts,
    );

    return res.status(200).json({
      success: true,
      data: {
        patient: { id: patient._id, name: patient.name, age },
        medications: checkedMedications,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Create Prescription ──────────────────────────────────────────────────────
const createPrescription = async (req, res, next) => {
  try {
    const { consultationId, patientId, medications, language } = req.body;

    if (!Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one medication is required",
      });
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      const err = new Error("Consultation not found");
      err.status = 404;
      return next(err);
    }

    if (
      req.user.role !== "admin" &&
      consultation.doctorId.toString() !== req.user.id.toString()
    ) {
      const err = new Error(
        "Not authorized to prescribe for this consultation",
      );
      err.status = 403;
      return next(err);
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      const err = new Error("Patient not found");
      err.status = 404;
      return next(err);
    }

    const ongoingConflicts = await findOngoingMedicationConflicts(
      patientId,
      medications,
    );
    const medicationsWithQuickCheck = await runQuickCheckForMedications(
      medications,
      patient,
      ongoingConflicts,
    );

    const prescription = await Prescription.create({
      consultationId,
      patientId,
      doctorId: req.user.id,
      medications: medicationsWithQuickCheck,
      language: language || consultation.language,
    });

    const populated = await Prescription.findById(prescription._id)
      .populate("patientId", "name dateOfBirth gender allergies nationalID")
      .populate("consultationId", "symptoms diagnosis createdAt followupId");

    res.status(201).json({
      success: true,
      message: "Prescription created successfully",
      data: {
        ...populated.toObject(),
        medications: decorateMedications(populated.medications),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get distinct dates that have prescriptions (for calendar highlighting) ──
// GET /api/prescriptions/dates
const getPrescriptionDates = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === "admin";
    const filter = isAdmin ? {} : { doctorId: req.user.id };

    const prescriptions = await Prescription.find(filter).select("createdAt");
    const dateSet = new Set(
      prescriptions.map((p) => p.createdAt.toISOString().split("T")[0]),
    );

    res.status(200).json({
      success: true,
      data: Array.from(dateSet),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get All Prescriptions for the logged-in doctor (with optional search) ──
// GET /api/prescriptions?search=name-or-nationalID&date=YYYY-MM-DD&page=1&limit=10
const getAllPrescriptions = async (req, res, next) => {
  try {
    const { search, date, page = 1, limit = 10 } = req.query;
    const isAdmin = req.user.role === "admin";
    const filter = isAdmin ? {} : { doctorId: req.user.id };

    if (search && search.trim()) {
      const matchingPatients = await Patient.find({
        $or: [
          { name: { $regex: search.trim(), $options: "i" } },
          { nationalID: { $regex: search.trim(), $options: "i" } },
        ],
      }).select("_id");
      filter.patientId = { $in: matchingPatients.map((p) => p._id) };
    }

    if (date) {
      const dayStart = new Date(date);
      if (!isNaN(dayStart.getTime())) {
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        filter.createdAt = { $gte: dayStart, $lt: dayEnd };
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Prescription.countDocuments(filter);

    const prescriptions = await Prescription.find(filter)
      .populate("patientId", "name dateOfBirth gender allergies nationalID")
      .populate({
        path: "consultationId",
        select: "followupId doctorId diagnosis symptoms createdAt",
        populate: { path: "doctorId", select: "name" },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const data = prescriptions.map((p) => ({
      ...p.toObject(),
      medications: decorateMedications(p.medications),
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Prescription by Consultation ────────────────────────────────────────
const getPrescriptionByConsultation = async (req, res, next) => {
  try {
    const prescription = await Prescription.findOne({
      consultationId: req.params.consultationId,
    })
      .populate("patientId", "name dateOfBirth gender bloodType allergies")
      .populate("consultationId", "symptoms diagnosis urgencyLevel");

    if (!prescription) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...prescription.toObject(),
        medications: decorateMedications(prescription.medications),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get All Prescriptions for a Patient ─────────────────────────────────────
const getPrescriptionsByPatient = async (req, res, next) => {
  try {
    const prescriptions = await Prescription.find({
      patientId: req.params.patientId,
    })
      .populate("consultationId", "symptoms diagnosis createdAt")
      .sort({ createdAt: -1 });

    const data = prescriptions.map((p) => ({
      ...p.toObject(),
      medications: decorateMedications(p.medications),
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Single Prescription by ID ───────────────────────────────────────────
const getPrescriptionById = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate(
        "patientId",
        "name dateOfBirth gender bloodType allergies chronicConditions nationalID",
      )
      .populate(
        "consultationId",
        "symptoms diagnosis urgencyLevel suggestedSpecialist",
      );

    if (!prescription) {
      const err = new Error("Prescription not found");
      err.status = 404;
      return next(err);
    }

    res.status(200).json({
      success: true,
      data: {
        ...prescription.toObject(),
        medications: decorateMedications(prescription.medications),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Update Prescription ──────────────────────────────────────────────────────
const updatePrescription = async (req, res, next) => {
  try {
    console.log(
      `[updatePrescription] id=${req.params.id} medsCount=${req.body?.medications?.length ?? "n/a"}`,
    );

    const prescription = await Prescription.findById(req.params.id).populate(
      "consultationId",
      "doctorId",
    );

    if (!prescription) {
      const err = new Error("Prescription not found");
      err.status = 404;
      return next(err);
    }

    if (
      req.user.role !== "admin" &&
      prescription.consultationId.doctorId.toString() !== req.user.id.toString()
    ) {
      const err = new Error("Not authorized to update this prescription");
      err.status = 403;
      return next(err);
    }

    const { medications, language } = req.body;

    let updatedMedications = medications;

    if (medications) {
      if (!Array.isArray(medications) || medications.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one medication is required",
        });
      }

      const patient = await Patient.findById(prescription.patientId);

      const ongoingConflicts = await findOngoingMedicationConflicts(
        prescription.patientId,
        medications,
        prescription._id,
      );

      updatedMedications = await runQuickCheckForMedications(
        medications,
        patient,
        ongoingConflicts,
      );
    }

    const updated = await Prescription.findByIdAndUpdate(
      req.params.id,
      {
        ...(medications && { medications: updatedMedications }),
        ...(language && { language }),
      },
      { new: true, runValidators: true },
    )
      .populate("patientId", "name dateOfBirth gender allergies nationalID")
      .populate("consultationId", "symptoms diagnosis createdAt followupId");

    res.status(200).json({
      success: true,
      message: "Prescription updated successfully",
      data: {
        ...updated.toObject(),
        medications: decorateMedications(updated.medications),
      },
    });
  } catch (err) {
    console.error("[updatePrescription] FAILED:", err.message);
    next(err);
  }
};

// ─── Delete Prescription ──────────────────────────────────────────────────────
const deletePrescription = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id).populate(
      "consultationId",
      "doctorId",
    );

    if (!prescription) {
      const err = new Error("Prescription not found");
      err.status = 404;
      return next(err);
    }

    // لو الكونسلتيشن اتمسحت، نسمح للـ admin بس يحذف
    // أو لو الكونسلتيشن موجودة نشيك على الدكتور عادي
    const isAdmin = req.user.role === "admin";
    const consultationExists = !!prescription.consultationId;

    if (consultationExists) {
      const isDoctor =
        prescription.consultationId.doctorId?.toString() ===
        req.user.id.toString();
      if (!isDoctor && !isAdmin) {
        const err = new Error("Not authorized to delete this prescription");
        err.status = 403;
        return next(err);
      }
    } else if (!isAdmin) {
      const err = new Error("Not authorized to delete this prescription");
      err.status = 403;
      return next(err);
    }

    await prescription.deleteOne();

    res.status(200).json({
      success: true,
      message: "Prescription deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  searchDrugs,
  checkPrescriptionSafety,
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  getPrescriptionDates,
  updatePrescription,
  deletePrescription,
  getAllPrescriptions,
};
