const { response } = require("../app");
const Patient = require("../models/Patient");

const getAllPatients = async (request, respons) => {
    try {
        console.log("Hello Final Project");
        const allPatients = await Patient.find()
        return response.status(200).json({ message: true, data: allPatients })
    } catch (error) {
        return response.status(500).json({ success: false, message: "internal server error" })
    }
}
const getPatientById = async (request, respons) => {
    try {
        console.log("Hello Get patient by id");
        const id = request.params.id
        const patient = await Patient.findById(id)
        if (!patient) {
            return response.status(404).json({ success: true, message: "patient not found" })
        }
        return response.status(200).json({ success: true, data: patient })
    }
    catch (error) {
        return response.status(500).json({ success: false, message: "internal server error" })
    }
}
const createPatient = async (request, respons) => {
    try {
        console.log("Hello From Create patient");
        const patienInfo = request.body
        const patient = await Patient.create(patienInfo)
        return response.status(201).json({ success: true, data: patient })
    } catch (error) {
        return response.status(500).json({ success: false, message: "internal server error" })
    }
}
const deletePatient = async (request, respons) => {
    try {
        console.log("Hello delete patient");
        const id = request.params.id
        const deletedPatient = await Patient.findByIdAndDelete(id)
        if (!deletePatient) {
            return response.status(404).json({ success: true, message: "patient not found" })
        }
        return response.status(204).json({ success: true, message: "patient deleted successfully" })

    } catch (error) {
        return response.status(500).json({ success: false, message: "internal server error" })
    }
}
const updatePatient = async (request, respons) => {
    try {
        console.log("Hello update patient");
        const id = request.params.id
        const updatedPatient = await Patient.findByIdAndUpdate(id, request.body, { returnDocument: "after", runValidators: true })
        if (!updatedPatient) {
            return response.status(404).json({ success: true, message: "patient not found" })
        }
        return response.status(204).json({ success: true, message: "patient update successfully" })

    } catch (error) {
        return response.status(500).json({ success: false, message: "internal server error" })
    }
}

module.exports = {
    getAllPatients,
    getPatientById,
    createPatient,
    deletePatient,
    updatePatient,
}