// ─── Embedding مجاني بالكامل (بيشتغل لوكال على السيرفر، من غير أي API key) ────
// بيستخدم مكتبة @xenova/transformers اللي بتحمّل الموديل مرة واحدة وتشغّله
// على الـ CPU. الموديل ده multilingual (بيدعم عربي وإنجليزي) وحجمه صغير نسبيًا.
//
// ملحوظة مهمة: أبعاد الـ vector اتغيرت من 1536 (OpenAI text-embedding-3-small)
// لـ 384 (هنا). ده معناه لازم نعمل index جديد في Pinecone بـ dimension = 384
// ونعيد الـ seed تاني (شغّلي src/scripts/seed-pinecone.js بعد التعديل).

let embedderPromise = null;

const getEmbedder = async () => {
  if (!embedderPromise) {
    // dynamic import لأن المكتبة ESM-only
    const { pipeline } = await import('@xenova/transformers');
    embedderPromise = pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
    );
  }
  return embedderPromise;
};

const getEmbedding = async (text) => {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};

module.exports = { getEmbedding };