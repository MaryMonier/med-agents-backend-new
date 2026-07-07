const Consultation = require("../models/Consultation");
const Patient = require("../models/Patient");
const Followup = require("../models/Followup");
const Prescription = require("../models/Prescription");

const { runClinicalRecAgent } = require("../agents/clinicalRecAgent");

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

// لو الدكتور حدد إن الدايجنوزز دي مرض مزمن، نضيفها لـ Patient.chronicConditions
// (من غير تكرار لو هي موجودة بالفعل)
const addDiagnosisToChronicConditions = async (patientId, diagnosis) => {
  if (!diagnosis || !diagnosis.trim()) return;
  const trimmed = diagnosis.trim();
  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedNew = normalize(trimmed);

  const patient = await Patient.findById(patientId).select("chronicConditions");
  if (!patient) return;

  // TEMP DEBUG — هنشيلها بعد ما نلاقي السبب
  console.log(
    `[addDiagnosisToChronicConditions][DEBUG] patientId=${patientId} incoming="${trimmed}" existing=${JSON.stringify(patient.chronicConditions)}`,
  );

  // مش بس exact match — بنشيك كمان لو التشخيص الجديد جزء من حالة مسجلة
  // بالفعل أو العكس (زي "Diabetes" الموجودة و"Type 2 Diabetes" الجديدة)
  // عشان مانضيفش نفس المرض تاني بصياغة مختلفة شوية
  const alreadyExists = (patient.chronicConditions || []).some((c) => {
    const normalizedExisting = normalize(c);
    return (
      normalizedExisting === normalizedNew ||
      normalizedExisting.includes(normalizedNew) ||
      normalizedNew.includes(normalizedExisting)
    );
  });

  // TEMP DEBUG
  console.log(
    `[addDiagnosisToChronicConditions][DEBUG] alreadyExists=${alreadyExists}`,
  );

  if (alreadyExists) return;

  await Patient.findByIdAndUpdate(patientId, {
    $push: { chronicConditions: trimmed },
  });
};

// عكس الدالة اللي فوق: لو الدكتور شال علامة الصح من "Chronic Disease" وهو
// بيعدّل كونسلتيشن كانت متعلّمة كمرض مزمن قبل كده، لازم نشيل التشخيص ده من
// Patient.chronicConditions — بنفس منطق الـ near-duplicate matching عشان
// نلاقي الصيغة الصحيحة المسجلة حتى لو مش مطابقة حرفيًا
const removeDiagnosisFromChronicConditions = async (patientId, diagnosis) => {
  if (!diagnosis || !diagnosis.trim()) return;
  const trimmed = diagnosis.trim();
  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedTarget = normalize(trimmed);

  const patient = await Patient.findById(patientId).select("chronicConditions");
  if (!patient || !Array.isArray(patient.chronicConditions)) return;

  const remaining = patient.chronicConditions.filter((c) => {
    const normalizedExisting = normalize(c);
    const matches =
      normalizedExisting === normalizedTarget ||
      normalizedExisting.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedExisting);
    return !matches;
  });

  if (remaining.length === patient.chronicConditions.length) return; // مفيش حاجة اتشالت

  await Patient.findByIdAndUpdate(patientId, {
    $set: { chronicConditions: remaining },
  });
};

// بترجّع chronicConditions المحدّثة لبيشنت معيّن — بنستخدمها عشان نبعت
// النسخة النهائية (بعد أي إضافة/إزالة) في الـ response، فالفرونت يقدر
// يعمل dispatch على طول لـ redux (Patient History) من غير ما يستنى refetch
const getChronicConditions = async (patientId) => {
  if (!patientId) return undefined;
  const patient = await Patient.findById(patientId).select("chronicConditions");
  return patient?.chronicConditions;
};

