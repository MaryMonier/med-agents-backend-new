const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
    name: {type: String, require: true},
    nationalID: {type: String, require: true},
    dateOfBirth: {type: Date, required: true},
    gender: {type: String, enum:['male','female'],required:true},
    bloodType:{type:String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-']},
    allergies:[{type:String}],
    chronicConditions:[{type: String}],
      doctors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
    createdBy: {type:mongoose.Schema.Types.ObjectId, ref:'User',required: true},
},{timestamps:true}
);
module.exports = mongoose.model('Patient',patientSchema);