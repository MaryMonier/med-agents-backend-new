const { SKIN_CLASSIFIER_URL } = require("../config/env");

// ─── تصنيف صور الأمراض الجلدية عن طريق موديل محلي (مش Gemini) ───────────
// دي خدمة بايثون منفصلة شغالة على نفس السيرفر (أو سيرفر داخلي تاني)،
// بتحمّل موديل ViT اتعمله fine-tune على DermNet مرة واحدة وتفضل شغالة.
// إحنا هنا بس بنبعتلها الصورة كـ base64 عن طريق HTTP، وبناخد أعلى 3
// احتمالات. النتيجة دي بتتحط في الـ prompt بتاع Gemini كـ "إشارة مساعدة"
// مش كتشخيص نهائي - نفس فلسفة labFileFindings الموجودة أصلاً.
//
// لو الخدمة مش شغالة أو فشلت لأي سبب، بنرجع فاضي بصمت (silent fail) -
// النظام لازم يفضل شغال حتى لو الموديل المحلي مش متاح دلوقتي، بالظبط
// زي أي مصدر خارجي تاني (Pinecone/PubMed) في باقي الكود.
const classifySkinImage = async ({ mimeType, data }) => {
  if (!SKIN_CLASSIFIER_URL) return null;

  // الموديل مدرب على صور بس - مش PDF أو ملفات تانية
  if (!mimeType || !mimeType.startsWith("image/")) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${SKIN_CLASSIFIER_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: data, topK: 3 }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(
        "[skinClassifier] service responded with",
        response.status,
      );
      return null;
    }

    const result = await response.json();
    return Array.isArray(result.predictions) ? result.predictions : null;
  } catch (err) {
    console.error("[skinClassifier] request failed:", err.message);
    return null;
  }
};

// بياخد ليستة labFiles (نفس الشكل اللي الإيجنت بيستخدمه: {mimeType, data,
// originalName}) ويرجّع نص جاهز يتحط في الـ prompt، أو فاضي لو مفيش صور
// أو الخدمة مش متاحة. بيشغّل كل الصور بالتوازي (Promise.all) مش واحدة
// ورا التانية عشان ميبطئش الاستجابة الكلية للدكتور.
const getSkinClassificationNote = async (labFiles = []) => {
  const imageFiles = labFiles.filter(
    (f) => f.mimeType && f.mimeType.startsWith("image/"),
  );
  if (imageFiles.length === 0) return "";

  const results = await Promise.all(
    imageFiles.map(async (file) => {
      const predictions = await classifySkinImage(file);
      if (!predictions || predictions.length === 0) return null;

      const formatted = predictions
        .map((p) => `${p.label} (${Math.round(p.score * 100)}%)`)
        .join(", ");

      return `${file.originalName || "image"}: ${formatted}`;
    }),
  );

  const validResults = results.filter(Boolean);
  if (validResults.length === 0) return "";

  return `AI skin-image classifier suggestions (supplementary signal only, NOT a diagnosis - a local ViT model trained on DermNet images): ${validResults.join("; ")}`;
};

module.exports = { classifySkinImage, getSkinClassificationNote };
