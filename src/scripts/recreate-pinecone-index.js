// ─── سكريبت لإعادة إنشاء الـ Pinecone index بالـ dimension الجديد (384) ──────
// بيمسح الـ index القديم (لو موجود) وينشئ واحد جديد بنفس الاسم.
// شغّليه مرة واحدة بس، وبعدها شغّلي seed-pinecone.js عشان تملي البيانات تاني.
//
// طريقة التشغيل من الترمينال:
//   node src/scripts/recreate-pinecone-index.js

const readline = require('readline');
const { Pinecone } = require('@pinecone-database/pinecone');
const { PINECONE_API_KEY } = require('../config/env');

const INDEX_NAME = 'med-agents';
const NEW_DIMENSION = 384; // أبعاد الموديل المجاني الجديد

// بتسأل في الترمينال قبل أي عملية مسح خطيرة - المسح مش هيحصل غير لو
// المستخدم كتب "yes" بالظبط (case-insensitive). أي حاجة تانية (Enter
// فاضي، "y"، غلطة كتابة) بتوقف السكريبت من غير ما تمسح حاجة، عشان
// تشغيل السكريبت ده بالغلط على بيئة فيها بيانات حقيقية ميمسحش كل حاجة
// فورًا من غير رجوع
const confirm = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });

const run = async () => {
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

  // 1. نتأكد لو الـ index موجود، ونمسحه (بعد تأكيد صريح من المستخدم)
  const existing = await pinecone.listIndexes();
  const alreadyExists = existing.indexes?.some((idx) => idx.name === INDEX_NAME);

  if (alreadyExists) {
    console.log(`⚠️  الـ index "${INDEX_NAME}" موجود بالفعل وفيه بيانات.`);
    console.log('⚠️  المسح ده نهائي ومش هيترجع تاني.');
    const confirmed = await confirm('اكتبي "yes" بالظبط للتأكيد، أو أي حاجة تانية للإلغاء: ');

    if (!confirmed) {
      console.log('❌ اتلغى. الـ index القديم لسه موجود زي ما هو، مفيش حاجة اتمسحت.');
      process.exit(0);
    }

    console.log(`🗑️  بمسح الـ index القديم "${INDEX_NAME}"...`);
    await pinecone.deleteIndex(INDEX_NAME);
    // بنستنى شوية لحد ما المسح يخلص فعليًا على السيرفر
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } else {
    console.log(`ℹ️  الـ index "${INDEX_NAME}" مش موجود أصلاً، هنعمل واحد جديد.`);
  }

  // 2. ننشئ الـ index الجديد بالـ dimension الصح
  console.log(`🚀 بعمل index جديد "${INDEX_NAME}" بـ dimension = ${NEW_DIMENSION}...`);
  await pinecone.createIndex({
    name: INDEX_NAME,
    dimension: NEW_DIMENSION,
    metric: 'cosine',
    spec: {
      serverless: {
        cloud: 'aws',
        region: 'us-east-1',
      },
    },
  });

  console.log('✅ تم! الـ index جاهز دلوقتي.');
  console.log('👉 دلوقتي شغّلي: node src/scripts/seed-pinecone.js عشان تملي البيانات.');
};

run().catch((err) => {
  console.error('❌ حصل خطأ:', err.message);
});