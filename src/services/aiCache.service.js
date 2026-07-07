const crypto = require("crypto");
const AICache = require("../models/AICache.model");

// بنبني الـ key من أي object، بعد ترتيب المفاتيح عشان JSON.stringify يديك
// نفس النتيجة دايمًا مهما كان ترتيب الحقول وقت الإنشاء
const buildCacheKey = (namespace, payload) => {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return `${namespace}:${hash}`;
};

const getCached = async (cacheKey) => {
  try {
    const doc = await AICache.findOne({ cacheKey }).lean();
    return doc ? doc.response : null;
  } catch (err) {
    // لو الكاش فشل (DB مقطوعة مثلاً)، منوقفش الطلب — نكمل عادي كأنه cache miss
    console.error("Cache read error:", err.message);
    return null;
  }
};

const setCached = async (cacheKey, response) => {
  try {
    await AICache.findOneAndUpdate(
      { cacheKey },
      { cacheKey, response, createdAt: new Date() },
      { upsert: true },
    );
  } catch (err) {
    console.error("Cache write error:", err.message);
  }
};

module.exports = { buildCacheKey, getCached, setCached };