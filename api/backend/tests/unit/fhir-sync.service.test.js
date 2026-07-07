import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fhirSyncService = require('../../src/services/fhir-sync.service');
const env = require('../../src/config/env');
const logger = require('../../src/utils/logger');

describe('FhirSyncService mapping helpers (to FHIR)', () => {
  it('maps sex codes to FHIR gender', () => {
    expect(fhirSyncService.mapSexToFhirGender('M')).toBe('male');
    expect(fhirSyncService.mapSexToFhirGender('F')).toBe('female');
    expect(fhirSyncService.mapSexToFhirGender('O')).toBe('other');
    expect(fhirSyncService.mapSexToFhirGender('X')).toBe('unknown');
    expect(fhirSyncService.mapSexToFhirGender(undefined)).toBe('unknown');
  });

  it('maps sample legacy status to FHIR status', () => {
    expect(fhirSyncService.mapSampleStatusToFhir('Available')).toBe('available');
    expect(fhirSyncService.mapSampleStatusToFhir('Unusable')).toBe('unsatisfactory');
    expect(fhirSyncService.mapSampleStatusToFhir('Destroyed')).toBe('unsatisfactory');
    expect(fhirSyncService.mapSampleStatusToFhir('Expired')).toBe('unsatisfactory');
    expect(fhirSyncService.mapSampleStatusToFhir('Withdrawn')).toBe('unavailable');
    expect(fhirSyncService.mapSampleStatusToFhir('Depleted')).toBe('unavailable');
    expect(fhirSyncService.mapSampleStatusToFhir('Unavailable')).toBe('unavailable');
    expect(fhirSyncService.mapSampleStatusToFhir('SomethingElse')).toBe('available');
    expect(fhirSyncService.mapSampleStatusToFhir(undefined)).toBe('available');
  });

  it('maps consent legacy status to FHIR status', () => {
    expect(fhirSyncService.mapConsentStatusToFhir('ACTIVE')).toBe('active');
    expect(fhirSyncService.mapConsentStatusToFhir('active')).toBe('active');
    expect(fhirSyncService.mapConsentStatusToFhir('REVOKED')).toBe('inactive');
    expect(fhirSyncService.mapConsentStatusToFhir('PENDING')).toBe('draft');
    expect(fhirSyncService.mapConsentStatusToFhir(undefined)).toBe('draft');
  });
});

describe('FhirSyncService mapping helpers (from FHIR)', () => {
  it('maps FHIR gender back to legacy sex code', () => {
    expect(fhirSyncService.mapSexFromFhirGender('male')).toBe('M');
    expect(fhirSyncService.mapSexFromFhirGender('female')).toBe('F');
    expect(fhirSyncService.mapSexFromFhirGender('other')).toBe('O');
    expect(fhirSyncService.mapSexFromFhirGender('unknown')).toBe('N');
    expect(fhirSyncService.mapSexFromFhirGender(undefined)).toBe('N');
  });

  it('maps FHIR sample status back to legacy status', () => {
    expect(fhirSyncService.mapSampleStatusFromFhir('available')).toBe('Available');
    expect(fhirSyncService.mapSampleStatusFromFhir('unavailable')).toBe('PartiallyWithdrawn');
    expect(fhirSyncService.mapSampleStatusFromFhir('unsatisfactory')).toBe('Unusable');
    expect(fhirSyncService.mapSampleStatusFromFhir('entered-in-error')).toBe('Available');
    expect(fhirSyncService.mapSampleStatusFromFhir(undefined)).toBe('Available');
  });

  it('maps FHIR consent status back to legacy status', () => {
    expect(fhirSyncService.mapConsentStatusFromFhir('active')).toBe('ACTIVE');
    expect(fhirSyncService.mapConsentStatusFromFhir('inactive')).toBe('REVOKED');
    expect(fhirSyncService.mapConsentStatusFromFhir('draft')).toBe('DRAFT');
    expect(fhirSyncService.mapConsentStatusFromFhir(undefined)).toBe('DRAFT');
  });
});

