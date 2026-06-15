const cron = require("node-cron");
const Followup = require("../models/Followup");

// ─── Helper: جيب بداية اليوم بتوقيت مصر (Africa/Cairo) ─────────────────────
const getStartOfTodayInEgypt = () => {
  const now = new Date();

  const egyptDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return new Date(`${egyptDateStr}T00:00:00.000Z`);
};

// بيشغل كل دقيقة، بس بيشيك جوه إذا كان دلوقتي بعد منتصف الليل بتوقيت مصر
// عشان نضمن إن الـ check يحصل في اللحظة الصح بتوقيت مصر بدل ما نعتمد
// على توقيت السيرفر (UTC) في تحديد الـ cron schedule
const startFollowupCron = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const egyptTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);

      // بنشغل اللوجيك بس لما الساعة تكون 00:00 بتوقيت مصر
      if (egyptTime !== "00:00") return;

      // بداية اليوم الحالي بتوقيت مصر = أي followup قبل ده وخلص يومه
      const startOfToday = getStartOfTodayInEgypt();

      const result = await Followup.updateMany(
        {
          status: "pending",
          scheduledDate: { $lt: startOfToday },
        },
        { $set: { status: "cancelled" } },
      );

      console.log(
        `[Followup Cron] Cancelled ${result.modifiedCount} expired follow-up(s)`,
      );
    } catch (error) {
      console.error("[Followup Cron] Error:", error.message);
    }
  });

  console.log("[Followup Cron] Scheduled to run daily at 00:00 (Africa/Cairo)");
};

module.exports = { startFollowupCron };
