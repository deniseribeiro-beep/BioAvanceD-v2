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
        } else {
          consentValid = false;
          consentMessage = 'Sem consentimento ativo';
        }
      } else {
        consentValid = false;
        consentMessage = 'Paciente não encontrado';
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
        consentReasonCode: patient ? (consentValid ? null : 'NO_ACTIVE_CONSENT') : 'PATIENT_NOT_FOUND',
        consentStatus: consentValid ? 'CONSENT_ACTIVE' : 'CONSENT_PENDING',
        canUse: consentValid,
        canAllocate: consentValid
      };
    }));

    return enriched.filter((sample) => sample.canAllocate);
  }
}

module.exports = MongoPatientConsentReadRepository;
