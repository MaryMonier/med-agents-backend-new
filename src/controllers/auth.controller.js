const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET, ADMIN_SECRET_KEY } = require('../config/env');
const BlacklistedToken = require('../models/BlacklistedToken');
const Patient = require('../models/Patient');
const Consultation = require('../models/Consultation');
const Prescription = require('../models/Prescription');
const Followup = require('../models/Followup');
const { chatCompletion } = require('../services/openai.service');


const register = async (req, res) => {
  try {
    const { name, email, password, specialty, language } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, specialty, language });

    res.status(201).json({ success: true, data: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'This account has been deactivated. Please contact the admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, language: user.language },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, data: { token, name: user.name, role: user.role, language: user.language } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ⚠️ endpoint داخلي للتجربة بس - لازم يكون فيه authMiddleware على الراوت
// (اتضاف في auth.routes.js) عشان محدش يستهلك الـ AI budget من غير تسجيل دخول.
const testAI = async (req, res) => {
  try {
    const result = await chatCompletion({
      systemPrompt: 'You are a medical assistant.',
      userMessage: req.body.message,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllDoctors = async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' }).select('-passwordHash');
    res.json({ success: true, count: doctors.length, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// أدمن يشوف أي دكتور، الدكتور العادي يشوف بروفايله هو بس
const getDoctorById = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own profile.',
      });
    }

    const doctor = await User.findById(req.params.id).select('-passwordHash');
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });
    res.json({ success: true, data: doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateDoctor = async (req, res) => {
  try {
    const { name, email, specialty, language } = req.body;
    const doctor = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, specialty, language },
      { new: true }
    ).select('-passwordHash');
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });
    res.json({ success: true, data: doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// بيمسح الدكتور + كل حاجة مرتبطة بيه (كونسلتيشنز، روشتات، فولو أبس اللي هو
// طرف فيها)، وبيشيله من مصفوفة doctors بتاعة أي مريض كان بيتابعه، عشان
// نتجنب سجلات يتيمة معلّقة على user اتمسح.
const deleteDoctor = async (req, res) => {
  try {
    const doctorId = req.params.id;
    const doctor = await User.findById(doctorId);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });

    // المرضى اللي الدكتور ده هو اللي أنشأهم (createdBy) - المطلوب دلوقتي
    // إنهم يتحذفوا نهائيًا مع الدكتور، بكل السجلات المرتبطة بيهم (كونسلتيشنز/
    // روشتات/فوللو أب) عشان محدش يفضل معلّق على مريض متمسوح.
    const ownedPatients = await Patient.find({ createdBy: doctorId }).select('_id');
    const ownedPatientIds = ownedPatients.map((p) => p._id);

    if (ownedPatientIds.length > 0) {
      await Consultation.deleteMany({ patientId: { $in: ownedPatientIds } });
      await Prescription.deleteMany({ patientId: { $in: ownedPatientIds } });
      await Followup.deleteMany({ patientId: { $in: ownedPatientIds } });
      await Patient.deleteMany({ _id: { $in: ownedPatientIds } });
    }

    // المرضى اللي الدكتور ده مش اللي أنشأهم بس عمل معاهم كونسلتيشن (موجود في
    // doctors[])، دول بيفضلوا موجودين (ليهم دكتور تاني أساسي)، بس بنشيل
    // ربط الدكتور المحذوف منهم بس.
    await Patient.updateMany(
      { doctors: doctorId },
      { $pull: { doctors: doctorId } }
    );

    // كونسلتيشنز/روشتات/فوللو أب المتبقيين (على مرضى مش هو صاحبهم) واللي
    // عملهم الدكتور ده بنفسه - بتتحذف زي الأول.
    await Consultation.deleteMany({ doctorId });
    await Prescription.deleteMany({ doctorId });
    await Followup.deleteMany({ doctorId });

    await User.findByIdAndDelete(doctorId);

    res.json({ success: true, message: 'Doctor and related records deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createAdmin = async (req, res) => {
  try {
    const { name, email, password, secretKey } = req.body;

    // secret key عشان محدش يعمل admin من غير إذن - لازم يكون متظبط في .env
    if (!ADMIN_SECRET_KEY || secretKey !== ADMIN_SECRET_KEY) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role: 'admin' });

    res.status(201).json({ success: true, data: { id: user._id, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(400).json({ success: false, message: 'No token ' });
    }

    await BlacklistedToken.create({ token });

    return res.status(200).json({ success: true, message: 'Logged out successfully' });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const { confirmEmail, name, specialty, language, newPassword } = req.body;

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (confirmEmail !== currentUser.email) {
      return res.status(403).json({ success: false, message: 'Email confirmation does not match your account email' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (specialty) updates.specialty = specialty;
    if (language) updates.language = language;

    if (newPassword) {
      updates.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true }
    ).select('-passwordHash');

    res.json({ success: true, data: updatedUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { register, login, logout, testAI, getAllDoctors, getDoctorById, updateDoctor, deleteDoctor, createAdmin, updateMyProfile };