const { getAllPatients, 
    getPatientById,
     createPatient,
     deletePatient, 
     getPatientHistory,
     updatePatient,
    getAllPatientsByDoctor } = require("../controllers/patient.controller")
const adminMiddleware = require("../middleware/admin.middleware")

const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");

router.get("/",authMiddleware,adminMiddleware,getAllPatients)
router.get("/doctor",authMiddleware,getAllPatientsByDoctor)
router.get("/:id",authMiddleware,getPatientById)
router.post("/",authMiddleware,createPatient)
router.delete("/:id",authMiddleware,deletePatient)
router.patch("/:id",authMiddleware,updatePatient)
router.get("/:id/history", authMiddleware, getPatientHistory);

module.exports = router;
