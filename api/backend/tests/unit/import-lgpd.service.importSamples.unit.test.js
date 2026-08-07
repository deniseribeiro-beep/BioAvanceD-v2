import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// ImportLGPDService.importSamples — DB-backed method, previously untested
// at the service level (only mocked out in the controller test suite).
//
// patientIdentityService/qualityDomain are required as module objects (not
// destructured), so vi.spyOn on the real singletons works normally.
// DrugService/SampleGraphValidator are constructed with `new`, so they're
// vi.mock'd as minimal classes. generateSampleHash is destructured at
// module scope in import-lgpd.service.js, so it must be vi.mock'd too (see
// testing-conventions' note on destructured imports defeating vi.spyOn).
// ──────────────────────────────────────────────────────────

vi.mock('../../src/services/DrugService', () => ({
  default: class DrugService {
    async searchAndCacheDrug() {
      return [];
    }
  },
}));
vi.mock('../../src/services/SampleGraphValidator', () => ({
  default: class SampleGraphValidator {
    async validateSampleCompliance() {
      return { ok: true };
    }
  },
}));
vi.mock('../../src/services/MerkleService', () => ({ generateSampleHash: vi.fn(() => 'hash-1') }));

const service = require('../../src/services/import-lgpd.service');
const patientIdentityService = require('../../src/services/PatientIdentityService');
const qualityDomain = require('../../src/services/quality-domain.service');
const DrugService = require('../../src/services/DrugService');

const MATCHED_PATIENT = {
  patient: { _id: 'patient-obj-1', participantId: '12345678', patientName: 'Maria Silva' },
};

const VALID_ROW = {
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  participantId: '12345678',
  quantity: '5',
  quality: 'GOOD',
  linkedProject: 'Proj1',
  tcle_id: 'tcle-1',
  sprec_sample_type: 'ST1',
  sprec_primary_container: 'PC1',
};

// Mirrors the real driver closely enough to prove AllocateSampleUseCase's
// withTransaction wiring (#477, same pattern sample.service.test.js's #474
// coverage uses): withTransaction just runs the handler, same as the real
// session aborting uncommitted on a thrown error.
function makeSession() {
  return {
    withTransaction: vi.fn(async (handler) => handler()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb({ sampleTypeFound = true, sampleOriginFound = true, protocolFound = true, existingBarcode = null } = {}) {
  // Stateful enough for AllocateSampleUseCase's post-insert
  // findSampleById(insertedId) lookup to resolve the row it just inserted.
  let insertedSample = null;
  const samplesCollection = {
    insertOne: vi.fn().mockImplementation((doc) => {
      insertedSample = { _id: 'sample-id-1', ...doc };
      return Promise.resolve({ insertedId: 'sample-id-1' });
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    // Backs the barcode-duplicate check, generateUniqueSpecimenId's own
    // collision check (`{ specimenId }`), and AllocateSampleUseCase's
    // findSampleById(insertedId) lookup (`{ _id }`).
    findOne: vi.fn().mockImplementation((query) => {
      if (query && Object.prototype.hasOwnProperty.call(query, 'specimenId')) {
        return Promise.resolve(null);
      }
      if (query && Object.prototype.hasOwnProperty.call(query, '_id')) {
        return Promise.resolve(insertedSample);
      }
      return Promise.resolve(existingBarcode);
    }),
  };
  const patientsCollection = {
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const sampleTypesCollection = { findOne: vi.fn().mockResolvedValue(sampleTypeFound ? { description: 'PLASMA' } : null) };
  const sampleOriginsCollection = { findOne: vi.fn().mockResolvedValue(sampleOriginFound ? { description: 'VENOUS_BLOOD' } : null) };
  const extractionProtocolsCollection = { findOne: vi.fn().mockResolvedValue(protocolFound ? { description: 'TUBE_EDTA' } : null) };
  const amostrasCollection = {
    // Backs generateUniqueBarcode's own lookup for the last barcode of the year.
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
    findOne: vi.fn().mockResolvedValue(null),
  };
  // AllocateSampleUseCase's audit trail (MongoAuditRepository) and
  // storagePaths hierarchy lookup (MongoStorageRepository.openStorageAssignment).
  const sampleMovementsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-1' }),
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [], next: async () => null }) }) })),
    createIndex: vi.fn().mockResolvedValue(true),
  };
  const countersCollection = {
    findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
  };
  const storagePathsCollection = {
    findOne: vi.fn().mockResolvedValue(null),
  };
  const rcsAssessmentsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'assessment-1' }),
  };

  const collections = {
    samples: samplesCollection,
    patients: patientsCollection,
    sampleTypes: sampleTypesCollection,
    sampleOrigins: sampleOriginsCollection,
    extractionProtocols: extractionProtocolsCollection,
    amostras: amostrasCollection,
    sample_movements: sampleMovementsCollection,
    counters: countersCollection,
    storagePaths: storagePathsCollection,
    rcsAssessments: rcsAssessmentsCollection,
  };

  const session = makeSession();
  const db = {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        throw new Error(`unexpected collection requested: ${name}`);
      }
      return collections[name];
    }),
    client: {
      startSession: vi.fn(() => session),
    },
  };

  return { db, samplesCollection, patientsCollection, rcsAssessmentsCollection };
}

