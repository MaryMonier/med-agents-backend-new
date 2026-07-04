const PLANS = {
  Basic: {
    monthlyPriceEGP: 200,
  },
  Pro: {
    monthlyPriceEGP: 350,
  },
};

const ALLOWED_MONTHS = [1, 3, 6, 12];

function calculateAmountCents(plan, months) {
  const planConfig = PLANS[plan];

  if (!planConfig) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (!ALLOWED_MONTHS.includes(Number(months))) {
    throw new Error(`Invalid months value: ${months}`);
  }

  const totalEGP = planConfig.monthlyPriceEGP * Number(months);
  return Math.round(totalEGP * 100); 
}

// بتحسب تاريخ انتهاء الاشتراك الجديد بعد التجديد
// لو لسه فيه وقت باقي من اشتراك فعّال (active) ومعداش انتهاؤه بعد،
// بنضيف المدة الجديدة فوق الوقت الباقي بدل ما نبدأ من الصفر من النهاردة
// لو الاشتراك منتهي أو تريال، بنبدأ حساب المدة الجديدة من النهاردة عادي
function calculateNewSubscriptionEnd(currentSubscription, months) {
  const now = new Date();

  const hasRemainingTime =
    currentSubscription.status === "active" &&
    currentSubscription.subscriptionEnd &&
    new Date(currentSubscription.subscriptionEnd) > now;

  const baseDate = hasRemainingTime
    ? new Date(currentSubscription.subscriptionEnd)
    : now;

  const newEnd = new Date(baseDate);
  newEnd.setMonth(newEnd.getMonth() + Number(months));

  return newEnd;
}

module.exports = {
  PLANS,
  ALLOWED_MONTHS,
  calculateAmountCents,
  calculateNewSubscriptionEnd,
};