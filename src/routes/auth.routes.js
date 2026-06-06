const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const adminMiddleware = require('../middleware/admin.middleware');
const { register, login, testAI, getAllDoctors, getDoctorById, updateDoctor, deleteDoctor, createAdmin, logout } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authMiddleware,logout);
router.post('/test-ai', testAI);
router.post('/create-admin', createAdmin);

// router.get('/doctors', authMiddleware, getAllDoctors);
router.get('/doctors/:id', authMiddleware, getDoctorById);
router.put('/doctors/:id', authMiddleware, adminMiddleware, updateDoctor);
router.delete('/doctors/:id', authMiddleware, adminMiddleware, deleteDoctor);
router.get('/doctors', authMiddleware, adminMiddleware, getAllDoctors); // admin بس

module.exports = router;