describe('ImportLGPDService.importSamples', () => {
  let db;
  let samplesCollection;
  let patientsCollection;
  let rcsAssessmentsCollection;

  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection } = makeDb());

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      category: 'A',
      score: 90,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when required sample fields are missing from the headers', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ sampleOrigin: 'VENOUS_BLOOD', participantId: '12345678' }]);
    await expect(
      service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow(/Campos obrigatórios ausentes/);
  });

  it('throws when there is no patient-identification column at all', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD' }]);
    await expect(
      service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow(/Identificação do paciente ausente/);
  });

  it('records a per-row error when patient identity resolution comes back empty', async () => {
    patientIdentityService.matchOrUpsertParticipant.mockResolvedValue({ patient: null });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/identidade do paciente/);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a per-row error when the resolved patientID is not exactly 8 digits', async () => {
    patientIdentityService.matchOrUpsertParticipant.mockResolvedValue({
      patient: { _id: 'p1', participantId: '123', patientName: 'X' },
    });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/8 dígitos numéricos/);
  });

  it('records a per-row error for a malformed atc_code', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/atcCode inválido/);
  });

  // Regression coverage for issue #84: `SampleModel` here must resolve to the
  // hand-written validator class (`require('../models/Sample').SampleModel`),
  // not the mongoose Model (the default export of that same module). Before
  // the fix, `SampleModel.validate(sampleData)` invoked mongoose's own async
  // static `Model.validate`, which returns a Promise — so every row was
  // rejected regardless of actual validity and `validation.errors` was
  // always `undefined`.
  // Pinned to current behavior, not desired behavior: parseQualityMIABIS
  // silently maps an unrecognized value to null, and SampleModel.validate()
  // doesn't require `quality` at all, so the row imports successfully
  // instead of being rejected. Whether `quality` should be required is the
  // same Sample.validate/create design gap tracked in #224 — revisit this
  // assertion once that design call resolves.
  it('accepts an unrecognized quality value: parseQualityMIABIS silently maps it to null, and SampleModel.validate does not require quality (tracked in #224)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, quality: 'BOGUS' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('imports a row with otherwise-valid data, running it through the real validator', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('persists externalQualityAssessment (camelCase) on the inserted document when rcsScore/scoreBasedGrade columns are present (#226)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, rcsScore: '100', scoreBasedGrade: 'A' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.external_quality_assessment).toBeUndefined();
    expect(inserted.externalQualityAssessment).toMatchObject({
      score: 100,
      category: 'A',
      source: 'external-lgpd-import',
      canonical: false,
    });
  });

  // #499: import-lgpd's own RCS-computing CSV parse logic never called
  // rcsAssessmentService.recordAssessment — the canonical, referenced
  // RcsAssessment snapshot import.service.js's CSV/XLSX branch already
  // writes. Real-enough proof per the build-loop overlay's backend-internal
  // proof bar: an in-memory collection mock, asserting the actual
  // specimenId/certificationResult shape passed through, not a stub.
  it('records a referenced RcsAssessment snapshot alongside the embedded copy (#499)', async () => {
    qualityDomain.resolveMethodologicalQuality.mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      category: 'A',
      score: 90,
      rcs_score: 87.5,
      score_based_grade: 'A',
      model_version: 'v1',
      matrix_type: 'PLASMA',
      governance_failure_reasons: [],
      governance_rule_codes: [],
      grade_route: 'DIRECT',
      axis_penalties: [],
      calculation_trace: {},
    });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(rcsAssessmentsCollection.insertOne).toHaveBeenCalledTimes(1);
    const recorded = rcsAssessmentsCollection.insertOne.mock.calls[0][0];
    expect(recorded.specimenId).toBe(inserted.specimenId);
    expect(recorded.rcsScore).toBe(87.5);
    expect(recorded.scoreBasedGrade).toBe('A');
  });

  it('does not fail the row import when recording the RcsAssessment snapshot rejects (#499)', async () => {
    qualityDomain.resolveMethodologicalQuality.mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      category: 'A',
      score: 90,
      rcs_score: 87.5,
    });
    const failingRcsAssessments = { insertOne: vi.fn().mockRejectedValue(new Error('mongo down')) };
    const originalCollection = db.collection;
    db.collection = vi.fn((name) => (name === 'rcsAssessments' ? failingRcsAssessments : originalCollection(name)));
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a row whose barcode already exists (the duplicate-barcode check now runs after real validation)', async () => {
    ({ db, samplesCollection } = makeDb({ existingBarcode: { barcode: 'BR-2026-001' } }));
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, barcode: 'BR-2026-001' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(['Já existe uma amostra com o código de barras BR-2026-001']);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('propagates the underlying error (and never reaches the DB) when reading the file fails', async () => {
    vi.spyOn(service, 'readFile').mockRejectedValue(new Error('Arquivo não encontrado'));

    await expect(
      service.importSamples(db, { path: '/missing.csv', originalname: 'missing.csv' })
    ).rejects.toThrow('Arquivo não encontrado');
    expect(db.collection).not.toHaveBeenCalled();
  });

  // The `!validXInDb && !SampleModel.validateX(...)` DB-lookup-miss branches
  // (sampleType/sampleOrigin/extractionProtocol "não encontrado" errors) sit
  // *after* `SampleModel.validate(sampleData)` on line 855, which already
  // requires `validateX` to be true to pass. So by the time this code runs,
  // `!SampleModel.validateX(...)` is always false and the branch can never
  // fire — confirmed empirically: a canonical-but-DB-missing value imports
  // successfully instead of erroring, and a non-canonical value is rejected
  // earlier by `SampleModel.validate` with a different message. Not covering
  // this dead branch; not filing a bug since nothing user-visible is wrong
  // (unreachable, not incorrect).

  it('looks up and applies a drug candidate when treatment is active and only the drug name (not an ATC code) is given', async () => {
    vi.spyOn(DrugService.prototype, 'searchAndCacheDrug').mockResolvedValue([
      { generic_name: 'Paracetamol', atcCode: 'N02BE01', drug_class: 'ANALGESIC' },
    ]);
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatmentStatus: 'TREATED', medicationName: 'Tylenol' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.pharmacologyData).toMatchObject({
      medicationName: 'Paracetamol',
      atcCode: 'N02BE01',
      atcClass: 'ANALGESIC',
      drug_class: 'ANALGESIC',
    });
  });

  it('leaves pharmacologyData as parsed when the drug lookup finds no candidates', async () => {
    vi.spyOn(DrugService.prototype, 'searchAndCacheDrug').mockResolvedValue([]);
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatmentStatus: 'TREATED', medicationName: 'UnknownDrugXYZ' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.pharmacologyData.atcCode).toBeNull();
  });

  it('uses a provided barcode as-is (string-converted) instead of auto-generating one', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, barcode: 'BR-CUSTOM-999' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.barcode).toBe('BR-CUSTOM-999');
  });

  // `tcle_id` on VALID_ROW is not a field parseSampleRow reads (it reads
  // `consentTemplateId`), so every other test in this suite leaves
  // sampleData.consentTemplateId null and already exercises this "missing"
  // branch incidentally. This test makes that explicit and pins the actual
  // updateOne call shape.
  it('flags the sample for QUARANTINE when ethics/SPREC data is missing', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(samplesCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'sample-id-1' },
      { $set: { releaseStatus: 'QUARANTINE', updatedAt: expect.any(Date) } }
    );
  });

  it('does not touch releaseStatus when consentTemplateId and SPREC data are all present', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, consentTemplateId: 'consent-1' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(samplesCollection.updateOne).not.toHaveBeenCalled();
  });

  // #459: replaces the legacy `locations`-collection scan with a
  // FREEZER->SHELF->RACK->StorageBox chain, same hierarchy the #461
  // backfill script materializes and #462/#463/#464 already walk.
  describe('boxId auto-assignment (#459)', () => {
    const { ObjectId } = require('mongodb');

    function makeStorageChain(boxCount = 2) {
      const freezerId = new ObjectId();
      const shelfId = new ObjectId();
      const rackId = new ObjectId();
      const containers = [
        { _id: freezerId, containerType: 'FREEZER', containerID: 42, parent_id: null },
        { _id: shelfId, containerType: 'SHELF', parent_id: freezerId },
        { _id: rackId, containerType: 'RACK', parent_id: shelfId },
      ];
      const boxes = Array.from({ length: boxCount }, (_, i) => ({
        _id: new ObjectId(),
        name: `B${i + 1}`,
        boxID: i + 1,
        parent_id: rackId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0,
        status: 'ACTIVE',
      }));
      return { freezerId, shelfId, rackId, containers, boxes };
    }

    // #467: RF004 gate — a ready equipment (not in a blocked status) with an
    // operational sensor matching `containerID: 42` (the chain's freezer),
    // so existing boxId-assignment tests keep passing without asserting on
    // the gate itself; readiness-specific behavior gets its own tests below.
    function makeDbWithStorageChain(chain, { equipmentStatus = 'active', sensorStatus = 'ok', hasSensor = true } = {}) {
      const base = makeDb();
      const originalCollection = base.db.collection;
      const storageContainersCollection = {
        findOne: vi.fn(async ({ _id }) => chain.containers.find((c) => String(c._id) === String(_id)) || null),
      };
      const storageBoxesCollection = {
        find: vi.fn(() => ({
          sort: () => ({ toArray: async () => [...chain.boxes] }),
        })),
        findOne: vi.fn(async ({ _id }) => chain.boxes.find((b) => String(b._id) === String(_id)) || null),
        // Real-enough occupancyGrid write for AllocateSampleUseCase's
        // atomic reservation (#477) — mutates the shared box object in
        // place (same instance `findOne` returns), so a second row against
        // an already-occupied position genuinely collides (matchedCount 0)
        // instead of silently reusing the same slot like the pre-#477
        // direct-write path did.
        updateOne: vi.fn(async (filter, update) => {
          const target = chain.boxes.find((b) => String(b._id) === String(filter._id));
          if (!target) return { matchedCount: 0, modifiedCount: 0 };
          const positionKey = Object.keys(filter).find((key) => key.startsWith('occupancyGrid.'));
          const position = positionKey ? positionKey.split('.')[1] : null;
          if (position && target.occupancyGrid?.[position]) {
            return { matchedCount: 0, modifiedCount: 0 };
          }
          const setFields = update.$set || {};
          for (const [key, value] of Object.entries(setFields)) {
            if (key.startsWith('occupancyGrid.')) {
              target.occupancyGrid[key.split('.')[1]] = value;
            }
          }
          if (update.$inc?.currentOccupancy) {
            target.currentOccupancy = (target.currentOccupancy || 0) + update.$inc.currentOccupancy;
          }
          return { matchedCount: 1, modifiedCount: 1 };
        }),
      };
      const equipmentCollection = {
        findOne: vi.fn(async () => ({ equipmentID: 42, status: equipmentStatus })),
      };
      const sensorsCollection = {
        find: vi.fn(() => ({
          limit: () => ({
            toArray: async () => (hasSensor ? [{ locationId: 42, status: sensorStatus }] : []),
          }),
        })),
      };
      const storageAssignments = [];
      const storageAssignmentsCollection = {
        insertOne: vi.fn(async (doc) => {
          storageAssignments.push(doc);
          return { insertedId: new ObjectId() };
        }),
      };
      base.db.collection = vi.fn((name) => {
        if (name === 'storageContainers') return storageContainersCollection;
        if (name === 'storageBoxes') return storageBoxesCollection;
        if (name === 'storageAssignments') return storageAssignmentsCollection;
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sensors') return sensorsCollection;
        return originalCollection(name);
      });
      base.storageAssignments = storageAssignments;
      return base;
    }

    it('assigns the next available box when autoIncrement is on and the row has no boxId', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection, storageAssignments } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: true,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(1);
      expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = samplesCollection.insertOne.mock.calls[0][0];
      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));
      expect(inserted.storageLocation.position).toBe('A1');
      expect(storageAssignments).toHaveLength(1);
    });

    it('records a per-row error when autoIncrement is on but no more boxes are available', async () => {
      const chain = makeStorageChain(2);
      const { db } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW, { ...VALID_ROW }, { ...VALID_ROW }]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: true,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.errors.some((e) => e.errors[0].includes('Não há mais localizações de armazenamento disponíveis'))).toBe(true);
    });

    it('assigns startBoxId directly to every row without one when autoIncrement is off', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: false,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(1);
      expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = samplesCollection.insertOne.mock.calls[0][0];
      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));
    });

    it('resolves a CSV-provided boxId directly, without consulting startBoxId/autoIncrement', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([
        { ...VALID_ROW, boxId: String(chain.boxes[1]._id), positionCode: 'A1' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: true,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(1);
      const inserted = samplesCollection.insertOne.mock.calls[0][0];
      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[1]._id));
    });

    // #467: bulk LGPD import previously placed samples without checking
    // RF004's operational-sensor/equipment-readiness gate at all.
    it('rejects a row (CSV-provided boxId) whose freezer equipment is in a blocked status', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection } = makeDbWithStorageChain(chain, { equipmentStatus: 'maintenance' });
      vi.spyOn(service, 'readFile').mockResolvedValue([
        { ...VALID_ROW, boxId: String(chain.boxes[0]._id), positionCode: 'A1' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.success).toBe(0);
      expect(result.errors[0].errors[0]).toMatch(/equipamento pronto ou sensor operacional/);
      expect(samplesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('rejects a row (CSV-provided boxId) whose freezer has no operational sensor', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection } = makeDbWithStorageChain(chain, { hasSensor: false });
      vi.spyOn(service, 'readFile').mockResolvedValue([
        { ...VALID_ROW, boxId: String(chain.boxes[0]._id), positionCode: 'A1' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.success).toBe(0);
      expect(result.errors[0].errors[0]).toMatch(/equipamento pronto ou sensor operacional/);
      expect(samplesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('rejects a row (fixed startBoxId, autoIncrement off) whose freezer equipment is retired', async () => {
      const chain = makeStorageChain(2);
      const { db, samplesCollection } = makeDbWithStorageChain(chain, { equipmentStatus: 'retired' });
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: false,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(0);
      expect(result.errors[0].errors[0]).toMatch(/equipamento pronto ou sensor operacional/);
      expect(samplesCollection.insertOne).not.toHaveBeenCalled();
    });
  });

  it('fills in sampleType/sampleOrigin/extractionProtocol from groupFields when the row omits them', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { sampleType: '', sampleOrigin: '', extractionProtocol: '', participantId: '12345678', quantity: '5', quality: 'GOOD' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
      groupFields: {
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
      },
    });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.sampleType).toBe('PLASMA');
    expect(inserted.sampleOrigin).toBe('VENOUS_BLOOD');
    expect(inserted.extractionProtocol).toBe('TUBE_EDTA');
  });
});

