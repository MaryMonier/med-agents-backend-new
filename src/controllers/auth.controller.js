const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/env');
const BlacklistedToken = require('../models/BlacklistedToken');
const { chatCompletion } = require('../services/openai.service');


const register = async (req, res) => {
  console.log(req.body);
  
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

const getDoctorById = async (req, res) => {
  try {
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

const deleteDoctor = async (req, res) => {
  try {
    const doctor = await User.findByIdAndDelete(req.params.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });
    res.json({ success: true, message: 'Doctor deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, secretKey } = req.body;

    // secret key عشان محدش يعمل admin من غير إذن
    if (secretKey !== 'MED_AGENTS_ADMIN_2024') {
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

module.exports = { register, login, logout,testAI, getAllDoctors, getDoctorById, updateDoctor, deleteDoctor, createAdmin,updateMyProfile };
// module.exports = { register, login, testAI, getAllDoctors, getDoctorById, updateDoctor, deleteDoctor };

// module.exports = { register, login, testAI };




