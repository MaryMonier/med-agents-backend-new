const Consultation = require('../models/Consultation');
const { runClinicalRecAgent } = require('../agents/clinicalRecAgent');


const createConsultation = async (req, res) => {
  try {
    const { patientId, symptoms, diagnosis, rawInput, language } = req.body;

  
    const agentResult = await runClinicalRecAgent({
      rawInput,
      symptoms,
      diagnosis,
      language: language || 'en'
    });

    const consultation = await Consultation.create({
      patientId,
      doctorId:         req.user.id,      
      symptoms,
      diagnosis,
      rawInput,
      structuredNote:   agentResult.structuredNote,
      suggestedSpecialist: agentResult.suggestedSpecialist,
      urgencyLevel:     agentResult.urgencyLevel,
      language:         language || 'en',
      status:           'completed'
    });

    res.status(201).json({
      success: true,
      message: 'Consultation created successfully',
      data: consultation
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


const getAllConsultations = async (req, res) => {
  try {
    const consultations = await Consultation.find({ doctorId: req.user.id })
      .populate('patientId', 'name age')   
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


const getConsultationById = async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id)
      .populate('patientId', 'name age');

    if (!consultation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Consultation not found' 
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
      { new: true, runValidators: true }
    );

    if (!consultation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Consultation not found' 
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
        message: 'Consultation not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Consultation deleted successfully' 
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
  deleteConsultation
};