describe('ImportLGPDService.getNextAvailableStorageSlot (#459)', () => {
  const { ObjectId } = require('mongodb');

  function makeStorageDb({ freezerId = new ObjectId(), boxes = [], equipmentStatus = 'active', hasSensor = true } = {}) {
    const shelfId = new ObjectId();
    const rackId = new ObjectId();
    const containers = [
      { _id: freezerId, containerType: 'FREEZER', containerID: 42, parent_id: null },
      { _id: shelfId, containerType: 'SHELF', parent_id: freezerId },
      { _id: rackId, containerType: 'RACK', parent_id: shelfId },
    ];
    const chainedBoxes = boxes.map((box) => ({ parent_id: rackId, ...box }));
    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageContainers') {
          return { findOne: vi.fn(async ({ _id }) => containers.find((c) => String(c._id) === String(_id)) || null) };
        }
        if (name === 'storageBoxes') {
          return {
            find: vi.fn(() => ({ sort: () => ({ toArray: async () => [...chainedBoxes] }) })),
          };
        }
        // #467: RF004 gate collections.
        if (name === 'equipment') {
          return { findOne: vi.fn(async () => ({ equipmentID: 42, status: equipmentStatus })) };
        }
        if (name === 'sensors') {
          return {
            find: vi.fn(() => ({
              limit: () => ({ toArray: async () => (hasSensor ? [{ locationId: 42, status: 'ok' }] : []) }),
            })),
          };
        }
        throw new Error(`unexpected collection requested: ${name}`);
      }),
    };
    return { db, rackId, shelfId, freezerId, boxes: chainedBoxes };
  }

  function box(overrides = {}) {
    return {
      _id: new ObjectId(),
      name: 'B1',
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0,
      status: 'ACTIVE',
      ...overrides,
    };
  }

  it('returns null when the start box does not exist', async () => {
    const { db } = makeStorageDb({ boxes: [] });
    const result = await service.getNextAvailableStorageSlot(db, String(new ObjectId()), 1);
    expect(result).toBeNull();
  });

  it('returns null when startBoxId is not a valid ObjectId', async () => {
    const { db } = makeStorageDb({ boxes: [box()] });
    const result = await service.getNextAvailableStorageSlot(db, 'not-an-object-id', 0);
    expect(result).toBeNull();
  });

  it('returns the box N steps after the start box, sorted by name/boxID/_id', async () => {
    const b1 = box({ name: 'B1' });
    const b2 = box({ name: 'B2' });
    const b3 = box({ name: 'B3' });
    const { db } = makeStorageDb({ boxes: [b1, b2, b3] });

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 1);
    expect(String(result.boxId)).toBe(String(b2._id));
    expect(result.position).toBe('A1');
  });

  it('skips full/retired boxes when advancing the sequence', async () => {
    const b1 = box({ name: 'B1' });
    const bFull = box({ name: 'B2', status: 'FULL' });
    const b3 = box({ name: 'B3' });
    const { db } = makeStorageDb({ boxes: [b1, bFull, b3] });

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 1);
    expect(String(result.boxId)).toBe(String(b3._id));
  });

  it('returns null when the requested offset runs past the end of the available-box sequence', async () => {
    const b1 = box({ name: 'B1' });
    const { db } = makeStorageDb({ boxes: [b1] });

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 5);
    expect(result).toBeNull();
  });

  // #467: RF004 gate — a box in a freezer whose equipment isn't ready, or
  // has no operational sensor, is not a valid auto-increment target.
  it('returns null when the resolved freezer equipment is in a blocked status', async () => {
    const b1 = box({ name: 'B1' });
    const { db } = makeStorageDb({ boxes: [b1], equipmentStatus: 'maintenance' });

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 0);
    expect(result).toBeNull();
  });

  it('returns null when the resolved freezer has no operational sensor', async () => {
    const b1 = box({ name: 'B1' });
    const { db } = makeStorageDb({ boxes: [b1], hasSensor: false });

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 0);
    expect(result).toBeNull();
  });

  // #471: a non-ready freezer shouldn't fail the row outright — advance to
  // the next available box in the sequence, matching `intakeWizard.js`'s
  // `resolveAutomaticLocation` skip-ahead shape.
  it('skips a box whose freezer is not ready and advances to the next available box', async () => {
    const rackId = new ObjectId();
    const shelfId = new ObjectId();
    const freezerBlocked = new ObjectId();
    const freezerReady = new ObjectId();
    const containers = [
      { _id: freezerBlocked, containerType: 'FREEZER', containerID: 42, parent_id: null },
      { _id: freezerReady, containerType: 'FREEZER', containerID: 43, parent_id: null },
      { _id: shelfId, containerType: 'SHELF', parent_id: freezerReady },
      { _id: rackId, containerType: 'RACK', parent_id: shelfId },
    ];
    const shelfBlockedId = new ObjectId();
    const rackBlockedId = new ObjectId();
    containers.push(
      { _id: shelfBlockedId, containerType: 'SHELF', parent_id: freezerBlocked },
      { _id: rackBlockedId, containerType: 'RACK', parent_id: shelfBlockedId },
    );

    const b1 = box({ name: 'B1', parent_id: rackBlockedId });
    const b2 = box({ name: 'B2', parent_id: rackId });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageContainers') {
          return { findOne: vi.fn(async ({ _id }) => containers.find((c) => String(c._id) === String(_id)) || null) };
        }
        if (name === 'storageBoxes') {
          return { find: vi.fn(() => ({ sort: () => ({ toArray: async () => [b1, b2] }) })) };
        }
        if (name === 'equipment') {
          return {
            findOne: vi.fn(async ({ equipmentID }) => {
              const ids = equipmentID?.$in || [equipmentID];
              if (ids.includes(42)) return { equipmentID: 42, status: 'maintenance' };
              if (ids.includes(43)) return { equipmentID: 43, status: 'active' };
              return null;
            }),
          };
        }
        if (name === 'sensors') {
          return {
            find: vi.fn(({ $or }) => ({
              limit: () => ({
                toArray: async () => {
                  const ids = $or[0].locationId.$in;
                  return ids.includes(43) ? [{ locationId: 43, status: 'ok' }] : [];
                },
              }),
            })),
          };
        }
        throw new Error(`unexpected collection requested: ${name}`);
      }),
    };

    const result = await service.getNextAvailableStorageSlot(db, String(b1._id), 0);
    expect(String(result.boxId)).toBe(String(b2._id));
  });

  it('returns null (and logs) instead of throwing when the query rejects', async () => {
    const db = {
      collection: vi.fn(() => ({
        find: vi.fn(() => { throw new Error('mongo down'); }),
      })),
    };

    const result = await service.getNextAvailableStorageSlot(db, String(new ObjectId()), 1);
    expect(result).toBeNull();
  });
});
