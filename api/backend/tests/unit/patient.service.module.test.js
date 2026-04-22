import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateUniquePatientIDMock = vi.hoisted(() => vi.fn().mockResolvedValue('12345678'));
const buildConsentMetadataMock = vi.hoisted(() => vi.fn(() => ({
  token: 'consent-token-qa',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-03T00:00:00.000Z'),
})));

vi.mock('../../src/utils/patientAnonymization', () => ({
  generateUniquePatientID: generateUniquePatientIDMock,
  sanitizePatientForLogs: (value) => value,
}));

vi.mock('../../src/utils/fieldEncryption', () => ({
  encryptValue: () => null,
  decryptValue: (value) => value,
}));

vi.mock('../../src/services/notification.service', () => ({
  default: {
    buildConsentMetadata: buildConsentMetadataMock,
    buildConsentLink: vi.fn(() => 'https://consent/link'),
    enqueueConsentNotification: vi.fn().mockResolvedValue(undefined),
  },
  buildConsentMetadata: buildConsentMetadataMock,
  buildConsentLink: vi.fn(() => 'https://consent/link'),
  enqueueConsentNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/fhir-sync.service', () => ({
  default: {
    upsertPatientFromLegacy: vi.fn().mockResolvedValue(undefined),
  },
  upsertPatientFromLegacy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/patientBiomarkerTimeseries.service', () => ({
  default: {
    writePatientBiomarkers: vi.fn().mockResolvedValue(undefined),
  },
  writePatientBiomarkers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/biomarker-xai.service', () => ({
  default: {
    evaluate: vi.fn(() => ({ confidence: 'high' })),
  },
  evaluate: vi.fn(() => ({ confidence: 'high' })),
}));

vi.mock('../../src/services/biomarker-observation.service', () => ({
  default: {
    createObservation: vi.fn().mockResolvedValue(undefined),
  },
  createObservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/collectionResolver', () => ({
  getCollection: vi.fn(async (db, collectionName) => db.collection(collectionName)),
}));

const patientServiceModule = await import('../../src/services/patient.service');
const patientService = patientServiceModule.default || patientServiceModule;

function createDb() {
  const consentTemplatesCollection = {
    findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'Template QA' }),
  };

  const patientsCollection = {
    collectionName: 'patients',
    createIndex: vi.fn().mockResolvedValue('ok'),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-db-id' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
  };

  const clinicalUnitsCollection = {
    findOne: vi.fn().mockResolvedValue(null),
  };

  return {
    collection: vi.fn((name) => {
      if (name === 'consentTemplates' || name === 'consent_templates') return consentTemplatesCollection;
      if (name === 'patients') return patientsCollection;
      if (name === 'clinicalUnits' || name === 'clinical_units') return clinicalUnitsCollection;
      return {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'generic-id' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
        createIndex: vi.fn().mockResolvedValue('ok'),
      };
    }),
    _patientsCollection: patientsCollection,
  };
}

describe('PatientService module rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve exigir representante legal completo para paciente falecido', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Responsável QA',
      representativeEmail: '',
      representativeCpf: '12345678901',
      representativePhone: '11987654321',
    };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow(/representante legal/i);
  });

  it('deve criar paciente com patientID de 8 dígitos e status PENDING_CONSENT', async () => {
    const db = createDb();

    const created = await patientService.createPatient(
      db,
      {
        patientName: 'Paciente QA',
        birthDate: '1990-05-10',
        sex: 'F',
        email: 'paciente.qa@example.com',
        consentTemplateId: '507f1f77bcf86cd799439011',
        clinicalUnitId: null,
        clinicalUnit: 'AMBULATORIO',
      },
      {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true,
      }
    );

    expect(String(created.patientID)).toMatch(/^\d{8}$/);
    expect(created.status).toBe('PENDING_CONSENT');
    expect(typeof created.consentToken).toBe('string');
    expect(created.consentToken.length).toBeGreaterThan(10);
    expect(db._patientsCollection.insertOne).toHaveBeenCalled();
  });
});