describe('FhirSyncService.isFhirReadPrimary / canReadCollection', () => {
  const originalMode = env.FHIR_READ_MODE;

  afterEach(() => {
    env.FHIR_READ_MODE = originalMode;
  });

  it('returns true when FHIR_READ_MODE is fhir-first (default)', () => {
    env.FHIR_READ_MODE = 'fhir-first';
    expect(fhirSyncService.isFhirReadPrimary()).toBe(true);
  });

  it('returns false when FHIR_READ_MODE is something else', () => {
    env.FHIR_READ_MODE = 'legacy-first';
    expect(fhirSyncService.isFhirReadPrimary()).toBe(false);
  });

  it('canReadCollection returns false immediately when not fhir-first', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(false);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('canReadCollection returns false when collection lacks findOne', async () => {
    env.FHIR_READ_MODE = 'fhir-first';
    const db = { collection: vi.fn().mockReturnValue({}) };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(false);
  });

  it('canReadCollection returns true when estimatedDocumentCount is unavailable but findOne exists', async () => {
    env.FHIR_READ_MODE = 'fhir-first';
    const db = { collection: vi.fn().mockReturnValue({ findOne: vi.fn() }) };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(true);
  });

  it('canReadCollection returns true when document count is > 0', async () => {
    env.FHIR_READ_MODE = 'fhir-first';
    const db = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn(),
        estimatedDocumentCount: vi.fn().mockResolvedValue(5)
      })
    };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(true);
  });

  it('canReadCollection returns false when document count is 0', async () => {
    env.FHIR_READ_MODE = 'fhir-first';
    const db = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn(),
        estimatedDocumentCount: vi.fn().mockResolvedValue(0)
      })
    };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(false);
  });

  it('canReadCollection returns false and swallows errors thrown while checking', async () => {
    env.FHIR_READ_MODE = 'fhir-first';
    const db = {
      collection: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      })
    };
    const result = await fhirSyncService.canReadCollection(db, 'patients_fhir');
    expect(result).toBe(false);
  });
});

describe('FhirSyncService.mapPatientFhirToLegacy', () => {
  it('returns null for null doc', () => {
    expect(fhirSyncService.mapPatientFhirToLegacy(null)).toBeNull();
  });

  it('maps a full FHIR patient document to legacy shape', () => {
    const doc = {
      _id: 'abc123',
      patientID: '12345678',
      name: [{ text: null, given: ['Maria', 'Silva'], family: 'Santos' }],
      telecom: [
        { system: 'phone', value: '555-1234' },
        { system: 'email', value: 'maria@example.com' }
      ],
      gender: 'female',
      birthDate: '1990-01-01',
      recordNumber: 'RN1',
      unitAcronym: 'UN1',
      clinicalUnit: 'Cardiology',
      clinicalProfile: {
        diagnosticHypothesis: 'Hypertension',
        icdCode: 'I10',
        hypertension: true,
        obesity: false,
        geneticVariant: 'BRCA1',
        alphaGal: 1,
        lysoGb3: 2
      },
      active: true,
      createdAt: 'c',
      updatedAt: 'u'
    };

    const legacy = fhirSyncService.mapPatientFhirToLegacy(doc);
    expect(legacy.patientID).toBe('12345678');
    expect(legacy.patientName).toBe('Maria Silva Santos');
    expect(legacy.email).toBe('maria@example.com');
    expect(legacy.phone).toBe('555-1234');
    expect(legacy.sex).toBe('F');
    expect(legacy.diagnosticHypothesis).toBe('Hypertension');
    expect(legacy.hypertension).toBe(true);
    expect(legacy.obesity).toBe(false);
    expect(legacy.status).toBe('ACTIVE');
  });

  it('falls back to "Paciente" when no name is present', () => {
    const doc = { _id: '1', patientID: '11112222', active: false };
    const legacy = fhirSyncService.mapPatientFhirToLegacy(doc);
    expect(legacy.patientName).toBe('Paciente');
    expect(legacy.status).toBe('INACTIVE');
    expect(legacy.email).toBeNull();
    expect(legacy.phone).toBeNull();
  });

  it('uses name.text verbatim when present, ignoring given/family', () => {
    const doc = {
      _id: '1',
      patientID: '11112222',
      name: [{ text: 'Custom Full Name', given: ['A'], family: 'B' }]
    };
    const legacy = fhirSyncService.mapPatientFhirToLegacy(doc);
    expect(legacy.patientName).toBe('Custom Full Name');
  });
});

