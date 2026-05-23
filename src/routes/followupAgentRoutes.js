const express = require('express');
const followupAgentRouter = express.Router();

const { generateFollowupPlan } = require('../agents/followupAgent');
const authMiddleware = require('../middleware/auth.middleware');

followupAgentRouter.post('/generate', authMiddleware, generateFollowupPlan);

module.exports = followupAgentRouter;