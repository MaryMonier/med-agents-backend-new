const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log("mongoose connected successfully");
  } catch (error) {
    console.error("mongoose connection failed", error.message);
    // متستخدميش process.exit هنا لأننا في serverless
    throw error;
  }
};

module.exports = connectDB;