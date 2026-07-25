const axios = require('axios');

const BASE_URL = 'https://wsearch.nlm.nih.gov/ws/query';

// ─── MedlinePlus (NIH / National Library of Medicine) ─────────────────────
// مصدر إضافي غير PubMed: نفس الجهة (NLM) لكن هنا المحتوى عبارة عن ملخصات
// "Health Topics" سريرية جاهزة ومعتمدة (مش أبحاث خام زي PubMed)، فبيدي
// صياغة أقرب لـ "دليل سريري مختصر" وتغطية أوسع لمواضيع مش بالضرورة
// موجودة كأبحاث حديثة. API مجاني تمامًا ومحتاجش API key، فمفيش أي تعديل
// مطلوب على src/config/env.js.
//
// بيتستخدم كطبقة مرجعية إضافية (مش بديلة) فوق Pinecone وPubMed في
// differentialDiagnosisAgent - يعني ممكن يتضاف حتى لو فيه نتايج من مصادر
// تانية، عشان يوسّع تغطية المواضيع اللي مش موجودة في الـ 10 مواضيع الثابتة
// المخزّنة في Pinecone.
const searchMedlinePlus = async (query, maxResults = 3) => {
  try {
    const res = await axios.get(BASE_URL, {
      params: {
        db: 'healthTopics',
        term: query,
        retmax: maxResults,
        rettype: 'brief',
      },
    });

    return parseMedlinePlusXML(res.data);
  } catch (error) {
    console.error('MedlinePlus API error:', error.message);
    return [];
  }
};

// نفس أسلوب parsePubMedXML الموجود في pubmed.service.js (regex بسيط بدل ما
// نضيف مكتبة XML parsing جديدة) - عشان نفضل متسقين مع نمط الكود الحالي
const parseMedlinePlusXML = (xmlData) => {
  try {
    const topics = [];
    const documentBlocks =
      xmlData.match(/<document[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/document>/g) || [];

    const stripHtml = (str) =>
      (str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    documentBlocks.forEach((block, index) => {
      const urlMatch = block.match(/url="([^"]*)"/);
      const titleMatch = block.match(/<content name="title">([\s\S]*?)<\/content>/);
      // بعض المواضيع بترجع "FullSummary"، وبعضها "snippet" بس - بنجرب الاتنين
      const summaryMatch =
        block.match(/<content name="FullSummary">([\s\S]*?)<\/content>/) ||
        block.match(/<content name="snippet">([\s\S]*?)<\/content>/);

      const title = stripHtml(titleMatch?.[1]);
      const summary = stripHtml(summaryMatch?.[1]);

      if (title) {
        topics.push({
          id: `medlineplus_${index}`,
          title,
          summary: summary || 'No summary available',
          source: urlMatch?.[1] || 'https://medlineplus.gov/',
        });
      }
    });

    return topics;
  } catch (error) {
    return [];
  }
};

const formatMedlinePlusContext = (topics) => {
  if (!topics || topics.length === 0) return '';

  return topics
    .map(
      (t, i) => `
[MedlinePlus ${i + 1}]
Title: ${t.title}
Summary: ${t.summary}
Source: ${t.source}
  `,
    )
    .join('\n---\n');
};

module.exports = { searchMedlinePlus, formatMedlinePlusContext };