const createConsultation = async (req, res) => {
  try {
    const {
      patientId,
      symptoms,
      diagnosis,
      rawInput,
      language,
      followUpDate,
      followupId,
      isChronic,
      // القيم دي جاية من خطوة "Get AI Recommendation" اللي حصلت قبل كده على
      // طول (مش بنعمل نداء تاني للـ AI هنا) — عشان الحفظ نفسه يشتغل حتى لو
      // مفيش توكينز، ومايبقاش فيه اعتماد على الـ AI في لحظة الحفظ خالص
      structuredNote,
      suggestedSpecialist,
      urgencyLevel,
    } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Patient not found" });
    }

    if (patient.createdBy.toString() !== req.user.id.toString()) {
      await Patient.findByIdAndUpdate(patientId, {
        $addToSet: { doctors: req.user.id },
      });
    }

    if (followUpDate) {
      const followUp = new Date(followUpDate);
      if (isNaN(followUp.getTime())) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid followUpDate" });
      }
      const today = getStartOfTodayInEgypt();
      const followUpDateOnly = new Date(
        followUp.toISOString().split("T")[0] + "T00:00:00.000Z",
      );
      const todayDateOnly = new Date(
        today.toISOString().split("T")[0] + "T00:00:00.000Z",
      );
      if (followUpDateOnly <= todayDateOnly) {
        return res.status(400).json({
          success: false,
          message: "followUpDate must be after today",
        });
      }
      const maxDate = new Date(todayDateOnly);
      maxDate.setMonth(maxDate.getMonth() + 6);
      if (followUpDateOnly > maxDate) {
        return res.status(400).json({
          success: false,
          message: "followUpDate cannot be more than 6 months from today",
        });
      }
    }

    const consultation = await Consultation.create({
      patientId,
      doctorId: req.user.id,
      symptoms,
      diagnosis,
      rawInput,
      structuredNote: structuredNote || rawInput,
      suggestedSpecialist: suggestedSpecialist || null,
      urgencyLevel: urgencyLevel || "unknown",
      isChronic: !!isChronic,
      language: language || "en",
      status: "completed",
      followUpDate: followUpDate || undefined,
      followupId: followupId || null,
    });

    let chronicConditions;
    if (isChronic) {
      await addDiagnosisToChronicConditions(patientId, diagnosis);
      chronicConditions = await getChronicConditions(patientId);
    }

    // لو الكونسلتيشن دي من فولو أب → غير status الفولو أب لـ confirmed،
    // حدّث الـ instructions بالـ structuredNote الجديدة، واربط
    // completionConsultationId بزيارة الإكمال دي (من غير ما نلمس
    // consultationId الأصلية) عشان نقدر نرجع للزيارة الأصلية ولزيارة
    // الإكمال الاتنين وقت اللزوم (تعديل، حذف، عرض تفاصيل)
    if (followupId) {
      await Followup.findByIdAndUpdate(followupId, {
        $set: {
          status: "confirmed",
          instructions: consultation.structuredNote || rawInput,
          completionConsultationId: consultation._id,
          // تاريخ اليوم الفعلي اللي اتكملت فيه الزيارة - مش بنلمس scheduledDate
          // الأصلي خالص عشان يفضل بيمثل الميعاد المجدول زي ما هو
          completedAt: new Date(),
        },
      });
    }

    // لو الدكتور حدد تاريخ فولو أب جديد، اعمل Followup تلقائي
    let newFollowUp = null;
    if (followUpDate) {
      newFollowUp = await Followup.create({
        consultationId: consultation._id,
        patientId,
        doctorId: req.user.id,
        instructions: "-",
        scheduledDate: followUpDate,
        language: language || "en",
      });
    }

    res.status(201).json({
      success: true,
      message: "Consultation created successfully",
      data: consultation,
      chronicConditions,
      newFollowUp,
    });
  } catch (error) {
    res.status(error.isRateLimit ? 429 : 500).json({
      success: false,
      message: error.message,
      isRateLimit: !!error.isRateLimit,
    });
  }
};

