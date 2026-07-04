const axios = require("axios");
const crypto = require("crypto");
const {
  PAYMOB_SECRET_KEY,
  PAYMOB_PUBLIC_KEY,
  PAYMOB_INTEGRATION_ID,
  PAYMOB_HMAC_SECRET,
} = require("../config/env");

const BASE_URL = "https://accept.paymob.com";

// بيبني intention جديدة (طلب دفع) عن طريق الـ Secret key
// ده النظام الجديد بتاع باي موب (Intention API) بدل النظام القديم
// اللي كان بياخد auth token -> order -> payment key على حدة
async function createIntention({
  amountCents,
  merchantOrderId,
  billingData,
  redirectionUrl,
  notificationUrl,
}) {
  const { data } = await axios.post(
    `${BASE_URL}/v1/intention/`,
    {
      amount: amountCents,
      currency: "EGP",
      payment_methods: [Number(PAYMOB_INTEGRATION_ID)],
      billing_data: billingData,
      special_reference: merchantOrderId,
      notification_url: notificationUrl,
      redirection_url: redirectionUrl,
      items: [],
    },
    {
      headers: {
        Authorization: `Token ${PAYMOB_SECRET_KEY}`,
      },
    }
  );

  return data; // فيها client_secret
}

// رابط صفحة الدفع الموحدة (Unified Checkout) اللي هنوديه عليها الدكتور
function buildCheckoutUrl(clientSecret) {
  return `${BASE_URL}/unifiedcheckout/?publicKey=${PAYMOB_PUBLIC_KEY}&clientSecret=${clientSecret}`;
}

// الدالة الرئيسية: بتعمل الـ intention وترجع رابط الدفع
async function createPaymentLink({
  amountCents,
  merchantOrderId,
  billingData,
  redirectionUrl,
  notificationUrl,
}) {
  const intention = await createIntention({
    amountCents,
    merchantOrderId,
    billingData,
    redirectionUrl,
    notificationUrl,
  });

  return {
    paymobIntentionId: intention.id,
    checkoutUrl: buildCheckoutUrl(intention.client_secret),
  };
}

// التحقق من إن الـ webhook فعلاً جاي من باي موب ومحدش بيحاول يزوّر طلب
// باي موب بيحسب HMAC على شكل محدد من الحقول مرتبة أبجديًا (حسب توثيقهم)
const HMAC_FIELDS_ORDER = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

function getNestedValue(obj, path) {
  return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function verifyHmac(transactionObj, receivedHmac) {
  if (!PAYMOB_HMAC_SECRET || !receivedHmac) return false;

  const concatenatedString = HMAC_FIELDS_ORDER.map((field) => {
    const value = getNestedValue(transactionObj, field);
    return value === undefined || value === null ? "" : String(value);
  }).join("");

  const calculatedHmac = crypto
    .createHmac("sha512", PAYMOB_HMAC_SECRET)
    .update(concatenatedString)
    .digest("hex");

  return calculatedHmac === receivedHmac;
}

module.exports = {
  createPaymentLink,
  verifyHmac,
};