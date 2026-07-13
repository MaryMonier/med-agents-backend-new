const axios = require("axios");
const BASE_URL = "https://api.fda.gov/drug";

const searchDrug = async (drugName) => {
  try {
    const response = await axios.get(`${BASE_URL}/label.json`, {
      params: {
        search: `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}"`,
        limit: 1,
      },
    });

    const result = response.data.results[0]; // ✅ بدل ResponsesEmitter
    return {
      name: drugName,
      warnings: result.warnings?.[0] || "No warnings found",
      interactions: result.drug_interactions?.[0] || "No interactions found",
      dosage: result.dosage_and_administration?.[0] || "No dosage found",
      contraindications:
        result.contraindications?.[0] || "No contraindications found",
    };
  } catch (error) {
    return {
      name: drugName,
      warnings: "Could not retrieve warnings",
      interactions: "Could not retrieve interactions",
      dosage: "Could not retrieve dosage",
      contraindications: "Could not retrieve contraindications",
    };
  }
};

const checkInteractions = async (medications) => {
  try {
    const results = await Promise.all(
      medications.map((med) => searchDrug(med.name)),
    );
    return results;
  } catch (error) {
    throw new Error(`FDA API failed: ${error.message}`);
  }
};

module.exports = { searchDrug, checkInteractions };