const getAllConsultations = async (req, res) => {
  try {
    const consultations = await Consultation.find({})
      .populate("patientId", "name age")
      .populate("doctorId", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllConsultationsByDoctor = async (req, res) => {
  try {
    // الأدمن يشوف كونسلتيشنز كل الدكاترة، الدكتور العادي يشوف بتاعته بس
    const isAdmin = req.user.role === "admin";
    const filter = isAdmin ? {} : { doctorId: req.user.id };

    // الكونسلتيشن اللي جاية من فولو أب (followupId موجود) مش بتظهر هنا،
    // دي بتظهر بس في صفحة Follow-ups تحت تاب Completed، وفي Patient History
    const consultations = await Consultation.find({
      ...filter,
      followupId: null,
    })
      .populate("patientId", "name age")
      .populate("doctorId", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConsultationsByDoctorId = async (req, res) => {
  try {
    const { doctorId } = req.params;

    if (req.user.role !== "admin" && req.user.id !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own consultations.",
      });
    }

    const consultations = await Consultation.find({ doctorId })
      .populate("patientId", "name age")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: consultations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConsultationById = async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id)
      .populate("patientId", "name age")
      .populate("doctorId", "name");
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }
    res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateConsultation = async (req, res) => {
  try {
    console.log(
      `[updateConsultation] id=${req.params.id} payload keys=${Object.keys(req.body).join(",")}`,
    );

    // بنحتاج نعرف حالة isChronic والتشخيص القديمين قبل ما نعمل الـ update،
    // عشان لو الدكتور شال علامة الصح، نعرف نشيل التشخيص الصح (القديم) من
    // chronicConditions — مش التشخيص الجديد اللي ممكن يكون اتغيّر في نفس التعديل
    const beforeUpdate = await Consultation.findById(req.params.id).select(
      "isChronic diagnosis patientId",
    );
    if (!beforeUpdate) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    // لو followUpDate جاية فاضية (يعني الدكتور مسحها عن قصد)، لازم نحولها
    // لـ null مش نسيبها string فاضي — عشان Mongoose هيفشل وهو بيحاول يحوّلها
    // لـ Date ويرمي CastError
    const updatePayload = { ...req.body };
    if ("followUpDate" in updatePayload && !updatePayload.followUpDate) {
      updatePayload.followUpDate = null;
    }

    const consultation = await Consultation.findByIdAndUpdate(
      req.params.id,
      updatePayload,
      { new: true, runValidators: true },
    );
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    console.log(
      `[updateConsultation] saved OK, new diagnosis="${consultation.diagnosis}"`,
    );

    // بنجهّز المتغيّر ده عشان لو فعلاً حصل تغيير (إضافة أو إزالة) في
    // chronicConditions، نبعت النسخة النهائية في الـ response بالظبط زي
    // ما بيحصل في createConsultation — عشان الفرونت يعمل dispatch لـ
    // redux على طول من غير ما يستنى refetch كامل لـ Patient History
    let chronicConditions;
    if ("isChronic" in req.body) {
      if (req.body.isChronic) {
        await addDiagnosisToChronicConditions(
          consultation.patientId,
          req.body.diagnosis ?? consultation.diagnosis,
        );
        chronicConditions = await getChronicConditions(consultation.patientId);
      } else if (beforeUpdate.isChronic) {
        // كانت متعلّمة كمرض مزمن قبل التعديل ودلوقتي اتشالت العلامة — نشيل
        // التشخيص (القديم، قبل أي تعديل عليه في نفس الطلب) من الليستة
        await removeDiagnosisFromChronicConditions(
          beforeUpdate.patientId,
          beforeUpdate.diagnosis,
        );
        chronicConditions = await getChronicConditions(consultation.patientId);
      }
    }

    // لو الدكتور حدد (أو غيّر) تاريخ فولو أب وهو بيعدّل الكونسلتيشن/الفولو
    // أب، لازم نتأكد إن فيه Followup فعلاً بالتاريخ ده — createConsultation
    // بتعمل ده وقت الإنشاء، لكن التعديل مكانش بيعملها خالص، فكان ممكن الدكتور
    // يحدد ميعاد فولو أب وهو بيعدّل ومتتعملش فولو أب فعلية.
    // بنفرّق بين "الحقل مش موجود في الطلب خالص" (تعديل تاني مالوش دعوة
    // بالفولو أب، فمنلمسهاش) و"الحقل موجود لكن فاضي" (الدكتور مسح التاريخ
    // عن قصد، فلازم نلغي أي فولو أب pending كانت متجدولة)
    let newFollowUp = null;
    if ("followUpDate" in req.body) {
      const existingPendingFollowup = await Followup.findOne({
        consultationId: consultation._id,
        status: "pending",
      });

      if (req.body.followUpDate) {
        if (existingPendingFollowup) {
          // لو فيه فولو أب pending بالفعل مربوطة بالكونسلتيشن دي، بس حدّث تاريخها
          existingPendingFollowup.scheduledDate = req.body.followUpDate;
          await existingPendingFollowup.save();
          newFollowUp = existingPendingFollowup;
        } else {
          newFollowUp = await Followup.create({
            consultationId: consultation._id,
            patientId: consultation.patientId,
            doctorId: req.user.id,
            instructions: "-",
            scheduledDate: req.body.followUpDate,
            language: consultation.language || "en",
          });
        }
      } else if (existingPendingFollowup) {
        // الدكتور مسح تاريخ الفولو أب عن قصد → نلغي الفولو أب المعلقة دي
        await existingPendingFollowup.deleteOne();
      }
    }

    // لو الكونسلتيشن دي جايه أصلاً من إكمال فولو أب (يعني فيها followupId)،
    // لازم نقفل الفولو أب المصدر دي هنا كمان بالظبط زي ما بيحصل في
    // createConsultation - من قبل كده مكانش بيحصل خالص هنا، فالفرونت كان
    // مضطر يعمل نداء منفصل (updateFollowUp) وبيكتب فوق scheduledDate
    // بالغلط بدل ما يسجل completedAt
    if (req.body.followupId) {
      const sourceFollowup = await Followup.findById(req.body.followupId);
      if (sourceFollowup && !sourceFollowup.completedAt) {
        sourceFollowup.status = "confirmed";
        sourceFollowup.instructions =
          consultation.structuredNote || consultation.rawInput;
        sourceFollowup.completionConsultationId = consultation._id;
        sourceFollowup.completedAt = new Date();
        await sourceFollowup.save();
      }
    }

    res.status(200).json({
      success: true,
      data: consultation,
      chronicConditions,
      newFollowUp,
    });
  } catch (error) {
    console.error("[updateConsultation] FAILED:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteConsultation = async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id);
    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    console.log(`[deleteConsultation] deleting id=${consultation._id}`);

    // بنمشي بالظبط على السلسلة المتصلة بالكونسلتيشن اللي هتتمسح، في
    // الاتجاهين:
    // • forward: فولو أبات اتجدولت من الكونسلتيشن دي (consultationId)
    // • backward: فولو أب خلصت (اتكملت) بزيارة هي الكونسلتيشن دي (completionConsultationId)
    // ولو أي فولو أب في السلسلة كانت خلصت بزيارة تانية (كونسلتيشن تانية)،
    // الزيارة دي بتتحسب هي كمان جزء من نفس السلسلة وبتتمسح خالص (مش بس
    // بريسكربتها) — عشان الفولو أب دي أصلاً محفوظة كـ"كونسلتيشن" في
    // الداتا بيز، فمفيش معنى تفضل الكونسلتيشن دي قاعدة من غير الفولو أب
    // اللي بتمثلها، ولا يفضل ظاهر كارت "Follow-up Visit" في الـ Patient
    // History من غير روشتة وراه
    const deadFollowupIds = new Set();
    const deadConsultationIds = new Set([String(consultation._id)]);
    const consultationsToWalk = [String(consultation._id)];
    const visitedConsultations = new Set();

    while (consultationsToWalk.length > 0) {
      const currentId = consultationsToWalk.shift();
      if (visitedConsultations.has(currentId)) continue;
      visitedConsultations.add(currentId);

      const forwardFollowups = await Followup.find({
        consultationId: currentId,
      });
      const backwardFollowups = await Followup.find({
        completionConsultationId: currentId,
      });

      for (const followup of [...forwardFollowups, ...backwardFollowups]) {
        const fid = String(followup._id);
        if (deadFollowupIds.has(fid)) continue;
        deadFollowupIds.add(fid);

        if (followup.completionConsultationId) {
          const compId = String(followup.completionConsultationId);
          deadConsultationIds.add(compId);
          consultationsToWalk.push(compId);
        }
      }
    }

    console.log(
      `[deleteConsultation] chain found: consultations=[${[...deadConsultationIds].join(",")}] followups=[${[...deadFollowupIds].join(",")}]`,
    );

    if (deadConsultationIds.size > 0) {
      await Prescription.deleteMany({
        consultationId: { $in: [...deadConsultationIds] },
      });
    }
    if (deadFollowupIds.size > 0) {
      await Followup.deleteMany({ _id: { $in: [...deadFollowupIds] } });
    }
    await Consultation.deleteMany({
      _id: { $in: [...deadConsultationIds] },
    });

    res.status(200).json({
      success: true,
      message: "Consultation and its full follow-up chain deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAIRecommendation = async (req, res) => {
  try {
    const { symptoms, diagnosis, rawInput, language } = req.body;

    const agentResult = await runClinicalRecAgent({
      rawInput,
      symptoms,
      diagnosis,
      language: language || "en",
    });

    res.status(200).json({
      success: true,
      data: agentResult,
    });
  } catch (error) {
    res.status(error.isRateLimit ? 429 : 500).json({
      success: false,
      message: error.message,
      isRateLimit: !!error.isRateLimit,
    });
  }
};
module.exports = {
  createConsultation,
  getAllConsultations,
  getConsultationById,
  updateConsultation,
  deleteConsultation,
  getAllConsultationsByDoctor,

  getConsultationsByDoctorId,
  getAIRecommendation,
};
