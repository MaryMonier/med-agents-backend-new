// إعدادات خطط الاشتراك والأسعار
// السعر بالجنيه المصري (هيتحول لقروش تلقائيًا قبل ما يتبعت لباي موب)
// عدّلي الأسعار هنا براحتك من غير ما تلمسي أي كود تاني

const PLANS = {
  Basic: {
    monthlyPriceEGP: 200,
  },
  Pro: {
    monthlyPriceEGP: 350,
  },
};

const ALLOWED_MONTHS = [1, 3, 6, 12];

// بيحسب السعر الإجمالي بالقروش (cents) لخطة ومدة معينة
function calculateAmountCents(plan, months) {
  const planConfig = PLANS[plan];

  if (!planConfig) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (!ALLOWED_MONTHS.includes(Number(months))) {
    throw new Error(`Invalid months value: ${months}`);
  }

  const totalEGP = planConfig.monthlyPriceEGP * Number(months);
  return Math.round(totalEGP * 100); // تحويل لقروش
}

module.exports = {
  PLANS,
  ALLOWED_MONTHS,
  calculateAmountCents,
};
