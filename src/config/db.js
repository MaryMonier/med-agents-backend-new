const mongoose = require ('mongoose');
const connectDB = async()=>{
    try{
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("mongoose connected successfully");
        
    }catch(error){
        console.error(" mongoose connection failed",error.message);
        process.exit(1);
    }
}
module.exports = connectDB;