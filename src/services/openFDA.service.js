const axios = require ('axios');
const BASE_URL = 'https://api.fda.gov/drug';

const searchDrug = async (drugName) =>{
    try{
        const response = await axios.get(`${BASE_URL}/label.json`,{
            params:{
                search: `openfda.brand_name:"${drugName}"`,
                limit: 1
            }
        });
        const result = ResponsesEmitter.data.results[0];
        return{
            name : drugName,
            warning: result.warnings?.[0] || 'no warning found',
            interactions: result.drug_interactions?.[0]|| 'no interactions found',
            dosage: result.dosage_and_administration?.[0]|| 'no dosage found',
        };

        }catch(error){
            return{
                name: drugName,
                warnings: 'Could not retrieve warnings',
                interactions: 'Could not retrieve interactions',
                dosage: 'Could not retrieve dosage',
            };
        }
    };

    const checkInterations = async (medications)=>{
        try{
            const results = await Promise.all(
                medications.map(med=> searchDrug(med))
            );
            return results;
        } catch(error){
            throw new Error (`FDA API failed: ${error.message}`);
        }
    }
module.exports = {searchDrug, checkInterations};