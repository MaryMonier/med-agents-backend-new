const fs = require('fs');
const path = require('path');

const knowledgeBase = [
  {
    id: 1,
    category: 'internal_medicine',
    topic: 'hypertension',
    content: 'Hypertension treatment: First line medications include ACE inhibitors, ARBs, calcium channel blockers, and thiazide diuretics. Target BP < 130/80 mmHg.',
    content_ar: 'علاج ارتفاع ضغط الدم: الأدوية الخط الأول تشمل مثبطات ACE، حاصرات ARB، حاصرات قنوات الكالسيوم. الهدف أقل من 130/80.'
  },
  {
    id: 2,
    category: 'internal_medicine',
    topic: 'diabetes',
    content: 'Type 2 Diabetes: First line treatment is Metformin. Monitor HbA1c every 3 months. Target HbA1c < 7%.',
    content_ar: 'السكري النوع الثاني: العلاج الخط الأول هو الميتفورمين. مراقبة HbA1c كل 3 أشهر. الهدف أقل من 7%.'
  },
  {
    id: 3,
    category: 'internal_medicine',
    topic: 'chest_pain',
    content: 'Chest pain evaluation: Consider ECG, troponin levels, chest X-ray. Rule out ACS, PE, and aortic dissection.',
    content_ar: 'تقييم ألم الصدر: يشمل رسم القلب، مستوى التروبونين، أشعة الصدر. استبعاد متلازمة الشريان التاجي الحادة.'
  },
  {
    id: 4,
    category: 'drug_interactions',
    topic: 'warfarin',
    content: 'Warfarin interactions: Avoid NSAIDs, aspirin. Monitor INR closely with antibiotics. Many food interactions with Vitamin K.',
    content_ar: 'تفاعلات الوارفارين: تجنب مضادات الالتهاب، الأسبرين. مراقبة INR مع المضادات الحيوية.'
  },
  {
    id: 5,
    category: 'internal_medicine',
    topic: 'fever',
    content: 'Fever management: Investigate cause before treating. Use paracetamol or ibuprofen for symptomatic relief. Blood cultures if temp > 38.5C.',
    content_ar: 'علاج الحمى: التحقيق في السبب قبل العلاج. استخدام الباراسيتامول أو الإيبوبروفين. مزارع الدم إذا كانت الحرارة أعلى من 38.5.'
  }
];

const retrieve = (query, language = 'en', topK = 3) => {
  const queryLower = query.toLowerCase();
  
  const scored = knowledgeBase.map(doc => {
    const searchIn = language === 'ar' ? doc.content_ar : doc.content;
    const topicMatch = queryLower.includes(doc.topic.replace('_', ' ')) ? 2 : 0;
    const contentMatch = doc.content.toLowerCase().includes(queryLower) ? 1 : 0;
    return { ...doc, score: topicMatch + contentMatch };
  });

  return scored
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(doc => ({
      topic: doc.topic,
      content: language === 'ar' ? doc.content_ar : doc.content,
      category: doc.category
    }));
};

const formatContext = (docs, language = 'en') => {
  if (docs.length === 0) return language === 'ar' ? 'لا توجد معلومات متاحة' : 'No relevant context found';
  return docs.map((doc, i) => `[Source ${i + 1}] ${doc.content}`).join('\n\n');
};

module.exports = { retrieve, formatContext };