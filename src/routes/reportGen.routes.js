const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const checkSubscription = require("../middleware/checkSubscription.middleware");
const requireProPlan = require("../middleware/requireProPlan.middleware");
const reportGenAgent = require("../agents/reportGen.agent");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const Patient = require("../models/Patient");
const Followup = require("../models/Followup");

/**
 * POST /api/reports/generate
 *
 * Body:
 * {
 *   patientId:      string  (required)
 *   scope:          "year" | "month" | "consultation"
 *   year?:          number  (required if scope = year | month)
 *   month?:         number  (required if scope = month, 1-12)
 *   consultationId?: string (required if scope = consultation)
 *   language?:      "en" | "ar"
 * }
 */
router.post(
  "/generate",
  authMiddleware,
  checkSubscription,
  requireProPlan,
  async (req, res, next) => {
    try {
      const { patientId, scope, year, month, consultationId, language } =
        req.body;
      const doctorId = req.user.id;

      // ── validation ──────────────────────────────────────────────────────────
      if (!patientId) {
        return res
          .status(400)
          .json({ success: false, message: "patientId is required" });
      }
      if (!["year", "month", "consultation"].includes(scope)) {
        return res.status(400).json({
          success: false,
          message: "scope must be year | month | consultation",
        });
      }
      if ((scope === "year" || scope === "month") && !year) {
        return res
          .status(400)
          .json({ success: false, message: "year is required for this scope" });
      }
      if (scope === "month" && !month) {
        return res.status(400).json({
          success: false,
          message: "month is required for monthly scope",
        });
      }
      if (scope === "consultation" && !consultationId) {
        return res.status(400).json({
          success: false,
          message: "consultationId is required for consultation scope",
        });
      }

      // ── جيب بيانات المريض ────────────────────────────────────────────────────
      const patient = await Patient.findById(patientId).lean();
      if (!patient) {
        return res
          .status(404)
          .json({ success: false, message: "Patient not found" });
      }

      // ── تحقق إن المريض ده بتاع الدكتور ده (الأدمن معفي) ──────────────────
      const isAdmin = req.user.role === "admin";
      const isOwner =
        String(patient.createdBy) === String(doctorId) ||
        (patient.doctors || []).some(
          (d) => String(d?._id || d) === String(doctorId),
        );

      if (!isAdmin && !isOwner) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied to this patient" });
      }

      // ── جيب الكونسلتيشنز ─────────────────────────────────────────────────
      let consultations = [];

      if (scope === "consultation") {
        // 1. جيب الكونسلتيشن الأصلية
        const single = await Consultation.findOne({
          _id: consultationId,
          patientId,
        }).lean();
        if (!single) {
          return res
            .status(404)
            .json({ success: false, message: "Consultation not found" });
        }

        // 2. جيب كل الـ follow-ups اللي اتعملت من الكونسلتيشن دي
        const followups = await Followup.find({ consultationId }).lean();

        // 3. جيب الـ completion consultations بتاعت الـ follow-ups (لو اتكملوا)
        const completionIds = followups
          .filter((f) => f.completionConsultationId)
          .map((f) => f.completionConsultationId);

        const completionConsultations =
          completionIds.length > 0
            ? await Consultation.find({
                _id: { $in: completionIds },
                patientId,
              }).lean()
            : [];

        // الأصلية الأول، بعدين الـ completions بالترتيب الزمني
        consultations = [single, ...completionConsultations].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      } else {
        // للسنوي والشهري — الأدمن يشوف كل كونسلتيشنز المريض، الدكتور بتاعيه بس
        const all = await Consultation.find(
          isAdmin ? { patientId } : { patientId, doctorId },
        )
          .sort({ createdAt: -1 })
          .lean();

        consultations = all.filter((c) => {
          const d = new Date(c.createdAt);
          if (scope === "year") {
            return d.getFullYear() === Number(year);
          }
          // month
          return (
            d.getFullYear() === Number(year) &&
            d.getMonth() + 1 === Number(month)
          );
        });
      }

      // ── اربط كل كونسلتيشن بروشتته (لو موجودة) ──────────────────────────────
      const prescriptionMap = {};
      if (consultations.length > 0) {
        const consultationIds = consultations.map((c) => c._id);
        const prescriptions = await Prescription.find({
          consultationId: { $in: consultationIds },
        }).lean();
        prescriptions.forEach((p) => {
          prescriptionMap[String(p.consultationId)] = p;
        });
      }

      const enrichedConsultations = consultations.map((c) => ({
        ...c,
        date: c.createdAt,
        prescription: prescriptionMap[String(c._id)] || null,
      }));

      // ── labels للـ agent ──────────────────────────────────────────────────────
      const MONTH_NAMES = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      let scopeLabel = "";
      let rangeLabel = "";

      if (scope === "year") {
        scopeLabel = language === "ar" ? "تقرير سنوي" : "Yearly Report";
        rangeLabel = `${language === "ar" ? "عام" : "Year"} ${year}`;
      } else if (scope === "month") {
        scopeLabel = language === "ar" ? "تقرير شهري" : "Monthly Report";
        const monthName = MONTH_NAMES[Number(month) - 1] || month;
        rangeLabel = `${monthName} ${year}`;
      } else {
        scopeLabel =
          language === "ar" ? "كونسلتيشن محدد" : "Specific Consultation";
        const c = enrichedConsultations[0];
        rangeLabel = c
          ? `${c.diagnosis || (language === "ar" ? "بدون تشخيص" : "No diagnosis")} — ${new Date(c.date).toLocaleDateString()}`
          : language === "ar"
            ? "الكونسلتيشن المحدد"
            : "Selected consultation";
      }

      // ── شغّل الـ agent ────────────────────────────────────────────────────────
      const result = await reportGenAgent({
        consultations: enrichedConsultations,
        patient,
        scopeLabel,
        rangeLabel,
        language: language || "en",
      });

      // لو مفيش كونسلتيشنز في النطاق ده، نرجع success بس بدون data من الـ AI
      if (enrichedConsultations.length === 0 && result.success) {
        return res.status(200).json({
          success: true,
          empty: true,
          data: null,
          message:
            language === "ar"
              ? "لا توجد كونسلتيشنز في النطاق الزمني المحدد"
              : "No consultations found in the selected time range",
        });
      }

      res.status(200).json({
        ...result,
        meta: {
          patientId,
          scope,
          year: year || null,
          month: month || null,
          consultationId: consultationId || null,
          consultationCount: enrichedConsultations.length,
          scopeLabel,
          rangeLabel,
          generatedAt: new Date(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
