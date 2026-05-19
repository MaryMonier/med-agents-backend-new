const piiSanitize = (req, res, next) => {
  if (req.body) {
    const sanitized = JSON.stringify(req.body)
      .replace(/\b\d{10,}\b/g, '[REDACTED]')
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL REDACTED]');
    req.sanitizedBody = JSON.parse(sanitized);
  }
  next();
};

module.exports = piiSanitize;