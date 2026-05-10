const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const patientRouter = require("./patient/patient.router")

const errorHandler = require('./middleware/errorHandler');
const piiSanitize = require('./middleware/piiSanitize');
const authRoutes = require('./routes/auth.routes');
const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(limiter);
app.use(piiSanitize);

app.use('/api/auth', authRoutes);
app.use("/api/patient",patientRouter)

app.get('/', (req, res) => {
  res.json({ message: 'Med Agents API is running!' });
});

app.use(errorHandler);

module.exports = app;
