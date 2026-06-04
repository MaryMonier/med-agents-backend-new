const { getEmbedding, upsertVectors } = require('../services/pinecone.service');
const { searchPubMed } = require('../services/pubmed.service');

const knowledgeBase = [
  { id: 'hypertension', content: 'Hypertension treatment: First line medications include ACE inhibitors, ARBs, calcium channel blockers, and thiazide diuretics. Target BP < 130/80 mmHg. Lifestyle modifications include weight loss, DASH diet, exercise, and sodium restriction.' },
  { id: 'diabetes', content: 'Type 2 Diabetes: First line treatment is Metformin. Monitor HbA1c every 3 months. Target HbA1c < 7%. Second line options include GLP-1 agonists, SGLT2 inhibitors, and DPP-4 inhibitors.' },
  { id: 'chest_pain', content: 'Chest pain evaluation: Obtain ECG, troponin levels, chest X-ray. Rule out ACS, PE, and aortic dissection. Administer aspirin if ACS suspected. Consider nitroglycerin for angina.' },
  { id: 'warfarin', content: 'Warfarin interactions: Avoid NSAIDs and aspirin due to bleeding risk. Monitor INR closely with antibiotics. Many food interactions with Vitamin K-rich foods. Target INR 2-3 for most indications.' },
  { id: 'fever', content: 'Fever management: Investigate cause before treating. Use paracetamol or ibuprofen for symptomatic relief. Obtain blood cultures if temp > 38.5C. Consider sepsis protocol if hemodynamically unstable.' },
  { id: 'asthma', content: 'Asthma treatment: Short-acting beta agonists (SABA) for acute relief. Inhaled corticosteroids (ICS) for long-term control. Step-up therapy with LABA if uncontrolled. Avoid triggers.' },
  { id: 'heart_failure', content: 'Heart failure management: ACE inhibitors or ARBs, beta-blockers, and diuretics are cornerstone therapy. Monitor fluid status and weight daily. Restrict sodium and fluid intake.' },
  { id: 'pneumonia', content: 'Pneumonia treatment: Community-acquired pneumonia - amoxicillin or azithromycin. Hospital-acquired - broad spectrum antibiotics. Assess severity with CURB-65 score.' },
  { id: 'atrial_fibrillation', content: 'Atrial fibrillation management: Rate control with beta-blockers or calcium channel blockers. Anticoagulation with warfarin or DOACs to prevent stroke. Consider cardioversion for new onset.' },
  { id: 'kidney_disease', content: 'Chronic kidney disease: Control blood pressure < 130/80. Use ACE inhibitors or ARBs. Monitor GFR and electrolytes. Restrict protein and phosphate intake. Avoid nephrotoxic drugs.' },
];

const seedPinecone = async () => {
  console.log('Starting Pinecone seed...');

  try {
    const vectors = [];

    // 1. الـ Static Knowledge
    for (const doc of knowledgeBase) {
      console.log(`Processing static: ${doc.id}`);
      const embedding = await getEmbedding(doc.content);
      vectors.push({
        id: doc.id,
        values: embedding,
        metadata: { content: doc.content, topic: doc.id, source: 'static' },
      });
    }

    // 2. PubMed - نجيب مقالات حقيقية ونخزنها
    const pubmedTopics = ['hypertension', 'diabetes', 'asthma', 'pneumonia', 'heart failure'];

    for (const topic of pubmedTopics) {
      console.log(`Fetching PubMed for: ${topic}`);
      const articles = await searchPubMed(topic, 2);

      for (const article of articles) {
        if (article.abstract && article.abstract !== 'No abstract available') {
          const content = `${article.title}. ${article.abstract}`;
          console.log(`  Adding PubMed article: ${article.id}`);
          const embedding = await getEmbedding(content);
          vectors.push({
            id: `pubmed_${article.id}`,
            values: embedding,
            metadata: {
              content,
              topic,
              source: 'pubmed',
              url: article.source,
            },
          });
        }
      }
    }

    console.log(`Total vectors: ${vectors.length}`);
    await upsertVectors(vectors);
    console.log(`✅ Successfully uploaded ${vectors.length} vectors to Pinecone!`);

  } catch (error) {
    console.error('Seed failed:', error.message);
  }
};

seedPinecone();