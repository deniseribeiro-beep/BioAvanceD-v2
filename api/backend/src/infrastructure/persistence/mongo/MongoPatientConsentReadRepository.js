/**
 * Repositório de leitura Mongo para paciente/consentimento.
 */
const { getCollection } = require('../../../utils/collectionResolver');
const { SampleModel } = require('../../../models/Sample');

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

      const participantId = String(sample?.participantId ?? '').trim();
      const patient = participantId
        ? await patientsCollection.findOne({
          $or: [
            { participantId },
            { _id: participantId }
          ]
        })
        : null;

      if (patient) {
        const consent = await patientConsentsCollection.findOne({
          participantId: {
            $in: [patient.participantId, patient._id?.toString()]
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
        participantId: sample.participantId,
        sampleType: sample.sampleType,
        sampleOrigin: sample.sampleOrigin,
        specimenStatus: SampleModel.resolveSpecimenStatus(sample),
        quantity: sample.quantity,
        registeredAt: sample.registeredAt,
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