describe('FhirSyncService.mapSampleFhirToLegacy', () => {
  it('returns null for null doc', () => {
    expect(fhirSyncService.mapSampleFhirToLegacy(null)).toBeNull();
  });

  it('maps a full FHIR sample document, normalizing a valid ObjectId mongoSampleId', () => {
    const validObjectId = '507f1f77bcf86cd799439011';
    const doc = {
      _id: 'unrelated',
      sampleID: 'S001',
      identifier: [{ value: 'ID001' }],
      patientID: '12345678',
      type: { text: 'Blood', coding: [{ display: 'Blood display', code: 'BLD' }] },
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 1,
      quantity: { value: 10, unit: 'mL' },
      barcode: 'BC001',
      receivedTime: '2024-01-01',
      status: 'available',
      semanticPointers: { mongoSampleId: validObjectId },
      storageSnapshot: { boxId: 'BOX1', position: 'A1' },
      createdAt: 'c',
      updatedAt: 'u'
    };

    const legacy = fhirSyncService.mapSampleFhirToLegacy(doc);
    expect(legacy._id.toString()).toBe(validObjectId);
    expect(legacy.sampleID).toBe('S001');
    expect(legacy.sampleType).toBe('Blood');
    expect(legacy.currentStatus).toBe('Available');
    expect(legacy.unit).toBe('mL');
    expect(legacy.storageLocation).toEqual({ boxId: 'BOX1', position: 'A1' });
  });

  it('falls back to doc._id when semanticPointers.mongoSampleId is absent', () => {
    const doc = {
      _id: 'fallback-id',
      patientID: '12345678',
      type: {},
      quantity: {},
      status: 'unavailable'
    };
    const legacy = fhirSyncService.mapSampleFhirToLegacy(doc);
    expect(legacy._id).toBe('fallback-id');
    expect(legacy.unit).toBe('µL');
    expect(legacy.currentStatus).toBe('PartiallyWithdrawn');
    expect(legacy.storageLocation).toEqual({ boxId: null, position: null });
  });

  it('uses identifier[0].value as sampleID/barcode fallback when sampleID/barcode absent', () => {
    const doc = {
      _id: 'x',
      identifier: [{ value: 'IDFALLBACK' }],
      patientID: '12345678',
      type: {},
      quantity: {}
    };
    const legacy = fhirSyncService.mapSampleFhirToLegacy(doc);
    expect(legacy.sampleID).toBe('IDFALLBACK');
    expect(legacy.barcode).toBe('IDFALLBACK');
  });
});

describe('FhirSyncService.mapConsentFhirToLegacy', () => {
  it('returns null for null doc', () => {
    expect(fhirSyncService.mapConsentFhirToLegacy(null)).toBeNull();
  });

  it('maps a full FHIR consent document to legacy shape', () => {
    const doc = {
      _id: 'fallback',
      semanticPointers: { mongoConsentId: 'consent-mongo-id' },
      patientId: '12345678',
      templateId: 'tmpl1',
      status: 'active',
      dateTime: '2024-01-01',
      revokedAt: null,
      responses: { q1: 'yes' },
      createdAt: 'c',
      updatedAt: 'u'
    };
    const legacy = fhirSyncService.mapConsentFhirToLegacy(doc);
    expect(legacy._id).toBe('consent-mongo-id');
    expect(legacy.status).toBe('ACTIVE');
    expect(legacy.signedAt).toBe('2024-01-01');
    expect(legacy.responses).toEqual({ q1: 'yes' });
  });

  it('falls back to doc._id when semanticPointers is absent, defaults responses to {}', () => {
    const doc = { _id: 'raw-id', patientId: '1', templateId: 't', status: 'inactive' };
    const legacy = fhirSyncService.mapConsentFhirToLegacy(doc);
    expect(legacy._id).toBe('raw-id');
    expect(legacy.status).toBe('REVOKED');
    expect(legacy.responses).toEqual({});
    expect(legacy.revokedAt).toBeNull();
  });
});

describe('FhirSyncService.getPatientFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.getPatientFhirFirst(db, '12345678');
    expect(result).toBeNull();
  });

  it('returns null for a patientID that does not match the 8-digit format', async () => {
    const findOne = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getPatientFhirFirst(db, 'not-an-id');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('queries patients_fhir and maps the result on a valid 8-digit patientID', async () => {
    const doc = { _id: '1', patientID: '12345678', active: true };
    const findOne = vi.fn().mockResolvedValue(doc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getPatientFhirFirst(db, '12345678');
    expect(findOne).toHaveBeenCalledWith({ patientID: '12345678' });
    expect(result.patientID).toBe('12345678');
    expect(result.status).toBe('ACTIVE');
  });

  it('returns null when the underlying findOne throws', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getPatientFhirFirst(db, '12345678');
    expect(result).toBeNull();
  });
});

