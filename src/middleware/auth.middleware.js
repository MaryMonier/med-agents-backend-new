const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const BlacklistedToken = require("../models/BlacklistedToken.js")
const authMiddleware = async(req, res, next) => {
  try {

    const token = req.headers.authorization?.split(' ')[1];    
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
  const isBlacklisted = await BlacklistedToken.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({ success: false, message: 'Token is no longer valid, please login again' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
    
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};


module.exports = authMiddleware;