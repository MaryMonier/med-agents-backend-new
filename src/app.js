const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const followupRoutes = require('./routes/followupRoutes');
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
app.use('/api/followups', followupRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Med Agents API is running!' });
});

module.exports = app;