describe('FhirSyncService.listPatientsFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.listPatientsFhirFirst(db, {});
    expect(result).toBeNull();
  });

  it('builds query from filters, applies default limit/skip, and maps results', async () => {
    const docs = [{ _id: '1', patientID: '12345678', active: true }];
    const find = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const skip = vi.fn().mockReturnThis();
    const toArray = vi.fn().mockResolvedValue(docs);
    const countDocuments = vi.fn().mockResolvedValue(1);
    const collection = { find, limit, skip, toArray, countDocuments, findOne: vi.fn() };
    find.mockReturnValue(collection);
    limit.mockReturnValue(collection);
    skip.mockReturnValue(collection);
    const db = { collection: vi.fn().mockReturnValue(collection) };

    const result = await fhirSyncService.listPatientsFhirFirst(db, {
      patientName: 'Maria',
      clinicalUnit: 'Cardiology'
    });

    expect(find).toHaveBeenCalledWith({
      'name.text': { $regex: 'Maria', $options: 'i' },
      clinicalUnit: 'Cardiology'
    });
    expect(limit).toHaveBeenCalledWith(50);
    expect(skip).toHaveBeenCalledWith(0);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.skip).toBe(0);
    expect(result.patients[0].patientID).toBe('12345678');
  });

  it('honors provided limit/skip filters', async () => {
    const collection = {
      find: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      countDocuments: vi.fn().mockResolvedValue(0),
      findOne: vi.fn()
    };
    const db = { collection: vi.fn().mockReturnValue(collection) };

    await fhirSyncService.listPatientsFhirFirst(db, { limit: 5, skip: 10 });

    expect(collection.limit).toHaveBeenCalledWith(5);
    expect(collection.skip).toHaveBeenCalledWith(10);
  });
});

describe('FhirSyncService.searchPatientsFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.searchPatientsFhirFirst(db, 'term');
    expect(result).toBeNull();
  });

  it('returns empty result for a blank/whitespace search term', async () => {
    const db = { collection: vi.fn().mockReturnValue({ findOne: vi.fn() }) };
    expect(await fhirSyncService.searchPatientsFhirFirst(db, '   ')).toEqual({ patients: [], total: 0 });
    expect(await fhirSyncService.searchPatientsFhirFirst(db, undefined)).toEqual({ patients: [], total: 0 });
  });

  it('adds a patientID exact-match clause when the term is 8 digits', async () => {
    const find = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const toArray = vi.fn().mockResolvedValue([]);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const collection = { find, limit, toArray, countDocuments, findOne: vi.fn() };
    const db = { collection: vi.fn().mockReturnValue(collection) };

    await fhirSyncService.searchPatientsFhirFirst(db, '12345678');

    const query = find.mock.calls[0][0];
    expect(query.$or[0]).toEqual({ patientID: '12345678' });
  });

  it('maps and returns matching patients for a non-numeric term', async () => {
    const docs = [{ _id: '1', patientID: '12345678' }];
    const collection = {
      find: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
      countDocuments: vi.fn().mockResolvedValue(1),
      findOne: vi.fn()
    };
    const db = { collection: vi.fn().mockReturnValue(collection) };

    const result = await fhirSyncService.searchPatientsFhirFirst(db, 'Cardiology');

    expect(result.total).toBe(1);
    expect(result.patients[0].patientID).toBe('12345678');
    expect(collection.limit).toHaveBeenCalledWith(50);
  });
});

describe('FhirSyncService.getSampleFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.getSampleFhirFirst(db, 'S001');
    expect(result).toBeNull();
  });

  it('queries by mongoSampleId or sampleID string and maps the result', async () => {
    const doc = { _id: '1', sampleID: 'S001', patientID: '12345678', type: {}, quantity: {} };
    const findOne = vi.fn().mockResolvedValue(doc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };

    const result = await fhirSyncService.getSampleFhirFirst(db, 'S001');

    expect(findOne).toHaveBeenCalledWith({
      $or: [
        { 'semanticPointers.mongoSampleId': 'S001' },
        { sampleID: 'S001' }
      ]
    });
    expect(result.sampleID).toBe('S001');
  });

  it('coerces a non-string sampleID via toString()', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const sampleIdObj = { toString: () => 'coerced-id' };

    await fhirSyncService.getSampleFhirFirst(db, sampleIdObj);

    expect(findOne).toHaveBeenCalledWith({
      $or: [
        { 'semanticPointers.mongoSampleId': 'coerced-id' },
        { sampleID: 'coerced-id' }
      ]
    });
  });

  it('returns null when findOne throws', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getSampleFhirFirst(db, 'S001');
    expect(result).toBeNull();
  });
});

