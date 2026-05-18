const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/env');

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

module.exports = { register, login, testAI };