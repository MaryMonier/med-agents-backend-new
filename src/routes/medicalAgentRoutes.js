const express = require('express');
const medicalAgentRouter = express.Router();
const { chat } = require('../agents/medicalAgent');
const authMiddleware = require('../middleware/auth.middleware');

medicalAgentRouter.post('/chat', authMiddleware, chat);

module.exports = medicalAgentRouter;
