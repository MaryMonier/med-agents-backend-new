
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

// بتحسب تاريخ انتهاء الاشتراك الجديد بعد التجديد
// لو لسه فيه وقت باقي من اشتراك فعّال (active) ومعداش انتهاؤه بعد، وaddRemainingTime=true،
// بنضيف المدة الجديدة فوق الوقت الباقي بدل ما نبدأ من الصفر من النهاردة
// لو الاشتراك منتهي أو تريال، أو addRemainingTime=false (حالة تبديل الخطة)،
// بنبدأ حساب المدة الجديدة من النهاردة عادي - وده معناه فقدان أي وقت باقي من الخطة القديمة
function calculateNewSubscriptionEnd(currentSubscription, months, options = {}) {
  const { addRemainingTime = true } = options;
  const now = new Date();

  const hasRemainingTime =
    addRemainingTime &&
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