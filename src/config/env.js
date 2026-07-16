require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY,
  // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // Paymob (Intention API - النظام الجديد)
  PAYMOB_SECRET_KEY: process.env.PAYMOB_SECRET_KEY,
  PAYMOB_PUBLIC_KEY: process.env.PAYMOB_PUBLIC_KEY,
  PAYMOB_INTEGRATION_ID: process.env.PAYMOB_INTEGRATION_ID,
  PAYMOB_HMAC_SECRET: process.env.PAYMOB_HMAC_SECRET,
};