describe('FhirSyncService.getSampleByBarcodeFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, 'BC001');
    expect(result).toBeNull();
  });

  it('returns null for a blank barcode without querying', async () => {
    const findOne = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, '   ');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns the sample found on the first exact-match query', async () => {
    const doc = { _id: '1', patientID: '12345678', type: {}, quantity: {} };
    const findOne = vi.fn().mockResolvedValue(doc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };

    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, 'BC001');

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('falls back to the uppercase-variant query when the exact match misses', async () => {
    const doc = { _id: '2', patientID: '12345678', type: {}, quantity: {} };
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(doc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };

    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, 'bc001');

    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne.mock.calls[1][0]).toEqual({
      $or: [
        { barcode: 'BC001' },
        { sampleID: 'BC001' },
        { barcode: 'bc001' },
        { sampleID: 'bc001' }
      ]
    });
    expect(result).not.toBeNull();
  });

  it('falls back to a case-insensitive regex query when both prior queries miss', async () => {
    const doc = { _id: '3', patientID: '12345678', type: {}, quantity: {} };
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(doc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };

    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, 'bc.001');

    expect(findOne).toHaveBeenCalledTimes(3);
    const regexQuery = findOne.mock.calls[2][0];
    expect(regexQuery.$or[0].barcode.$regex.source).toBe('^bc\\.001$');
    expect(result).not.toBeNull();
  });

  it('returns null and swallows errors thrown while querying', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const result = await fhirSyncService.getSampleByBarcodeFhirFirst(db, 'BC001');
    expect(result).toBeNull();
  });
});

describe('FhirSyncService.listSamplesFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.listSamplesFhirFirst(db, {});
    expect(result).toBeNull();
  });

  it('builds query from filters (mapping currentStatus to FHIR status) and maps results', async () => {
    const docs = [{ _id: '1', patientID: '12345678', type: {}, quantity: {} }];
    const find = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const skip = vi.fn().mockReturnThis();
    const toArray = vi.fn().mockResolvedValue(docs);
    const countDocuments = vi.fn().mockResolvedValue(1);
    const collection = { find, limit, skip, toArray, countDocuments, findOne: vi.fn() };
    const db = { collection: vi.fn().mockReturnValue(collection) };

    const result = await fhirSyncService.listSamplesFhirFirst(db, {
      patientID: '12345678',
      currentStatus: 'Available',
      sampleType: 'Blood'
    });

    expect(find).toHaveBeenCalledWith({
      patientID: '12345678',
      status: 'available',
      'type.text': 'Blood'
    });
    expect(limit).toHaveBeenCalledWith(50);
    expect(skip).toHaveBeenCalledWith(0);
    expect(result.total).toBe(1);
    expect(result.samples).toHaveLength(1);
  });

  it('honors provided limit/skip filters', async () => {
    const collection = {
      find: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      countDocuments: vi.fn().mockResolvedValue(0),
      findOne: vi.fn()
    };
    const db = { collection: vi.fn().mockReturnValue(collection) };

    await fhirSyncService.listSamplesFhirFirst(db, { limit: 5, skip: 10 });

    expect(collection.limit).toHaveBeenCalledWith(5);
    expect(collection.skip).toHaveBeenCalledWith(10);
  });
});

