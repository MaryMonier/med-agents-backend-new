const mongoose = require("mongoose");

// كاش عام لأي نتيجة AI (بنستخدمه في أكتر من agent)
// الـ TTL index بيتعمل تلقائيًا من mongoose بسبب "expires" على حقل createdAt
const aiCacheSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true },
  response: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 *10  
  },
});

module.exports = mongoose.model("AICache", aiCacheSchema);