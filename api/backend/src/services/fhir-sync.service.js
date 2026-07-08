const logger = require('../utils/logger');

/**
 * FHIR interoperability boundary.
 *
 * FHIR resources are serialized on demand and are not persisted as parallel
 * operational documents. MongoDB canonical collections remain the only source
 * of truth; Neo4j receives projections exclusively through the outbox.
 */
class FhirBoundaryService {
  mapSexToFhirGender(sex) {
    if (sex === 'M') return 'male';
    if (sex === 'F') return 'female';
    if (sex === 'O') return 'other';
    return 'unknown';
  }

  mapSampleStatusToFhir(status) {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized === 'AVAILABLE' || normalized === 'PARTIAL') return 'available';
    if (normalized === 'DEPLETED' || normalized === 'UNAVAILABLE') return 'unavailable';
    return 'unsatisfactory';
  }

  mapConsentStatusToFhir(status) {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized === 'ACTIVE') return 'active';
    if (normalized === 'REVOKED') return 'inactive';
    return 'draft';
  }

  buildPatientFhirPayload(patient = {}) {
    const patientName = String(patient.patientName || '').trim();
    const names = patientName.split(/\s+/).filter(Boolean);
    const family = names.length > 1 ? names[names.length - 1] : patientName;
    const given = names.length > 1 ? names.slice(0, -1) : [patientName || 'Participant'];
    const telecom = [];

    if (patient.email) {
      telecom.push({ system: 'email', value: String(patient.email), use: 'home' });
    }
    if (patient.phone) {
      telecom.push({ system: 'phone', value: String(patient.phone), use: 'mobile' });
    }

    return {
      resourceType: 'Patient',
      identifier: [{
        system: 'https://bioavanced.local/participant-id',
        value: String(patient.patientID || '')
      }],
      active: String(patient.status || '').toUpperCase() !== 'INACTIVE',
      name: [{ use: 'official', text: patientName, family, given }],
      telecom,
      gender: this.mapSexToFhirGender(patient.sex),
      birthDate: patient.birthDate ? new Date(patient.birthDate).toISOString().slice(0, 10) : undefined
    };
  }

  buildSampleFhirPayload(sample = {}) {
    const sampleId = String(sample.sampleID || sample._id || '').trim();
    const patientId = String(sample.patientID || '').trim();
    const receivedTime = sample.receivedTime || sample.registrationDate || sample.createdAt;

    return {
      resourceType: 'Specimen',
      identifier: [{
        system: 'https://bioavanced.local/specimen-id',
        value: sampleId
      }],
      status: this.mapSampleStatusToFhir(sample.status),
      type: {
        coding: [{
          system: 'https://bioavanced.local/CodeSystem/specimen-type',
          code: String(sample.sampleType || ''),
          display: String(sample.sampleType || '')
        }],
        text: String(sample.sampleType || '')
      },
      subject: {
        reference: `Patient/${patientId}`,
        identifier: {
          system: 'https://bioavanced.local/participant-id',
          value: patientId
        }
      },
      receivedTime: receivedTime ? new Date(receivedTime).toISOString() : undefined,
      quantity: Number.isFinite(Number(sample.quantity)) ? {
        value: Number(sample.quantity),
        unit: String(sample.unit || ''),
        system: 'http://unitsofmeasure.org',
        code: String(sample.unit || '')
      } : undefined
    };
  }

  buildConsentFhirPayload(consent = {}) {
    const patientId = String(consent.patientId || '').trim();
    const signedAt = consent.signedAt || consent.createdAt || new Date();
    const active = String(consent.status || '').toUpperCase() === 'ACTIVE';

    return {
      resourceType: 'Consent',
      status: this.mapConsentStatusToFhir(consent.status),
      scope: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'research',
          display: 'Research'
        }]
      },
      patient: { reference: `Patient/${patientId}` },
      dateTime: new Date(signedAt).toISOString(),
      provision: {
        type: active ? 'permit' : 'deny',
        period: {
          start: new Date(signedAt).toISOString(),
          end: consent.revokedAt ? new Date(consent.revokedAt).toISOString() : undefined
        }
      }
    };
  }

  // Existing callers receive a transient resource only. No secondary
  // patients_fhir, samples_fhir or consents_fhir document is written.
  async upsertPatientFromLegacy(_db, patient) {
    return this.buildPatientFhirPayload(patient);
  }

  async upsertSampleFromLegacy(_db, sample) {
    return this.buildSampleFhirPayload(sample);
  }

  async upsertConsentFromLegacy(_db, consent) {
    return this.buildConsentFhirPayload(consent);
  }

  // Canonical MongoDB collections are always read directly.
  async getPatientFhirFirst() { return null; }
  async listPatientsFhirFirst() { return null; }
  async searchPatientsFhirFirst() { return null; }
  async getSampleFhirFirst() { return null; }
  async getSampleByBarcodeFhirFirst() { return null; }
  async listSamplesFhirFirst() { return null; }
  async getPatientConsentFhirFirst() { return null; }

  async syncAllLegacyData() {
    logger.warn('[FHIR] Parallel FHIR persistence was removed; no synchronization was performed.');
    return { patients: 0, samples: 0, consents: 0 };
  }
}

module.exports = new FhirBoundaryService();
