const { getAllPatients, getPatientById, createPatient, deletePatient, updatePatient } = require("./patient.controller")

const router = require("express").Router()
const authMiddleware = require("../middleware/auth.middleware")

router.get("/",authMiddleware,getAllPatients)
router.get("/:id",authMiddleware,getPatientById)
router.post("/",authMiddleware,createPatient)
router.delete("/:id",authMiddleware,deletePatient)
router.patch("/:id",authMiddleware,updatePatient)


module.exports = router