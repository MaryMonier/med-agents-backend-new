const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const piiSanitize = require('./middleware/piiSanitize');
const authRoutes = require('./routes/auth.routes');
const followupRoutes = require('./routes/followupRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');
const patientRouter = require('./patient/patient.router');

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
app.use('/api/followups', followupRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/patients', patientRouter);

app.get('/', (req, res) => {
  res.json({ message: 'Med Agents API is running!' });
});

app.use(errorHandler);

module.exports = app;