const { transcribeAudio } = require("../services/transcription.service");

/**
 * POST /api/transcribe
 * body: multipart/form-data { audio: <file>, language?: "ar"|"en" }
 *
 * بيستقبل مقطع صوتي، يبعته لـ Groq Whisper، ويرجّع النص المُفرَّغ منه.
 * الميزة دي مستقلة عن أي فورم معين - أي حقل نص في التطبيق ممكن يستخدمها
 * (Doctor's Notes, Symptoms, أو أي حقل تاني مستقبلًا).
 */
const transcribe = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No audio file provided" });
    }

    const text = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      language: req.body.language,
    });

    res.status(200).json({ success: true, data: { text } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { transcribe };
