const express = require('express');
const medicalAgentRouter = express.Router();
const { chat } = require('../agents/medicalAgent');
const authMiddleware = require('../middleware/auth.middleware');
const checkSubscription = require('../middleware/checkSubscription.middleware');
medicalAgentRouter.post('/chat', authMiddleware,checkSubscription,chat);

module.exports = medicalAgentRouter;
