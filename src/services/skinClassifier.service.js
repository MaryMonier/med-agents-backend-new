const { SKIN_CLASSIFIER_URL } = require("../config/env");

// الموديل مجبر رياضيًا يختار فئة من الـ 23 حتى لو الصورة أصلاً بعيدة تمامًا
// عن كل الفئات دي (مرض مش من ضمن DermNet, صورة غير واضحة, ...). لو أعلى
// نسبة ثقة رجعت واطية، ده مؤشر قوي إن الموديل "بيخمّن" مش "متأكد" - في
// الحالة دي، بدل ما نحقن تصنيف غالبًا غلط في الـ prompt (وده ممكن يضلل
// Gemini بدل ما يساعده)، بنسيب التصنيف ده تمامًا ومنبعتوش خالص. الوصف
// النصي البصري للصورة لسه بيحصل عادي عن طريق extractLabFileFindings
// (اللي بيشوف الصورة برضو) وبيغذي بحث PubMed/MedlinePlus بمفرده من غير
// أي تحيز لتصنيف الموديل المحلي غير الواثق.
const MIN_CONFIDENCE_THRESHOLD = 0.35;
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
      console.error("[skinClassifier] service responded with", response.status);
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

      // لو أعلى ثقة واطية، يبقى الموديل مش لاقي نفسه فعليًا في الـ 23
      // فئة - منحقنش تخمين ضعيف في الـ prompt، ونسيب الوصف البصري النصي
      // (اللي بيحصل أصلاً في extractLabFileFindings) يتكفل بالبحث بمفرده
      const topScore = predictions[0]?.score ?? 0;
      if (topScore < MIN_CONFIDENCE_THRESHOLD) {
        console.log(
          `[skinClassifier] low confidence (${topScore}) for ${file.originalName || "image"} - skipping injection, relying on visual description instead`,
        );
        return null;
      }

      const formatted = predictions
        .map((p) => `${p.label} (${Math.round(p.score * 100)}%)`)
        .join(", ");

      return `image ${imageFiles.indexOf(file) + 1}: ${formatted}`;
    }),
  );

  const validResults = results.filter(Boolean);
  if (validResults.length === 0) return "";

  return `AI skin-image classifier suggestions (supplementary signal only, NOT a diagnosis - a local ViT model trained on DermNet images): ${validResults.join("; ")}`;
};

module.exports = { classifySkinImage, getSkinClassificationNote };
