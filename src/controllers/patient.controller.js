
const Patient = require("../models/Patient");

const getAllPatientsByDoctor = async (request, response) => {
    try {const createdBy = request.user.id
        const {search} = request.query
        let allPatients
        if (search) {
             allPatients = await Patient.find({createdBy,$or:[{name:search},{nationalID:search}]})
            
        }
        else{
             allPatients = await Patient.find({createdBy})

        }
         return response.status(200).json({ success: true, data: allPatients })
    } catch (error) {
         return response.status(500).json({ success: false, message: error.message })
    }
}

const getAllPatients = async (request, response) => {
    try {
        const {search} = request.query
        let allPatients
        if (search) {
             allPatients = await Patient.find({$or:[{name:search},{nationalID:search}]})
            
        }
        else{
             allPatients = await Patient.find({})

        }
         return response.status(200).json({ success: true, data: allPatients })
    } catch (error) {
         return response.status(500).json({ success: false, message: error.message })
    }
}


const getPatientById = async (request, response) => {
    try {
        console.log("Hello Get patient by id");
        const id = request.params.id
        const patient = await Patient.findById(id)
        if (!patient) {
            return response.status(404).json({ success: false, message: "patient not found" })
        }
        return response.status(200).json({ success: true, data: patient })
    }
    catch (error) {
        return response.status(500).json({ success: false, message: error.message })
    }
}
const createPatient = async (request, response) => {
    try {
        
        console.log("Hello From Create patient");
        const {name,dateOfBirth,gender,bloodType,allergies,chronicConditions,nationalID} = request.body
        const createdBy = request.user.id
        if(!name || !dateOfBirth || !gender || !bloodType || !createdBy || !nationalID ){
            return response.status(400).json({ success: false, message: "All fields are required" })
        }
        if(nationalID.length > 14 || nationalID.length < 14){
            return response.status(400).json({ success: false, message: "National ID Must be 14 number" })
        }
        const patient = await Patient.create({name,dateOfBirth,gender,bloodType,allergies,chronicConditions,createdBy,nationalID})
        return response.status(201).json({ success: true, data: patient })
    } catch (error) {
        return response.status(500).json({ success: false, message: error.message })
    }
}
const deletePatient = async (request, response) => {
    try {
        console.log("Hello delete patient");
        const id = request.params.id
        const deletedPatient = await Patient.findByIdAndDelete(id)
        if (!deletedPatient) {
            return response.status(404).json({ success: false, message: "patient not found" })
        }
        return response.status(200).json({ success: true, message: "patient deleted successfully" })

    } catch (error) {
        return response.status(500).json({ success: false, message: error.message })
    }
}
const updatePatient = async (request, response) => {
    try {
        console.log("Hello update patient");
        const id = request.params.id
        const updatedPatient = await Patient.findByIdAndUpdate(id, request.body, { returnDocument: "after", runValidators: true })
        if (!updatedPatient) {
            return response.status(404).json({ success: false, message: "patient not found" })
        }
        return response.status(200).json({ success: true, data:updatedPatient})

    } catch (error) {
        return response.status(500).json({ success: false, message: error.message })
    }
}

module.exports = {
    getAllPatients,
    getPatientById,
    createPatient,
    deletePatient,
    updatePatient,
    getAllPatientsByDoctor
}