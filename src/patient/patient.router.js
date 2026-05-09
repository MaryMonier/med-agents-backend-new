const { getAllPatients, getPatientById, createPatient, deletePatient, updatePatient } = require("./patient.controller")

const router = require("express").Router()

router.get("/",getAllPatients)
router.get("/:id",getPatientById)
router.get("/",createPatient)
router.delete("/:id",deletePatient)
router.patch("/:id",updatePatient)


module.exports = router