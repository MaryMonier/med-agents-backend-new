const axios = require("axios");
const BASE_URL = "https://api.fda.gov/drug";

// إعدادات الطلب: تايم آوت عشان لو الـ FDA API بطيء منستناش للأبد
const REQUEST_OPTIONS = { timeout: 8000 };

// بنبني الرد الموحّد من نتيجة label واحدة جاية من الـ FDA. الحقل found=true
// معناه لقينا الدواء فعليًا في قاعدة بيانات الـ FDA (حتى لو بعض الحقول
// الفرعية فاضية في اللابل نفسه)
const buildDrugInfo = (drugName, result) => ({
  name: drugName,
  found: true,
  warnings: result.warnings?.[0] || "No warnings listed on FDA label",
  interactions:
    result.drug_interactions?.[0] || "No interactions listed on FDA label",
  dosage: result.dosage_and_administration?.[0] || "No dosage info on FDA label",
  contraindications:
    result.contraindications?.[0] || "No contraindications listed on FDA label",
});

// رد "الدواء ده مش موجود في قاعدة الـ FDA خالص" - لازم يتفرق عن الحالة اللي
// فوق، عشان الـ AI/الدكتور يعرفوا إن غياب المعلومة ده مش معناه "الدواء آمن"،
// معناه إن مفيش تحقق من الـ FDA حصل أصلاً لاسم الدواء ده (يحصل كتير مع
// الأسماء التجارية المصرية/العربية أو المستحضرات مش المسوقة في أمريكا)
const notFoundResult = (drugName) => ({
  name: drugName,
  found: false,
  warnings: "Not found in FDA database",
  interactions: "Not found in FDA database",
  dosage: "Not found in FDA database",
  contraindications: "Not found in FDA database",
});

// بنشغّل استعلام واحد على الـ FDA API بصيغة بحث معينة، وبنرجع أول نتيجة لو
// لقينا حاجة، أو null لو مفيش
const runFdaQuery = async (searchQuery) => {
  const response = await axios.get(`${BASE_URL}/label.json`, {
    ...REQUEST_OPTIONS,
    params: { search: searchQuery, limit: 1 },
  });
  return response.data?.results?.[0] || null;
};

// بحث متدرّج بـ 3 محاولات بدل محاولة واحدة حرفية:
// 1) مطابقة تامة (phrase match) على brand_name/generic_name - زي الأول بالظبط
// 2) مطابقة تامة على substance_name كمان - بيغطي أسماء المادة الفعالة اللي
//    مش دايمًا مكررة في generic_name
// 3) بحث بـ wildcard في الآخر (بادئة الاسم) على الحقول التلاتة - بيمسك فروق
//    بسيطة في الإملاء أو صيغ الجمع/المفرد (مثلاً "Panadol" هيلاقي
//    "Panadol Extra" لو مسجلة كده)
const searchDrug = async (drugName) => {
  const escaped = drugName.trim().replace(/"/g, '\\"');
  if (!escaped) return notFoundResult(drugName);

  const attempts = [
    `openfda.brand_name:"${escaped}" OR openfda.generic_name:"${escaped}"`,
    `openfda.substance_name:"${escaped}"`,
    `openfda.brand_name:${escaped}* OR openfda.generic_name:${escaped}* OR openfda.substance_name:${escaped}*`,
  ];

  for (const query of attempts) {
    try {
      const result = await runFdaQuery(query);
      if (result) return buildDrugInfo(drugName, result);
    } catch (error) {
      // openFDA بترجع 404 لو مفيش أي نتيجة خالص للاستعلام ده - ده متوقع
      // ومش خطأ فعلي، فبنكمل للمحاولة التالية بهدوء. أي خطأ تاني (تايم آوت،
      // 500، مشكلة شبكة) بنسيبه يوصل لآخر محاولة وبعدين نرجع notFound
      if (error.response && error.response.status !== 404) {
        console.error(`openFDA query failed for "${drugName}":`, error.message);
      }
    }
  }

  return notFoundResult(drugName);
};

const checkInteractions = async (medications) => {
  const results = await Promise.all(
    medications.map((med) => searchDrug(med.name)),
  );
  return results;
};

module.exports = { searchDrug, checkInteractions };