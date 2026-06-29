const Patient = require('../models/Patient');
const { runDrugSafetyAgent } = require('../agents/drugSafetyAgent');

const calculateAge = (dob) => {
  if (!dob) return null;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

// & POST /api/drug-safety/check
const checkDrugSafety = async (req, res) => {
  try {
    const { medications, language } = req.body;

    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({ success: false, message: 'medications array is required' });
    }

    const isValid = medications.every((m) => m.name);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Each medication must have at least a name' });
    }

    const result = await runDrugSafetyAgent({ medications, language });

    if (result.error) {
      return res.status(200).json({ success: false, message: result.message, data: result.fallback });
    }

    return res.status(200).json({ success: true, data: result.data });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// & POST /api/drug-safety/check/:patientId
const checkDrugSafetyForPatient = async (req, res) => {
  try {
    const { medications, language } = req.body;
    const { patientId } = req.params;

    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({ success: false, message: 'medications array is required' });
    }

    const isValid = medications.every((m) => m.name);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Each medication must have at least a name' });
    }

    const patient = await Patient.findById(patientId).select('name allergies chronicConditions dateOfBirth');
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    const result = await runDrugSafetyAgent({
      medications,
      allergies: patient.allergies || [],
      chronicConditions: patient.chronicConditions || [],
      age: calculateAge(patient.dateOfBirth),
      language,
    });

    if (result.error) {
      return res.status(200).json({ success: false, message: result.message, data: result.fallback });
    }

    return res.status(200).json({ success: true, patient: { id: patient._id, name: patient.name }, data: result.data });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  checkDrugSafety,
  checkDrugSafetyForPatient,
};