describe('FhirSyncService.getPatientConsentFhirFirst', () => {
  const originalMode = env.FHIR_READ_MODE;
  beforeEach(() => { env.FHIR_READ_MODE = 'fhir-first'; });
  afterEach(() => { env.FHIR_READ_MODE = originalMode; });

  it('returns null when canReadCollection is false', async () => {
    env.FHIR_READ_MODE = 'legacy-first';
    const db = { collection: vi.fn() };
    const result = await fhirSyncService.getPatientConsentFhirFirst(db, '12345678');
    expect(result).toBeNull();
  });

  it('queries the most recent consent by patientId, sorted, and maps it', async () => {
    const doc = { _id: 'c1', patientId: '12345678', templateId: 't1', status: 'active' };
    const sort = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const toArray = vi.fn().mockResolvedValue([doc]);
    const find = vi.fn().mockReturnValue({ sort, limit, toArray });
    const db = { collection: vi.fn().mockReturnValue({ find, findOne: vi.fn() }) };

    const result = await fhirSyncService.getPatientConsentFhirFirst(db, '12345678');

    expect(find).toHaveBeenCalledWith({ patientId: '12345678' });
    expect(sort).toHaveBeenCalledWith({ dateTime: -1, createdAt: -1 });
    expect(limit).toHaveBeenCalledWith(1);
    expect(result.status).toBe('ACTIVE');
  });

  it('returns null when no consent is found', async () => {
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([])
    });
    const db = { collection: vi.fn().mockReturnValue({ find, findOne: vi.fn() }) };

    const result = await fhirSyncService.getPatientConsentFhirFirst(db, '12345678');
    expect(result).toBeNull();
  });

  it('returns null and swallows errors thrown while querying', async () => {
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockRejectedValue(new Error('db down'))
    });
    const db = { collection: vi.fn().mockReturnValue({ find, findOne: vi.fn() }) };

    const result = await fhirSyncService.getPatientConsentFhirFirst(db, '12345678');
    expect(result).toBeNull();
  });
});

