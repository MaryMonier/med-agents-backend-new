// const { searchPubMed, formatPubMedContext } = require('./pubmed.service');
// const { searchDrug } = require('./openFDA.service');

// // ─── Static fallback (لو الـ APIs فشلت) ───────────────────────────────────────
// const staticKnowledge = [
//   {
//     topic: 'hypertension',
//     keywords: ['hypertension', 'blood pressure', 'bp', 'ضغط'],
//     content: 'Hypertension: First line - ACE inhibitors, ARBs, CCBs, thiazide diuretics. Target BP < 130/80 mmHg.',
//     content_ar: 'ارتفاع ضغط الدم: الخط الأول - مثبطات ACE، ARBs، حاصرات قنوات الكالسيوم. الهدف أقل من 130/80.',
//   },
//   {
//     topic: 'diabetes',
//     keywords: ['diabetes', 'glucose', 'hba1c', 'سكري', 'metformin'],
//     content: 'Type 2 Diabetes: First line - Metformin. Monitor HbA1c every 3 months. Target HbA1c < 7%.',
//     content_ar: 'السكري النوع 2: الخط الأول - ميتفورمين. مراقبة HbA1c كل 3 أشهر. الهدف أقل من 7%.',
//   },
//   {
//     topic: 'chest_pain',
//     keywords: ['chest pain', 'acs', 'troponin', 'ألم صدر', 'ecg'],
//     content: 'Chest pain: ECG, troponin, chest X-ray. Rule out ACS, PE, aortic dissection.',
//     content_ar: 'ألم الصدر: رسم قلب، تروبونين، أشعة صدر. استبعاد متلازمة الشريان التاجي.',
//   },
//   {
//     topic: 'warfarin',
//     keywords: ['warfarin', 'inr', 'anticoagulant', 'وارفارين'],
//     content: 'Warfarin: Avoid NSAIDs, aspirin. Monitor INR with antibiotics. Many Vitamin K food interactions.',
//     content_ar: 'وارفارين: تجنب مضادات الالتهاب. مراقبة INR مع المضادات الحيوية.',
//   },
//   {
//     topic: 'fever',
//     keywords: ['fever', 'temperature', 'infection', 'حمى', 'حرارة'],
//     content: 'Fever: Investigate cause first. Paracetamol or ibuprofen for relief. Blood cultures if temp > 38.5°C.',
//     content_ar: 'الحمى: تحقق من السبب أولاً. باراسيتامول أو إيبوبروفين. مزارع الدم إذا الحرارة أعلى من 38.5.',
//   },
// ];

// // ─── Static fallback retrieve ──────────────────────────────────────────────────
// const retrieveStatic = (query, language = 'en', topK = 2) => {
//   const q = query.toLowerCase();
//   const scored = staticKnowledge.map(doc => {
//     const hits = doc.keywords.filter(k => q.includes(k)).length;
//     return { ...doc, score: hits };
//   });

//   return scored
//     .filter(d => d.score > 0)
//     .sort((a, b) => b.score - a.score)
//     .slice(0, topK)
//     .map(d => ({
//       topic: d.topic,
//       content: language === 'ar' ? d.content_ar : d.content,
//     }));
// };

// // ─── Main retrieve (PubMed + FDA + Static fallback) ────────────────────────────
// const retrieve = async (query, language = 'en', options = {}) => {
//   const {
//     includePubMed = true,
//     includeFDA = false,
//     drugName = null,
//   } = options;

//   const results = {
//     pubmed: '',
//     fda: '',
//     static: '',
//   };

//   // 1. PubMed
//   if (includePubMed) {
//     try {
//       console.log('Calling PubMed with query:', query); // ضيفي
//       const articles = await searchPubMed(query, 3);
//       console.log('PubMed articles:', articles); // ضيفي
//       results.pubmed = formatPubMedContext(articles);
//     } catch(err) {
//       console.log('PubMed error:', err.message); // ضيفي
//       results.pubmed = '';
//     }
//   }

//   // 2. FDA (لو في دواء محدد)
//   if (includeFDA && drugName) {
//     try {
//       const fdaData = await searchDrug(drugName);
//       results.fda = `
// Drug: ${fdaData.name}
// Warnings: ${fdaData.warnings}
// Interactions: ${fdaData.interactions}
// Contraindications: ${fdaData.contraindications}
//       `.trim();
//     } catch {
//       results.fda = '';
//     }
//   }

//   // 3. Static fallback دايماً
//   const staticDocs = retrieveStatic(query, language);
//   if (staticDocs.length > 0) {
//     results.static = staticDocs.map(d => d.content).join('\n');
//   }

//   return results;
// };

// // ─── Format كل الـ context في prompt واحد ──────────────────────────────────────
// const buildContext = (results, language = 'en') => {
//   const sections = [];

//   if (results.pubmed) {
//     sections.push(`=== Clinical Guidelines (PubMed) ===\n${results.pubmed}`);
//   }
//   if (results.fda) {
//     sections.push(`=== Drug Data (FDA) ===\n${results.fda}`);
//   }
//   if (results.static) {
//     sections.push(`=== Internal Knowledge ===\n${results.static}`);
//   }

//   if (sections.length === 0) {
//     return language === 'ar' ? 'لا توجد معلومات إضافية.' : 'No additional context available.';
//   }

//   return sections.join('\n\n');
// };

// module.exports = { retrieve, buildContext, retrieveStatic };






const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const { PINECONE_API_KEY, OPENAI_API_KEY } = require('../config/env');

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const getEmbedding = async (text) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
};

const retrieve = async (query, language = 'en', topK = 3) => {
  try {
    const index = pinecone.index('med-agents');
    const queryEmbedding = await getEmbedding(query);

    const results = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    return results.matches.map(match => ({
      topic: match.metadata.topic,
      content: match.metadata.content,
      category: match.metadata.category,
      score: match.score,
    }));

  } catch (error) {
    console.error('RAG retrieval failed:', error.message);
    return [];
  }
};

const formatContext = (docs, language = 'en') => {
  if (!docs.length) return language === 'ar' ? 'لا توجد معلومات متاحة' : 'No relevant context found';
  return docs.map((doc, i) => `[Source ${i + 1}] ${doc.content}`).join('\n\n');
};

module.exports = { retrieve, formatContext };