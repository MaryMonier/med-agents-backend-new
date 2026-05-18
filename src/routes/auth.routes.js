const express = require('express');
const router = express.Router();
const { register, login, testAI } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', login);
router.post('/test-ai', testAI);
module.exports = router;