const User = require("../models/User");
const Patient = require("../models/Patient");
const Consultation = require("../models/Consultation");
const Followup = require("../models/Followup");
const Payment = require("../models/Payment");

// آخر 6 شهور (بما فيهم الشهر الحالي) كمصفوفة {key: "YYYY-M", label: "Jan"}
// بنستخدمها كإطار موحّد لأي إحصائية شهرية (نمو المرضى، الإيرادات...)
// عشان الشهور اللي مفيهاش داتا تظهر بصفر بدل ما تختفي من الرسم
const buildLastSixMonths = () => {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString("en", { month: "short" }),
      year: d.getFullYear(),
      month: d.getMonth(),
    });
  }
  return months;
};

// GET /api/dashboard/stats
// إحصائيات الهوم بتاعة الداشبورد كاملة، محسوبة على كل الداتا في الداتابيز
// (مش بس أول صفحة زي ما كان بيحصل لما الفرونت كان بيجيب /patients و/prescriptions
// من غير limit، فكانت النتائج بتتحسب من أول 10 سجلات بس).
const getDashboardStats = async (req, res) => {
  try {
    const sixMonths = buildLastSixMonths();
    const rangeStart = new Date(sixMonths[0].year, sixMonths[0].month, 1);

    const [
      totalDoctors,
      totalPatients,
      totalConsultations,
      totalFollowups,
      patientAges,
      topDoctorsRaw,
      subsByStatusRaw,
      subsByPlanRaw,
      patientGrowthRaw,
      revenueTotalRaw,
      revenueByPlanRaw,
      revenueByMonthRaw,
      followupTotal,
      followupCompleted,
      followupPending,
      followupCancelled,
    ] = await Promise.all([
      User.countDocuments({ role: "doctor" }),
      Patient.countDocuments({}),
      Consultation.countDocuments({}),
      Followup.countDocuments({}),
      Patient.find({}).select("dateOfBirth"),
      Patient.aggregate([
        { $match: { createdBy: { $ne: null } } },
        { $group: { _id: "$createdBy", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      User.aggregate([
        { $match: { role: "doctor" } },
        { $group: { _id: "$subscription.status", count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { role: "doctor" } },
        { $group: { _id: "$subscription.plan", count: { $sum: 1 } } },
      ]),
      Patient.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
      ]),
      Payment.aggregate([
        { $match: { status: "success" } },
        { $group: { _id: null, totalCents: { $sum: "$amountCents" } } },
      ]),
      Payment.aggregate([
        { $match: { status: "success" } },
        { $group: { _id: "$plan", totalCents: { $sum: "$amountCents" } } },
      ]),
      Payment.aggregate([
        {
          $match: { status: "success", createdAt: { $gte: rangeStart } },
        },
        {
          $group: {
            _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
            totalCents: { $sum: "$amountCents" },
          },
        },
      ]),
      Followup.countDocuments({}),
      Followup.countDocuments({ status: "confirmed", completedAt: { $ne: null } }),
      Followup.countDocuments({ status: "pending" }),
      Followup.countDocuments({ status: "cancelled" }),
    ]);

    // توزيع الأعمار - بيحسب من كل المرضى (مش أول صفحة بس)
    const ageBuckets = { "0-18": 0, "19-40": 0, "41-60": 0, "60+": 0 };
    patientAges.forEach((p) => {
      if (!p.dateOfBirth) return;
      const age = new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear();
      if (age <= 18) ageBuckets["0-18"]++;
      else if (age <= 40) ageBuckets["19-40"]++;
      else if (age <= 60) ageBuckets["41-60"]++;
      else ageBuckets["60+"]++;
    });
    const ageTotal = patientAges.length || 1;
    const ageGroups = Object.entries(ageBuckets).map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / ageTotal) * 100),
    }));

    // أكتر 5 دكاترة عندهم مرضى - بيانات الدكتور (الاسم) بتتجاب بعدين بـ populate يدوي
    const topDoctorIds = topDoctorsRaw.map((d) => d._id);
    const topDoctorUsers = await User.find({ _id: { $in: topDoctorIds } }).select(
      "name specialty",
    );
    const topDoctors = topDoctorsRaw.map((d) => {
      const doc = topDoctorUsers.find((u) => String(u._id) === String(d._id));
      return {
        _id: d._id,
        name: doc?.name || "—",
        specialty: doc?.specialty || "",
        patientCount: d.count,
      };
    });

    // الاشتراكات - حسب الحالة والخطة (كل الدكاترة مش صفحة واحدة بس)
    const subscriptionsByStatus = { trial: 0, active: 0, expired: 0 };
    subsByStatusRaw.forEach((s) => {
      if (s._id in subscriptionsByStatus) subscriptionsByStatus[s._id] = s.count;
    });
    const subscriptionsByPlan = {};
    subsByPlanRaw.forEach((s) => {
      subscriptionsByPlan[s._id || "Trial"] = s.count;
    });

    // نمو المرضى شهريًا - آخر 6 شهور، الشهور اللي مفيهاش مرضى بتظهر صفر
    const patientGrowth = sixMonths.map(({ key, label, year, month }) => {
      const match = patientGrowthRaw.find(
        (r) => r._id.y === year && r._id.m === month + 1,
      );
      return { month: label, count: match?.count || 0 };
    });

    // الإيرادات - إجمالي، حسب الخطة، وحسب آخر 6 شهور (بالجنيه، بعد تحويلها من القروش)
    const revenueTotalEGP = (revenueTotalRaw[0]?.totalCents || 0) / 100;
    const revenueByPlan = {};
    revenueByPlanRaw.forEach((r) => {
      revenueByPlan[r._id || "Unknown"] = (r.totalCents || 0) / 100;
    });
    const revenueByMonth = sixMonths.map(({ label, year, month }) => {
      const match = revenueByMonthRaw.find(
        (r) => r._id.y === year && r._id.m === month + 1,
      );
      return { month: label, totalEGP: (match?.totalCents || 0) / 100 };
    });

    // نسبة إنجاز الفوللو أب - completed لازم يكون status="confirmed" ومعاه
    // completedAt فعلي (ده اللي بيتسجل وقت ما الدكتور يكمّل الزيارة فعليًا)
    const followupCompletionRate = followupTotal
      ? Math.round((followupCompleted / followupTotal) * 100)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        counts: {
          totalDoctors,
          totalPatients,
          totalConsultations,
          totalFollowups,
        },
        ageGroups,
        topDoctors,
        subscriptions: {
          byStatus: subscriptionsByStatus,
          byPlan: subscriptionsByPlan,
        },
        revenue: {
          totalEGP: revenueTotalEGP,
          byPlan: revenueByPlan,
          byMonth: revenueByMonth,
        },
        patientGrowth,
        followupCompletion: {
          total: followupTotal,
          completed: followupCompleted,
          pending: followupPending,
          cancelled: followupCancelled,
          rate: followupCompletionRate,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboardStats };