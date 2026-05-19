const { getAllPatients, getPatientById, createPatient, deletePatient, updatePatient } = require("./patient.controller")
const authMiddleware = require('../middleware/auth.middleware');

const router = require("express").Router()

router.get("/",getAllPatients)
router.get("/:id",getPatientById)
router.post('/', authMiddleware, createPatient);
// router.post("/",createPatient)
router.delete("/:id",deletePatient)
router.patch("/:id",updatePatient)


module.exports = router