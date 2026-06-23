/**
 * Repositório de leitura Mongo para paciente/consentimento.
 */
const { getCollection } = require('../../../utils/collectionResolver');

class MongoPatientConsentReadRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {Array<object>} samples
   */
  async enrichSamplesWithConsent(samples) {
    const patientsCollection = await getCollection(this.db, 'patients');
    const patientConsentsCollection = await getCollection(this.db, 'consents');

    const consentCount = await patientConsentsCollection.countDocuments();

    const enriched = await Promise.all((samples || []).map(async (sample) => {
      let consentValid = false;
      let consentMessage = '';

      const patient = await patientsCollection.findOne({
        $or: [
          { patientID: sample.patientID },
          { _id: sample.patientID }
        ]
      });

      if (patient) {
        const consent = await patientConsentsCollection.findOne({
          patientId: {
            $in: [patient.patientID, patient._id?.toString()]
              .filter((value) => value !== undefined && value !== null && value !== '')
              .map(String)
          },
          status: 'ACTIVE'
        });

        if (consent) {
          consentValid = true;
          consentMessage = 'Consentimento ativo';
        } else if (consentCount === 0) {
          consentValid = true;
          consentMessage = 'Sistema de consentimento em implementação';
        } else {
          consentValid = false;
          consentMessage = 'Sem consentimento ativo';
        }
      } else {
        consentValid = true;
        consentMessage = 'Paciente não encontrado (dev mode)';
      }

      return {
        _id: sample._id,
        barcode: sample.barcode,
        patientID: sample.patientID,
        sampleType: sample.sampleType,
        sampleOrigin: sample.sampleOrigin,
        currentStatus: sample.currentStatus,
        quantity: sample.quantity,
        registrationDate: sample.registrationDate,
        consentValid,
        consentMessage,
        canAllocate: consentValid
      };
    }));

    return enriched.filter((sample) => sample.canAllocate);
  }
}

module.exports = MongoPatientConsentReadRepository;
