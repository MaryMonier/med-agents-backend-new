const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const errorHandler = require("./middleware/errorHandler");
// const piiSanitize = require('./middleware/piiSanitize');
// const authRoutes = require('./routes/auth.routes');
const patientRouter = require("./routes/patient.router");
// const errorHandler = require('./middleware/errorHandler');
const piiSanitize = require("./middleware/piiSanitize");
const authRoutes = require("./routes/auth.routes");
const followupRoutes = require("./routes/followupRoutes");
const prescriptionRoutes = require("./routes/prescriptionRoutes");
// const patientRouter = require('./patient/patient.router');
const consultationRoutes = require("./routes/consultationRoutes");
const drugSafetyRoutes = require("./routes/drugSafetyRoutes");
const quickDrugCheckRoutes = require("./routes/quickDrugCheckRoutes");
const subscriptionRoutes = require("./routes/subscription.router");

// const patientRouter = require("./patient/patient.router")
// const medicalAgentRouter = require('./routes/medicalAgentRoutes');

const followupAgentRouter = require("./routes/followupAgentRoutes");

const app = express();

const medicalAgentRouter = require("./routes/medicalAgentRoutes");

const reportGenRoutes = require("./routes/reportGen.routes");

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." },
});

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(limiter);
app.use(piiSanitize);

app.use("/api/auth", authRoutes);

app.use("/api/patient", patientRouter);
app.use("/api/followups", followupRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/patients", patientRouter);
app.use("/api/drug-safety", drugSafetyRoutes);

app.use("/api/consultations", consultationRoutes);
// app.use('/api/agent', medicalAgentRouter);

app.use("/api/medical-agent", medicalAgentRouter);

app.use("/api/followup-agent", followupAgentRouter);
app.use("/api/drug-safety", quickDrugCheckRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.get("/", (req, res) => {
  res.json({ message: "Med Agents API is running!" });
});

app.use("/api/report", reportGenRoutes);

app.use(errorHandler);

module.exports = app;