describe('FhirSyncService.buildPatientFhirPayload', () => {
  it('splits a multi-word name into given/family and builds telecom entries', () => {
    const payload = fhirSyncService.buildPatientFhirPayload({
      patientName: 'Maria Silva Santos',
      patientID: '12345678',
      email: 'maria@example.com',
      phone: '5551234',
      sex: 'F',
      status: 'ACTIVE',
      birthDate: '1990-01-01'
    });

    expect(payload.resourceType).toBe('Patient');
    expect(payload.name[0].family).toBe('Santos');
    expect(payload.name[0].given).toEqual(['Maria', 'Silva']);
    expect(payload.telecom).toEqual([
      { system: 'email', value: 'maria@example.com', use: 'home' },
      { system: 'phone', value: '5551234', use: 'mobile' }
    ]);
    expect(payload.active).toBe(true);
    expect(payload.gender).toBe('female');
  });

  it('treats a single-word name as both given and family', () => {
    const payload = fhirSyncService.buildPatientFhirPayload({
      patientName: 'Cher',
      patientID: '12345678'
    });
    expect(payload.name[0].family).toBe('Cher');
    expect(payload.name[0].given).toEqual(['Cher']);
  });

  it('marks inactive when status is INACTIVE and defaults birthDate when absent', () => {
    const payload = fhirSyncService.buildPatientFhirPayload({
      patientName: 'John Doe',
      patientID: '12345678',
      status: 'INACTIVE'
    });
    expect(payload.active).toBe(false);
    expect(payload.birthDate.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('omits telecom entries when email/phone are absent', () => {
    const payload = fhirSyncService.buildPatientFhirPayload({
      patientName: 'John Doe',
      patientID: '12345678'
    });
    expect(payload.telecom).toEqual([]);
  });
});

describe('FhirSyncService.buildSampleFhirPayload', () => {
  it('builds a Specimen payload with normalized quality/quantity and semantic pointers', () => {
    const sample = {
      _id: '507f1f77bcf86cd799439011',
      sampleID: 'S001',
      barcode: 'BC001',
      patientID: '12345678',
      sampleType: 'Blood',
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 'GOOD',
      quantity: '15',
      unit: 'mL',
      currentStatus: 'Available',
      registrationDate: '2024-01-01',
      storageLocation: { boxId: 'BOX1', position: 'A1' }
    };

    const payload = fhirSyncService.buildSampleFhirPayload(sample);
    expect(payload.resourceType).toBe('Specimen');
    expect(payload.quality).toBe(1);
    expect(payload.quantity.value).toBe(15);
    expect(payload.status).toBe('available');
    expect(payload.semanticPointers.mongoSampleId).toBe('507f1f77bcf86cd799439011');
    expect(payload.semanticPointers.neo4jSamplePointer).toBe('mongo://samples_fhir/507f1f77bcf86cd799439011');
  });

  it('defaults quality to 0 and quantity to 0 for unrecognized/non-numeric input', () => {
    const sample = {
      _id: 'x',
      patientID: '12345678',
      sampleType: 'Blood',
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 'BOGUS',
      quantity: 'not-a-number'
    };
    const payload = fhirSyncService.buildSampleFhirPayload(sample);
    expect(payload.quality).toBe(0);
    expect(payload.quantity.value).toBe(0);
  });

  it('falls back to _id as sampleId/barcode when sampleID/barcode are absent', () => {
    const sample = {
      _id: 'genid',
      patientID: '12345678',
      sampleType: 'Blood',
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 0,
      quantity: 1
    };
    const payload = fhirSyncService.buildSampleFhirPayload(sample);
    expect(payload.sampleID).toBeNull();
    expect(payload.barcode).toBe('genid');
  });
});

describe('FhirSyncService.buildConsentFhirPayload', () => {
  it('builds a permit provision for ACTIVE consent', () => {
    const consent = {
      _id: 'consentId1',
      patientId: '12345678',
      templateId: 'tmpl1',
      status: 'ACTIVE',
      signedAt: '2024-01-01',
      responses: { q1: 'yes' }
    };
    const payload = fhirSyncService.buildConsentFhirPayload(consent);
    expect(payload.resourceType).toBe('Consent');
    expect(payload.status).toBe('active');
    expect(payload.provision.type).toBe('permit');
    expect(payload.provision.period.end).toBeNull();
    expect(payload.semanticPointers.mongoConsentId).toBe('consentId1');
  });

  it('builds a deny provision and sets the revocation end date for REVOKED consent', () => {
    const consent = {
      _id: 'consentId2',
      patientId: '12345678',
      templateId: 'tmpl1',
      status: 'REVOKED',
      signedAt: '2024-01-01',
      revokedAt: '2024-06-01'
    };
    const payload = fhirSyncService.buildConsentFhirPayload(consent);
    expect(payload.status).toBe('inactive');
    expect(payload.provision.type).toBe('deny');
    expect(payload.provision.period.end.toISOString()).toBe(new Date('2024-06-01').toISOString());
  });
});

describe('FhirSyncService.upsertPatientFromLegacy / upsertSampleFromLegacy / upsertConsentFromLegacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts a valid patient into patients_fhir', async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
    const patient = {
      patientID: '12345678',
      patientName: 'Maria Silva',
      sex: 'F',
      status: 'ACTIVE'
    };

    await fhirSyncService.upsertPatientFromLegacy(db, patient);

    expect(db.collection).toHaveBeenCalledWith('patients_fhir');
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ patientID: '12345678' });
    expect(update.$set.patientID).toBe('12345678');
    expect(options).toEqual({ upsert: true });
  });

  it('logs a warning and does not throw when the patient payload fails schema validation', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const updateOne = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

    // Missing patientID entirely produces an invalid FHIR identifier value ("undefined")
    // but more importantly an empty name/family combination triggers schema validation
    // failure via missing required subject/type fields is exercised in sample; for patient
    // we force a validation error by supplying a non-string sex/patientID edge case that
    // still passes buildPatientFhirPayload but fails Mongoose validation (invalid patientID).
    const patient = { patientID: undefined, patientName: 'No Id' };

    await expect(fhirSyncService.upsertPatientFromLegacy(db, patient)).resolves.toBeUndefined();

    expect(updateOne).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[FHIR_SYNC] Falha ao sincronizar PatientFHIR:',
      expect.anything()
    );
  });

  it('upserts a valid sample into samples_fhir', async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
    const sample = {
      _id: '507f1f77bcf86cd799439011',
      patientID: '12345678',
      sampleType: 'Blood',
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 1,
      quantity: 5
    };

    await fhirSyncService.upsertSampleFromLegacy(db, sample);

    expect(db.collection).toHaveBeenCalledWith('samples_fhir');
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, , options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ 'semanticPointers.mongoSampleId': '507f1f77bcf86cd799439011' });
    expect(options).toEqual({ upsert: true });
  });

  it('logs a warning and does not throw when the sample payload fails schema validation', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const updateOne = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ updateOne }) };

    // patientID does not match the required 8-digit pattern -> Mongoose validation error
    const sample = {
      _id: 'x',
      patientID: 'bad-id',
      sampleType: 'Blood',
      sampleOrigin: 'Vein',
      extractionProtocol: 'ProtoA',
      linkedProject: 'ProjX',
      quality: 1,
      quantity: 5
    };

    await expect(fhirSyncService.upsertSampleFromLegacy(db, sample)).resolves.toBeUndefined();

    expect(updateOne).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[FHIR_SYNC] Falha ao sincronizar SampleFHIR:',
      expect.anything()
    );
  });

  it('upserts a valid consent into consents_fhir', async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
    const consent = {
      _id: 'consentId1',
      patientId: '12345678',
      templateId: 'tmpl1',
      status: 'ACTIVE'
    };

    await fhirSyncService.upsertConsentFromLegacy(db, consent);

    expect(db.collection).toHaveBeenCalledWith('consents_fhir');
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, , options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ 'semanticPointers.mongoConsentId': 'consentId1' });
    expect(options).toEqual({ upsert: true });
  });
});

