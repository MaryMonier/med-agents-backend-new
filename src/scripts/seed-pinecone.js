const { getEmbedding, upsertVectors } = require('../services/pinecone.service');
const { searchPubMed } = require('../services/pubmed.service');

// اتوسّعت من 10 مواضيع لـ 25 (تخصصات عامة)، وبعدين لـ 33 بإضافة قسم أطفال
// مخصص - القايمة القديمة كانت مغطية باطنة/قلب بس، فأي حالة برا كده (جلدية، عظام، هضمية،
// عصبية، نفسية، أطفال، نساء...) كان الـ differentialDiagnosisAgent مضطر
// يعتمد على معرفة الموديل العامة بالكامل من غير أي مرجع محلي حتى لو موجود.
// قسم "أطفال" (Pediatrics) اتضاف كتصنيف مستقل عشان حالات الأطفال ليها
// طابع مختلف تمامًا عن نفس الأمراض عند الكبار (زي الجرعات المبنية على
// الوزن، وأمراض خاصة بالرضع زي bronchiolitis واليرقان الوليدي). القايمة دي
// لسه مش بديل عن دليل سريري كامل، بس بتوسّع التغطية بشكل ملموس.
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
  // ── جهاز هضمي ─────────────────────────────────────────────
  { id: 'gerd', content: 'GERD management: Proton pump inhibitors (PPIs) are first line for moderate-severe symptoms. Lifestyle changes: weight loss, avoid late meals, elevate head of bed. Endoscopy if alarm features (dysphagia, weight loss, bleeding).' },
  { id: 'peptic_ulcer', content: 'Peptic ulcer disease: Test and treat H. pylori (triple therapy: PPI + amoxicillin + clarithromycin). Stop NSAIDs/aspirin if possible. PPI course 4-8 weeks. Endoscopy if alarm features or age > 55.' },
  { id: 'gastroenteritis', content: 'Acute gastroenteritis: Primarily supportive - oral rehydration solution, continue feeding. Antiemetics for vomiting. Antibiotics only for specific bacterial causes with severe/invasive disease. Red flags: bloody diarrhea, dehydration signs, high fever.' },
  // ── جهاز عصبي ─────────────────────────────────────────────
  { id: 'migraine', content: 'Migraine treatment: Acute - NSAIDs or triptans early in attack, antiemetics as needed. Preventive therapy (beta-blockers, topiramate, amitriptyline) if frequent/disabling attacks (>=4 days/month). Avoid known triggers.' },
  { id: 'stroke', content: 'Acute stroke: Time-critical - CT/MRI immediately to rule out hemorrhage. IV thrombolysis (alteplase) within 4.5h of onset if ischemic and no contraindications. Control BP carefully, do not lower aggressively in acute ischemic stroke. Consider thrombectomy for large vessel occlusion.' },
  { id: 'epilepsy', content: 'Epilepsy/seizure management: Acute seizure >5 min - benzodiazepine (e.g. IV/rectal diazepam). Long-term: antiepileptic drug choice depends on seizure type (e.g. levetiracetam, valproate, carbamazepine). Avoid triggers (sleep deprivation, alcohol). Driving/safety counseling.' },
  // ── عظام وعضلات ───────────────────────────────────────────
  { id: 'low_back_pain', content: 'Acute low back pain: Most cases are non-specific and self-limiting - encourage activity, NSAIDs/paracetamol for pain. Avoid routine imaging unless red flags present (trauma, neurological deficit, cauda equina signs, unexplained weight loss, fever).' },
  { id: 'osteoarthritis', content: 'Osteoarthritis management: First line - weight loss, exercise/physiotherapy, topical NSAIDs. Oral NSAIDs or paracetamol for flares. Consider intra-articular corticosteroid injection for localized flares. Joint replacement for end-stage disease.' },
  // ── جهاز بولي وأمراض معدية ───────────────────────────────────
  { id: 'uti', content: 'Urinary tract infection: Uncomplicated cystitis - short course nitrofurantoin or trimethoprim-sulfamethoxazole. Pyelonephritis - fluoroquinolone or ceftriaxone, longer course, consider hospitalization if systemic toxicity. Urine culture for recurrent/complicated cases.' },
  { id: 'cellulitis', content: 'Cellulitis treatment: Oral antibiotics covering Streptococcus/Staphylococcus (e.g. flucloxacillin, cephalexin) for uncomplicated cases. IV antibiotics if systemic signs, rapidly spreading, or immunocompromised. Elevate affected limb, mark borders to track progression.' },
  { id: 'otitis_media', content: 'Acute otitis media: Many cases resolve without antibiotics, especially in children >2 years with mild symptoms - analgesia and watchful waiting first. Amoxicillin if severe, bilateral in young children, or no improvement after 48-72h.' },
  // ── غدد صماء ──────────────────────────────────────────────
  { id: 'hypothyroidism', content: 'Hypothyroidism: Levothyroxine replacement, dose titrated by TSH (check every 6-8 weeks after dose change). Target TSH within normal reference range. Take on empty stomach, separate from calcium/iron supplements.' },
  { id: 'hyperlipidemia', content: 'Dyslipidemia management: Statins are first line for elevated LDL, especially with cardiovascular risk factors. Lifestyle: diet, exercise, weight management. Target LDL depends on cardiovascular risk category. Monitor liver enzymes and for myopathy symptoms.' },
  // ── نفسية ─────────────────────────────────────────────────
  { id: 'depression', content: 'Major depressive disorder: First line - SSRIs (e.g. sertraline, fluoxetine) combined with psychotherapy (CBT) for moderate-severe cases. Reassess in 2-4 weeks for response. Screen for suicidal ideation at every visit.' },
  { id: 'anxiety', content: 'Generalized anxiety disorder: First line - SSRIs/SNRIs and/or CBT. Benzodiazepines only for short-term/acute relief due to dependence risk. Address comorbid conditions (depression, substance use) and rule out medical causes (thyroid, cardiac).' },
  // ── جلدية وحساسية ──────────────────────────────────────────
  { id: 'allergic_rhinitis', content: 'Allergic rhinitis: First line - intranasal corticosteroids for persistent symptoms, second-generation oral antihistamines (e.g. loratadine, cetirizine) for milder/intermittent symptoms. Allergen avoidance where possible. Consider immunotherapy for severe refractory cases.' },
  { id: 'eczema', content: 'Atopic dermatitis (eczema): Regular emollients are the cornerstone of management. Topical corticosteroids for flares, potency matched to severity/site. Avoid known triggers/irritants. Consider topical calcineurin inhibitors for sensitive areas (face, skin folds).' },
  // ── أطفال (Pediatrics) ──────────────────────────────────────
  { id: 'pediatric_fever', content: 'Fever in children: Treat discomfort, not the number - paracetamol 10-15 mg/kg/dose every 4-6h (max 4 doses/day) or ibuprofen 5-10 mg/kg/dose every 6-8h (only if >6 months old). Never use aspirin in children/teenagers due to Reye syndrome risk. Red flags requiring urgent review: age <3 months with fever, lethargy, rash, difficulty breathing, poor feeding.' },
  { id: 'febrile_seizure', content: 'Febrile seizure: Most are simple, brief (<15 min), and self-limiting - reassurance and treat underlying fever cause, not the seizure itself. Refer urgently if seizure >15 min, focal features, recurrence within 24h, or age <6 months/>5 years. Antipyretics do not prevent recurrence but help comfort.' },
  { id: 'bronchiolitis', content: 'Bronchiolitis (infants, usually RSV): Primarily supportive care - ensure adequate hydration/feeding, nasal suction, monitor oxygen saturation. Bronchodilators and steroids are generally not effective and not routinely recommended. Admit if apnea, poor feeding, marked respiratory distress, or oxygen saturation persistently low.' },
  { id: 'croup', content: 'Croup (laryngotracheobronchitis): Single dose oral dexamethasone (0.15-0.6 mg/kg) for most cases, even mild, reduces severity/duration. Nebulized epinephrine for moderate-severe stridor at rest, observe after for rebound. Keep child calm - crying worsens stridor.' },
  { id: 'pediatric_gastroenteritis', content: 'Gastroenteritis in children: Oral rehydration solution is first line even with vomiting (give small frequent amounts). Continue breastfeeding/normal diet as tolerated. Avoid antidiarrheal/antiemetic drugs routinely in young children. Red flags: sunken eyes, lethargy, no urine output >8h, blood in stool.' },
  { id: 'pediatric_asthma', content: 'Asthma in children: Inhaled short-acting beta agonist (SABA) via spacer (not nebulizer alone) for acute symptoms - a spacer with mask/mouthpiece improves drug delivery in young children. Inhaled corticosteroids for persistent/frequent symptoms. Assess and correct inhaler technique at every visit; adherence is a common cause of poor control.' },
  { id: 'neonatal_jaundice', content: 'Neonatal jaundice: Physiological jaundice typically appears after 24h of life and resolves within 1-2 weeks - jaundice within the first 24h of life is always pathological and needs urgent evaluation. Use age-in-hours-specific bilirubin thresholds (nomogram) to decide on phototherapy. Ensure adequate feeding, which helps bilirubin clearance.' },
  { id: 'pediatric_dosing_general', content: 'General principle of pediatric drug dosing: Most pediatric doses are weight-based (mg/kg), not fixed adult doses - always confirm the child current weight rather than estimating from age alone whenever possible. Double-check the calculated dose does not exceed the standard adult maximum dose even if the mg/kg calculation would suggest a higher amount. Recheck decimal points and units (mg vs mL) as these are the most common pediatric dosing errors.' },
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
    // ✅ اتوسّعت لنفس الـ 25 موضوع فوق (بدل 10) عشان كل موضوع جديد في
    // knowledgeBase ياخد كمان مقالات PubMed حقيقية مخزّنة، مش بس الفقرة
    // الثابتة القصيرة
    const pubmedTopics = [
      'hypertension',
      'diabetes',
      'asthma',
      'pneumonia',
      'heart failure',
      'chest pain',
      'kidney disease',
      'atrial fibrillation',
      'fever',
      'warfarin',
      'GERD',
      'peptic ulcer',
      'gastroenteritis',
      'migraine',
      'stroke',
      'epilepsy',
      'low back pain',
      'osteoarthritis',
      'urinary tract infection',
      'cellulitis',
      'otitis media',
      'hypothyroidism',
      'dyslipidemia',
      'depression',
      'anxiety disorder',
      'allergic rhinitis',
      'atopic dermatitis',
      'fever in children',
      'febrile seizure',
      'bronchiolitis',
      'croup',
      'pediatric gastroenteritis',
      'pediatric asthma',
      'neonatal jaundice',
      'pediatric drug dosing',
    ];
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
    console.log(`Successfully uploaded ${vectors.length} vectors to Pinecone!`);

  } catch (error) {
    console.error('Seed failed:', error.message);
  }
};

seedPinecone();