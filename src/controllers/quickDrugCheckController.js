const { runQuickDrugCheck } = require("../agents/quickDrugCheckAgent");

// POST /api/drug-safety/quick-check
const quickCheck = async (req, res, next) => {
  try {
    const {
      newDrug,
      activeMedications,
      allergies,
      patientAge,
      patientGender,
      language,
    } = req.body;

    if (!newDrug || !newDrug.name) {
      const err = new Error("newDrug is required");
      err.status = 400;
      return next(err);
    }

    const result = await runQuickDrugCheck({
      newDrug,
      activeMedications: activeMedications || [],
      allergies: allergies || [],
      patientAge: patientAge ?? null,
      patientGender: patientGender || null,
      language: language || "en",
    });

    if (result.error) {
      return res.status(200).json({
        success: false,
        message: result.message,
        data: { hasIssue: false, message: null },
      });
    }

    res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  }
};

module.exports = { quickCheck };
