const express = require('express');
const followupAgentRouter = express.Router();

const { generateFollowupPlan } = require('../agents/followupAgent');
const authMiddleware = require('../middleware/auth.middleware');
const checkSubscription = require('../middleware/checkSubscription.middleware');

followupAgentRouter.post('/generate', authMiddleware,checkSubscription, generateFollowupPlan);

module.exports = followupAgentRouter;