describe('FhirSyncService.syncAllLegacyData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeCursor(items) {
    let index = 0;
    return {
      limit: vi.fn().mockReturnThis(),
      hasNext: vi.fn().mockImplementation(async () => index < items.length),
      next: vi.fn().mockImplementation(async () => items[index++])
    };
  }

  it('iterates patients, samples and consents, upserting each and returning summary counts', async () => {
    const patients = [{ _id: '1', patientID: '12345678', patientName: 'A' }];
    const samples = [{
      _id: '507f1f77bcf86cd799439011', patientID: '12345678', sampleType: 'Blood',
      sampleOrigin: 'Vein', extractionProtocol: 'P', linkedProject: 'Proj', quality: 1, quantity: 5
    }];
    const consents = [{ _id: 'c1', patientId: '12345678', templateId: 't1', status: 'ACTIVE' }];

    const patientsFind = makeCursor(patients);
    const samplesFind = makeCursor(samples);
    const consentsFind = makeCursor(consents);

    const collections = {
      patients: { find: vi.fn().mockReturnValue(patientsFind), updateOne: vi.fn().mockResolvedValue({}), estimatedDocumentCount: vi.fn().mockResolvedValue(1) },
      samples: { find: vi.fn().mockReturnValue(samplesFind), updateOne: vi.fn().mockResolvedValue({}), estimatedDocumentCount: vi.fn().mockResolvedValue(1) },
      patientConsents: { find: vi.fn().mockReturnValue(consentsFind), updateOne: vi.fn().mockResolvedValue({}), estimatedDocumentCount: vi.fn().mockResolvedValue(1) },
      patients_fhir: { updateOne: vi.fn().mockResolvedValue({}) },
      samples_fhir: { updateOne: vi.fn().mockResolvedValue({}) },
      consents_fhir: { updateOne: vi.fn().mockResolvedValue({}) }
    };

    const db = {
      collection: vi.fn().mockImplementation((name) => collections[name]),
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: 'patients' }, { name: 'samples' }, { name: 'patientConsents' }
        ])
      })
    };

    const summary = await fhirSyncService.syncAllLegacyData(db, {});

    expect(summary).toEqual({ patients: 1, samples: 1, consents: 1 });
    expect(collections.patients_fhir.updateOne).toHaveBeenCalledTimes(1);
    expect(collections.samples_fhir.updateOne).toHaveBeenCalledTimes(1);
    expect(collections.consents_fhir.updateOne).toHaveBeenCalledTimes(1);
  });

  it('applies the provided limit to each cursor', async () => {
    const patientsFind = makeCursor([]);
    const samplesFind = makeCursor([]);
    const consentsFind = makeCursor([]);

    const collections = {
      patients: { find: vi.fn().mockReturnValue(patientsFind), estimatedDocumentCount: vi.fn().mockResolvedValue(1) },
      samples: { find: vi.fn().mockReturnValue(samplesFind), estimatedDocumentCount: vi.fn().mockResolvedValue(1) },
      patientConsents: { find: vi.fn().mockReturnValue(consentsFind), estimatedDocumentCount: vi.fn().mockResolvedValue(1) }
    };

    const db = {
      collection: vi.fn().mockImplementation((name) => collections[name]),
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: 'patients' }, { name: 'samples' }, { name: 'patientConsents' }
        ])
      })
    };

    const summary = await fhirSyncService.syncAllLegacyData(db, { limit: 10 });

    expect(summary).toEqual({ patients: 0, samples: 0, consents: 0 });
    expect(patientsFind.limit).toHaveBeenCalledWith(10);
    expect(samplesFind.limit).toHaveBeenCalledWith(10);
    expect(consentsFind.limit).toHaveBeenCalledWith(10);
  });
});
