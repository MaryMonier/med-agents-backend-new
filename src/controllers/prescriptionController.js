const Prescription = require('../models/Prescription');
const Consultation = require('../models/Consultation');
const Patient = require('../models/Patient');

const checkInteractions = async (medications) => {
  const foundInteractions = [];
  const foundWarnings = [];

  await Promise.all(
    medications.map(async (med) => {
      try {
        const drugName = encodeURIComponent(med.name);
        const url = `https://api.fda.gov/drug/label.json?search=drug_interactions:"${drugName}"&limit=1`;

        const response = await fetch(url);

        if (!response.ok) return;

        const data = await response.json();
        const result = data.results?.[0];
        if (!result) return;

        if (result.drug_interactions?.length > 0) {
          const interactionText = result.drug_interactions[0].slice(0, 300);
          foundInteractions.push(`${med.name}: ${interactionText}`);
        }

        if (result.warnings?.length > 0) {
          const warningText = result.warnings[0].slice(0, 300);
          foundWarnings.push(`${med.name}: ${warningText}`);
        }

        if (result.boxed_warning?.length > 0) {
          const boxedText = result.boxed_warning[0].slice(0, 300);
          foundWarnings.push(`[BOXED WARNING] ${med.name}: ${boxedText}`);
        }
      } catch (err) {
        console.error(`OpenFDA error for ${med.name}:`, err.message);
      }
    })
  );

  return { interactions: foundInteractions, warnings: foundWarnings };
};


const createPrescription = async (req, res, next) => {
  try {
    const { consultationId, patientId, medications, language } = req.body;

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      const err = new Error('Consultation not found');
      err.status = 404;
      return next(err);
    }

    if (consultation.doctorId.toString() !== req.user._id.toString()) {
      const err = new Error('Not authorized to prescribe for this consultation');
      err.status = 403;
      return next(err);
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      const err = new Error('Patient not found');
      err.status = 404;
      return next(err);
    }

    const { interactions, warnings } = await checkInteractions(medications);

    const allergyWarnings = [];
    if (patient.allergies && patient.allergies.length > 0) {
      medications.forEach((med) => {
        patient.allergies.forEach((allergy) => {
          if (med.name.toLowerCase().includes(allergy.toLowerCase())) {
            allergyWarnings.push(
              `Patient is allergic to ${allergy} — check ${med.name}`
            );
          }
        });
      });
    }

    const prescription = await Prescription.create({
      consultationId,
      patientId,
      medications,
      interactions,
      warnings: [...warnings, ...allergyWarnings],
      language: language || consultation.language,
    });

    res.status(201).json({
      success: true,
      message: 'Prescription created successfully',
      data: prescription,
    });
  } catch (err) {
    next(err);
  }
};


const getPrescriptionByConsultation = async (req, res, next) => {
  try {
    const prescription = await Prescription.findOne({
      consultationId: req.params.consultationId,
    })
      .populate('patientId', 'name dateOfBirth gender bloodType allergies')
      .populate('consultationId', 'symptoms diagnosis urgencyLevel');

    if (!prescription) {
      const err = new Error('Prescription not found for this consultation');
      err.status = 404;
      return next(err);
    }

    res.status(200).json({ success: true, data: prescription });
  } catch (err) {
    next(err);
  }
};


const getPrescriptionsByPatient = async (req, res, next) => {
  try {
    const prescriptions = await Prescription.find({
      patientId: req.params.patientId,
    })
      .populate('consultationId', 'symptoms diagnosis createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (err) {
    next(err);
  }
};


const getPrescriptionById = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('patientId', 'name dateOfBirth gender bloodType allergies chronicConditions')
      .populate('consultationId', 'symptoms diagnosis urgencyLevel suggestedSpecialist');

    if (!prescription) {
      const err = new Error('Prescription not found');
      err.status = 404;
      return next(err);
    }

    res.status(200).json({ success: true, data: prescription });
  } catch (err) {
    next(err);
  }
};


const updatePrescription = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id).populate(
      'consultationId',
      'doctorId'
    );

    if (!prescription) {
      const err = new Error('Prescription not found');
      err.status = 404;
      return next(err);
    }

    if (
      prescription.consultationId.doctorId.toString() !==
      req.user._id.toString()
    ) {
      const err = new Error('Not authorized to update this prescription');
      err.status = 403;
      return next(err);
    }

    const { medications, language } = req.body;

    let interactions = prescription.interactions;
    let warnings = prescription.warnings;

    if (medications) {
      const patient = await Patient.findById(prescription.patientId);
      const interactionResult = await checkInteractions(medications);
      interactions = interactionResult.interactions;
      warnings = interactionResult.warnings;

      if (patient?.allergies?.length > 0) {
        medications.forEach((med) => {
          patient.allergies.forEach((allergy) => {
            if (med.name.toLowerCase().includes(allergy.toLowerCase())) {
              warnings.push(`Patient is allergic to ${allergy} — check ${med.name}`);
            }
          });
        });
      }
    }

    const updated = await Prescription.findByIdAndUpdate(
      req.params.id,
      {
        ...(medications && { medications }),
        ...(language && { language }),
        interactions,
        warnings,
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Prescription updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};


const deletePrescription = async (req, res, next) => {
  try {
    const prescription = await Prescription.findById(req.params.id).populate(
      'consultationId',
      'doctorId'
    );

    if (!prescription) {
      const err = new Error('Prescription not found');
      err.status = 404;
      return next(err);
    }

    const isDoctor =
      prescription.consultationId.doctorId.toString() ===
      req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isDoctor && !isAdmin) {
      const err = new Error('Not authorized to delete this prescription');
      err.status = 403;
      return next(err);
    }

    await prescription.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Prescription deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};


module.exports = {
  createPrescription,
  getPrescriptionByConsultation,
  getPrescriptionsByPatient,
  getPrescriptionById,
  updatePrescription,
  deletePrescription,
};
