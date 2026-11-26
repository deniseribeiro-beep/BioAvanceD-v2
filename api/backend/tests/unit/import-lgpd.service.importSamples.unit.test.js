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
const { revealStagedRecord } = require('../../src/utils/stagedRowCrypto');
const patientIdentityService = require('../../src/services/PatientIdentityService');
const qualityDomain = require('../../src/services/quality-domain.service');
const DrugService = require('../../src/services/DrugService');
const { createMatchingCollection } = require('../factories/filter.factory');
const env = require('../../src/config/env');
const sampleCollectionGate = require('../../src/services/sample-collection-gate.service');

// RF004 AC2 (#1538): every row runs the collection gate createSample runs.
// Stubbed here so the cases about other rules need no governed collection;
// the cases that prove the gate restore it (mockRestore) and run it for real.
beforeEach(() => {
  vi.spyOn(sampleCollectionGate, 'assertSampleCollectionAdmits').mockResolvedValue(null);
});

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
    // #932: backs generateUniqueBarcode's scan for the year's existing codes,
    // a plain find().toArray() since #775. This used to live on a SEPARATE
    // `amostras` fake, because the generator was called with that legacy
    // collection name while rows were inserted here -- so the fixture
    // faithfully reproduced the production split, and a generated duplicate
    // could not have been caught by this suite either. One collection now,
    // which is the whole point of #932. Chainable so sort()/limit() callers
    // keep working.
    find: vi.fn(() => {
      const cursor = {
        sort: () => cursor,
        limit: () => cursor,
        toArray: async () => []
      };
      return cursor;
    }),
  };
  const patientsCollection = {
    updateOne: vi.fn().mockResolvedValue({}),
  };
  // #702: these mirror the real seeded documents -- `id` is the MIABIS id,
  // `description` the human label. They used to carry the id in `description`,
  // which matched the buggy lookup instead of the data it queries.
  const sampleTypesCollection = { findOne: vi.fn().mockResolvedValue(sampleTypeFound ? { id: 'PLASMA', description: 'Plasma' } : null) };
  const sampleOriginsCollection = { findOne: vi.fn().mockResolvedValue(sampleOriginFound ? { id: 'VENOUS_BLOOD', description: 'Sangue Venoso Periferico' } : null) };
  const extractionProtocolsCollection = { findOne: vi.fn().mockResolvedValue(protocolFound ? { id: 'TUBE_EDTA', description: 'Tubo EDTA (Tampa Roxa)' } : null) };
  // AllocateSampleUseCase's audit trail (MongoAuditRepository) and
  // storagePaths hierarchy lookup (MongoStorageRepository.checkLocationBlocked
  // and findStorageHierarchyForBox).
  const sampleMovementsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-1' }),
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [], next: async () => null }) }) })),
    createIndex: vi.fn().mockResolvedValue(true),
  };
  // #779: generateUniqueBarcode now seeds a per-year `counters` document
  // (findOne + upserting updateOne) and then advances it atomically. A stub
  // returning a fixed `{ seq: 1 }` could not advance, so every generated
  // barcode after the first would collide -- the mock has to be a real
  // counter or it encodes the bug the change removes.
  const countersStore = {};
  const countersCollection = {
    findOne: vi.fn(async (query) =>
      query._id in countersStore ? { _id: query._id, ...countersStore[query._id] } : null
    ),
    updateOne: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in countersStore) && options.upsert) {
        countersStore[query._id] = { ...(update.$setOnInsert || {}) };
      }
      return { acknowledged: true };
    }),
    findOneAndUpdate: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in countersStore)) {
        if (!options.upsert) return null;
        countersStore[query._id] = { ...(update.$setOnInsert || {}) };
      }
      for (const [field, by] of Object.entries(update.$inc || {})) {
        countersStore[query._id][field] = (countersStore[query._id][field] || 0) + by;
      }
      return { _id: query._id, ...countersStore[query._id] };
    }),
  };
  const storagePathsCollection = {
    findOne: vi.fn().mockResolvedValue(null),
  };
  const rcsAssessmentsCollection = {
    // Mirrors the real MongoDB driver, which mutates the passed document
    // with the generated _id — recordAssessment's caller relies on this to
    // pin the sample to the returned snapshot's _id (#502).
    insertOne: vi.fn().mockImplementation((doc) => {
      doc._id = 'assessment-1';
      return Promise.resolve({ insertedId: 'assessment-1' });
    }),
  };
  const specimenPreanalyticsCollection = {
    // Same real-driver _id mutation as rcsAssessmentsCollection above,
    // for recordProfile's caller (#503).
    insertOne: vi.fn().mockImplementation((doc) => {
      doc._id = 'profile-1';
      return Promise.resolve({ insertedId: 'profile-1' });
    }),
  };

  // #787 (RNF011 AC#4): rejected rows are staged into the same two
  // collections the FHIR import path already uses, so the shapes stay
  // comparable across the two import paths.
  const importBatchesCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'batch-1' }),
  };
  const importStagingRecordsCollection = {
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
  };

  // #1312: the allocation appends its custody event to the graph outbox (the
  // event collection and its per-aggregate version counter) in its own
  // transaction, so a row only imports when that append lands.
  const graphOutboxCollection = {
    createIndex: vi.fn().mockResolvedValue(true),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  };
  const graphOutboxVersionsCollection = {
    findOneAndUpdate: vi.fn().mockResolvedValue({ version: 1 }),
  };

  // #1374, #1378: the allocation places a specimen on the physical chain,
  // and every imported row is issued a LabelIdentifier on its container:
  // the one the allocation loaded, else one created and loaded at the issue,
  // after the legacy placement (storageAssignments) it would adopt is read.
  const physicalChain = {
    containers: createMatchingCollection([], { collectionName: 'containers' }),
    specimenContainerAssignments: createMatchingCollection([], { collectionName: 'specimenContainerAssignments' }),
    containerPositionAssignments: createMatchingCollection([], { collectionName: 'containerPositionAssignments' }),
    rackLocationAssignments: createMatchingCollection([], { collectionName: 'rackLocationAssignments' }),
    labelIdentifiers: createMatchingCollection([], { collectionName: 'labelIdentifiers' }),
    storageAssignments: createMatchingCollection([], { collectionName: 'storageAssignments' }),
  };

  const collections = {
    ...physicalChain,
    graph_projection_outbox: graphOutboxCollection,
    graph_projection_outbox_aggregate_versions: graphOutboxVersionsCollection,
    import_batches: importBatchesCollection,
    import_staging_records: importStagingRecordsCollection,
    samples: samplesCollection,
    patients: patientsCollection,
    sampleTypes: sampleTypesCollection,
    sampleOrigins: sampleOriginsCollection,
    extractionProtocols: extractionProtocolsCollection,
    sample_movements: sampleMovementsCollection,
    counters: countersCollection,
    storagePaths: storagePathsCollection,
    rcsAssessments: rcsAssessmentsCollection,
    specimenPreanalytics: specimenPreanalyticsCollection,
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

  return { db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection, physicalChain };
}

describe('ImportLGPDService.importSamples', () => {
  let db;
  let samplesCollection;
  let patientsCollection;
  let rcsAssessmentsCollection;
  let specimenPreanalyticsCollection;
  let importBatchesCollection;
  let importStagingRecordsCollection;

  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());

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

  // #786: results.total was incremented at the BOTTOM of the per-row loop,
  // after the try/catch. Every validation failure reaches that point via a
  // `continue`, so rejected rows were counted in results.errors but never in
  // results.total -- a partially-failed import reported total < success +
  // errors. Those three numbers are passed straight to
  // auditLogger.logImport by import-lgpd.controller.js, so the audit record
  // for a partial import under-counted the rows it actually touched.
  //
  // A mixed file is what discriminates: with only-valid or only-invalid rows
  // the old code still produced a self-consistent-looking pair.
  it('counts rejected rows in total, so total === success + errors for a partially-failed import (#786)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      VALID_ROW,
      { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.total).toBe(result.success + result.errors.length);
  });

  // The all-rejected case: total must still report the rows that were read,
  // not zero. Under the bug this returned total: 0 alongside errors: 1.
  it('counts a wholly-rejected file in total rather than reporting zero (#786)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  // #790: importSamples had no empty-row guard, while importPatients has two
  // (`!row || Object.keys(row).length === 0`, then an all-fields-blank check)
  // before its own results.total++. A trailing blank row -- the normal output
  // of Excel and of many CSV exporters -- therefore parsed to a sampleData
  // with no participantId, failed identity resolution, and was reported as
  // `Nao foi possivel resolver a identidade do paciente para a amostra`.
  //
  // These guard the interaction with #786 as much as the skip itself: the
  // guard sits BEFORE results.total++ (matching importPatients), so a blank
  // row is not a row at all -- it is not counted, not errored, and #786's
  // `total === success + errors` invariant still holds.
  // #1012: readCSV/readExcel drop a trailing blank row before this array ever
  // reaches importSamples (see the #1001 seeding test below), so feeding a
  // `{}` row directly -- as this test used to -- exercised a per-row
  // isEmptyRow backstop that no real reader output can reach. Seeded via
  // rows.skippedCount instead.
  it('skips a trailing blank row instead of rejecting it as an identity failure (#790, #1012)', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors).toHaveLength(0);
    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
    expect(result.total).toBe(result.success + result.errors.length);
  });

  // #1012: same reasoning as above -- readExcel's whitespace-only-row filter
  // (gate 2, `Object.values(rowObj).some(v => v !== null && v !== '')`) drops
  // this row before importSamples ever sees it.
  it('skips a whitespace-only row, not just a structurally empty one (#790, #1012)', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors).toHaveLength(0);
    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
  });

  // #798: a `skipped` count makes a truncated upload distinguishable from a
  // clean file that happened to have trailing formatting artifacts. It must
  // be purely additive -- total/success/errors have to come out identical to
  // the same file without the blank rows.
  // #1012: the two blank rows this test used to append to the mocked
  // `readFile` result can't reach importSamples from a real reader --
  // readCSV/readExcel already drop them before the array exists. Seeded via
  // rows.skippedCount on the same two real rows instead.
  it('reports a skipped count matching the number of blank rows, leaving total/success/errors identical to the same file without them (#798, #1012)', async () => {
    const badRow = { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' };

    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW, badRow]);
    const baseline = await service.importSamples(db, { path: '/baseline.csv', originalname: 'baseline.csv' });

    ({ db, samplesCollection } = makeDb());
    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      category: 'A',
      score: 90,
    });

    const rowsWithBlanks = [VALID_ROW, badRow];
    Object.defineProperty(rowsWithBlanks, 'skippedCount', { value: 2, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rowsWithBlanks);
    const withBlanks = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(withBlanks.skipped).toBe(2);
    expect(withBlanks.total).toBe(baseline.total);
    expect(withBlanks.success).toBe(baseline.success);
    expect(withBlanks.errors).toHaveLength(baseline.errors.length);
  });

  it('reports skipped: 0 when a file has no blank rows', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.skipped).toBe(0);
  });

  // #1001: same seeding as importPatients -- readCSV/readExcel now drop
  // blank rows before this array reaches importSamples, so results.skipped
  // must come from the reader's `rows.skippedCount`, not start at 0.
  it('#1001: seeds results.skipped from the reader-reported skippedCount on the rows array readFile returns', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 3, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.skipped).toBe(3);
    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
  });

  // #787 staged rejected rows into quarantine. A blank row is exactly the junk
  // that should not land there dressed as a real data problem -- the guard
  // runs before the row can be rejected, so an otherwise-clean file still
  // reports no quarantine batch.
  // #1012: same reasoning as the two guard tests above -- a real reader
  // drops the blank row before importSamples sees it, so it is seeded via
  // rows.skippedCount rather than fed in directly.
  it('does not quarantine a blank row, so an otherwise-clean file opens no staging batch (#790, #787, #1012)', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors).toHaveLength(0);
    expect(result.stagingBatchId ?? null).toBeNull();
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

  // #1353, #1192: the resolved organization is the tenancy key, stamped as
  // organizationId. parseSampleRow maps a collectionSite column (ELM-0128,
  // #1376), but VALID_ROW leaves it out, so the unnamed site is filled with
  // the organization, as before.
  it('stores the stamped organizationId on an imported row and fills its unnamed collectionSite with it (#1353, #1192)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'ORG-OWN' });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne.mock.calls[0][0].organizationId).toBe('ORG-OWN');
    expect(samplesCollection.insertOne.mock.calls[0][0].collectionSite).toBe('ORG-OWN');
    // A participant the row creates is stamped the same way.
    expect(patientIdentityService.matchOrUpsertParticipant.mock.calls[0][1]).toMatchObject({ clinicalUnitId: 'ORG-OWN' });
  });

  it('passes the importer\'s organization scope to the participant match (#1356)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const organizationScope = { scope: 'organization', organizationIds: ['ORG-OWN'] };

    await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'ORG-OWN', organizationScope });

    expect(patientIdentityService.matchOrUpsertParticipant.mock.calls[0][2]).toEqual({ organizationScope });
    // An in-scope match is the importer's own participant, so it is updated.
    expect(patientsCollection.updateOne).toHaveBeenCalledTimes(1);
  });

  it('links a row to a participant matched outside the importer\'s scope but writes nothing on that participant (#1356)', async () => {
    patientIdentityService.matchOrUpsertParticipant.mockResolvedValue({ ...MATCHED_PATIENT, outOfScope: true });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const organizationScope = { scope: 'organization', organizationIds: ['ORG-OWN'] };

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'ORG-OWN', organizationScope });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(samplesCollection.insertOne.mock.calls[0][0].participantId).toBe('12345678');
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('leaves collectionSite unset when no organizationId was resolved, a global caller naming none (#1353)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne.mock.calls[0][0].collectionSite).toBeNull();
    expect(samplesCollection.insertOne.mock.calls[0][0].organizationId).toBeNull();
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
  // writes. Real-enough proof per this repo's backend-internal
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

  // #503: mirrors #499's RCS fix but for the SPREC half — import-lgpd's
  // sample.sprec was persisted embedded on the sample but never recorded as
  // a canonical, referenced SpecimenPreanalytics snapshot, unlike
  // import.service.js's CSV/XLSX branch (~line 576).
  it('records a referenced SpecimenPreanalytics snapshot alongside the embedded copy (#503)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(specimenPreanalyticsCollection.insertOne).toHaveBeenCalledTimes(1);
    const recorded = specimenPreanalyticsCollection.insertOne.mock.calls[0][0];
    expect(recorded.specimenId).toBe(inserted.specimenId);
    expect(recorded.sampleType).toBe('ST1');
    expect(recorded.primaryContainer).toBe('PC1');
    const pinUpdateCall = samplesCollection.updateOne.mock.calls.find(
      (call) => call[1]?.$set?.sealedSpecimenPreanalyticsId
    );
    expect(pinUpdateCall).toBeDefined();
    expect(pinUpdateCall[1].$set.sealedSpecimenPreanalyticsId).toBe('profile-1');
  });

  it('does not fail the row import when recording the SpecimenPreanalytics snapshot rejects (#503)', async () => {
    const failingSpecimenPreanalytics = { insertOne: vi.fn().mockRejectedValue(new Error('mongo down')) };
    const originalCollection = db.collection;
    db.collection = vi.fn((name) => (name === 'specimenPreanalytics' ? failingSpecimenPreanalytics : originalCollection(name)));
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
    // #969: incremented at :1445, dropped from the return literal.
    expect(result.duplicates).toBe(1);
  });

  it('#969: returns `duplicates` as a real key even when nothing was rejected, so the worker cannot read undefined', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    // `toHaveProperty` rather than `toBe(0)`: the defect was an ABSENT key,
    // which is exactly what `|| 0` downstream made indistinguishable from a
    // genuine zero.
    expect(result).toHaveProperty('duplicates');
    expect(result.duplicates).toBe(0);
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
  // branch incidentally. #536 removed the releaseStatus reconciliation
  // that used to fire here — this test now just confirms the import
  // still succeeds and never touches the deleted field.
  it('does not touch releaseStatus when ethics/SPREC data is missing', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    for (const call of samplesCollection.updateOne.mock.calls) {
      expect(call[1].$set).not.toHaveProperty('releaseStatus');
    }
  });

  it('does not touch releaseStatus when consentTemplateId and SPREC data are all present', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, consentTemplateId: 'consent-1' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    // #502: the RcsAssessment snapshot pin update is expected here — this
    // test only asserts releaseStatus itself is never among the $set keys.
    for (const call of samplesCollection.updateOne.mock.calls) {
      expect(call[1].$set).not.toHaveProperty('releaseStatus');
    }
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
        // #523: AllocateSampleUseCase (#477) -> MongoStorageRepository
        // .findSampleById (#507) calls findOne to resolve the specimen's
        // current assignment before allocating; a freshly-inserted,
        // not-yet-allocated row has none, matching sample.service.test.js's
        // mockOperationalStorage fix in #510/#513.
        findOne: vi.fn().mockResolvedValue(null),
      };
      // #1374: the allocation places each specimen on the physical chain
      // (makeDb's), and the placement reader reads it there first.
      const { physicalChain } = base;
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
      const { db, samplesCollection, storageAssignments, physicalChain } = makeDbWithStorageChain(chain);
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
      // #1374: one chain placement per imported sample, keyed by its
      // business specimenId; no StorageAssignment row.
      expect(physicalChain.containers.docs).toHaveLength(1);
      expect(physicalChain.specimenContainerAssignments.docs).toEqual([
        expect.objectContaining({ specimenId: inserted.specimenId, containerId: physicalChain.containers.docs[0].containerId }),
      ]);
      expect(physicalChain.containerPositionAssignments.docs).toEqual([
        expect.objectContaining({
          containerId: physicalChain.containers.docs[0].containerId,
          storagePositionId: `${chain.boxes[0]._id}:A01`,
        }),
      ]);
      expect(storageAssignments).toHaveLength(0);
    });

    // #1378: a placed row's code is issued on the container the allocation
    // loaded; no second container is created.
    it('issues a placed row one LabelIdentifier on the container its allocation loaded (#1378)', async () => {
      const chain = makeStorageChain(1);
      const { db, samplesCollection, physicalChain } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, barcode: 'BC-PLACED-1' }]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(1);
      const inserted = samplesCollection.insertOne.mock.calls[0][0];
      expect(physicalChain.containers.docs).toHaveLength(1);
      const { containerId } = physicalChain.containers.docs[0];
      expect(physicalChain.specimenContainerAssignments.docs).toEqual([
        expect.objectContaining({ specimenId: inserted.specimenId, containerId }),
      ]);
      expect(physicalChain.labelIdentifiers.docs).toEqual([
        expect.objectContaining({
          encodedValue: 'BC-PLACED-1',
          targetType: 'container',
          targetId: containerId,
          identifierOrigin: 'institution_applied',
          status: 'active',
          printBatchId: null,
        }),
      ]);
    });

    // #817: the per-row work moved into processSampleRow, and the loop now
    // hands it the allocation cursor as `slotIndex`. The cursor is the count
    // of rows imported so far, so a rejected row does not advance it.
    it('passes the success count as the slot cursor, not advanced by a rejected row (#817)', async () => {
      const chain = makeStorageChain(3);
      const { db } = makeDbWithStorageChain(chain);
      vi.spyOn(service, 'readFile').mockResolvedValue([
        VALID_ROW,
        { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
        { ...VALID_ROW },
      ]);
      const slotSpy = vi.spyOn(service, 'getNextAvailableStorageSlot');

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, {
        autoIncrement: true,
        startBoxId: String(chain.boxes[0]._id),
      });

      expect(result.success).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ index: 1 });
      expect(slotSpy.mock.calls.map((call) => call[2])).toEqual([0, 1]);
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

  // #787 (RNF011 AC#4, Crítica): "Importações inválidas são colocadas em
  // staging ou quarentena, sem correção silenciosa."
  //
  // Before this, a rejected row was pushed onto an in-memory results.errors
  // array, returned in the HTTP response as data.errorsDetails, and then
  // gone -- and import-lgpd.controller.js deletes the uploaded file
  // immediately afterwards. An operator who imported 500 rows, got 40
  // rejections and closed the tab had lost both the rows and the file, while
  // the half that did import was already canonically persisted.
  //
  // The FHIR import path already satisfies this AC via
  // fhir-import-staging.service.js, so the shape here deliberately mirrors
  // it: the same `import_batches` + `import_staging_records` collections,
  // with the batch discriminated by `type`/`source` (the FHIR batch doc
  // already carries 'FHIR_BUNDLE'/'FHIR', so the schema was built to hold
  // more than one import path).
  describe('#787 (RNF011 AC#4): rejected rows are staged, not discarded', () => {
    it('stages a rejected row into import_staging_records under a batch', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([
        VALID_ROW,
        { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'lote-2026.csv' });

      // The valid row still imports; staging is additive to the existing
      // behaviour, not a replacement for it.
      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(1);

      expect(importBatchesCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(importBatchesCollection.insertOne.mock.calls[0][0]).toMatchObject({
        type: 'LGPD_SAMPLE_CSV',
        source: 'LGPD',
        status: 'QUARANTINED',
        fileName: 'lote-2026.csv',
        counts: { total: 2, success: 1, errors: 1 },
      });

      expect(importStagingRecordsCollection.insertMany).toHaveBeenCalledTimes(1);
      const staged = importStagingRecordsCollection.insertMany.mock.calls[0][0];
      expect(staged).toHaveLength(1);
      expect(staged[0]).toMatchObject({
        batchId: importBatchesCollection.insertOne.mock.calls[0][0]._id,
        rowNumber: 3,
        status: 'ERROR',
      });
      expect(JSON.stringify(staged[0].errors)).toMatch(/atcCode/);
    });

    it('returns the staging batch id so the response points at the quarantined rows', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([
        { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      // "sem correção silenciosa" cuts both ways: the rows have to be kept,
      // and the caller has to be told where they went.
      expect(result.stagingBatchId).toBe(importBatchesCollection.insertOne.mock.calls[0][0]._id);
    });

    it('preserves the rejected row data, not just the error message', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([
        { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
      ]);

      await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      // #807: sealed at rest, so read it back the way the batch reader does.
      const staged = importStagingRecordsCollection.insertMany.mock.calls[0][0].map(revealStagedRecord);
      // The whole point of quarantine over a log line: the row can be
      // corrected and re-submitted, which needs the original values.
      expect(staged[0].row).toBeDefined();
      expect(staged[0].row.atcCode).toBe('NOT-A-CODE');
    });

    it('does not open a staging batch when every row imports cleanly', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(0);
      // Quarantine is for invalid imports only -- a clean file should not
      // leave an empty batch behind for someone to review.
      expect(importBatchesCollection.insertOne).not.toHaveBeenCalled();
      expect(importStagingRecordsCollection.insertMany).not.toHaveBeenCalled();
      expect(result.stagingBatchId).toBeNull();
    });

    it('does not fail the import when staging itself rejects', async () => {
      importBatchesCollection.insertOne.mockRejectedValueOnce(new Error('mongo down'));
      vi.spyOn(service, 'readFile').mockResolvedValue([
        VALID_ROW,
        { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
      ]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      // Losing the quarantine copy must not also lose the rows that did
      // import -- the response is still the primary record either way.
      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.stagingBatchId).toBeNull();
    });

    it('#1538 RF004 AC2: rejects and stages a row that names no collection, storing no sample', async () => {
      sampleCollectionGate.assertSampleCollectionAdmits.mockRestore();
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.success).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(JSON.stringify(result.errors[0].errors)).toMatch(/collectionId é obrigatório/);
      expect(samplesCollection.insertOne).not.toHaveBeenCalled();

      expect(importBatchesCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(importStagingRecordsCollection.insertMany).toHaveBeenCalledTimes(1);
      const staged = importStagingRecordsCollection.insertMany.mock.calls[0][0];
      expect(staged).toHaveLength(1);
      expect(staged[0]).toMatchObject({
        batchId: importBatchesCollection.insertOne.mock.calls[0][0]._id,
        rowNumber: 2,
        status: 'ERROR',
      });
      expect(JSON.stringify(staged[0].errors)).toMatch(/collectionId é obrigatório/);
      expect(result.stagingBatchId).toBe(importBatchesCollection.insertOne.mock.calls[0][0]._id);
    });
  });
});

// #817: processSampleRow is the one implementation of a sample row, called
// by importSamples' loop and meant for a resubmit of one quarantined row
// (#794). It reports the row's outcome and holds no batch state of its own.
describe('ImportLGPDService.processSampleRow (#817)', () => {
  let db;
  let samplesCollection;
  let patientsCollection;
  let physicalChain;

  function rowContext(overrides = {}) {
    return {
      samplesCollection,
      patientsCollection,
      validator: { validateSampleCompliance: vi.fn().mockResolvedValue({ ok: true }) },
      drugService: new DrugService(db),
      allocateUseCase: { execute: vi.fn() },
      groupFields: {},
      autoIncrement: false,
      startBoxId: null,
      actor: {},
      slotIndex: 0,
      rowNumber: 2,
      ...overrides,
    };
  }

  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, physicalChain } = makeDb());
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

  it('returns ok with the inserted id for a valid row', async () => {
    const outcome = await service.processSampleRow(db, VALID_ROW, rowContext());

    expect(outcome).toEqual({ ok: true, sampleId: 'sample-id-1' });
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  // #1378: a row with no placement has its container created and loaded at
  // the label's issue, under a specimen-label-issuance source event.
  it('issues an unplaced row one LabelIdentifier on a container loaded at the issue (#1378)', async () => {

    const outcome = await service.processSampleRow(db, { ...VALID_ROW, barcode: 'BC-UNPLACED-1' }, rowContext());

    expect(outcome).toEqual({ ok: true, sampleId: 'sample-id-1' });
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(physicalChain.containers.docs).toHaveLength(1);
    const { containerId } = physicalChain.containers.docs[0];
    expect(physicalChain.specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({
        specimenId: inserted.specimenId,
        containerId,
        sourceEventId: expect.stringMatching(/^specimen-label-issuance:sample-id-1:/),
      }),
    ]);
    expect(physicalChain.containerPositionAssignments.docs).toHaveLength(0);
    expect(physicalChain.labelIdentifiers.docs).toEqual([
      expect.objectContaining({
        encodedValue: 'BC-UNPLACED-1',
        targetType: 'container',
        targetId: containerId,
        identifierOrigin: 'institution_applied',
        status: 'active',
        printBatchId: null,
      }),
    ]);
  });

  // #1378: this import has no duplicate-barcode check of its own, so a code
  // already active as a label fails the row after its insert.
  it('fails a row whose code is already an active label, reporting the inserted id (#1378)', async () => {
    physicalChain.labelIdentifiers.insertOne = vi.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    const outcome = await service.processSampleRow(db, { ...VALID_ROW, barcode: 'BC-TAKEN-1' }, rowContext());

    expect(outcome).toMatchObject({ ok: false, sampleId: 'sample-id-1' });
    expect(outcome.errors[0]).toMatch(/BC-TAKEN-1 já ativo/);
  });

  // #1378 (ELM-0116): once the migration window is closed, the row's code is
  // issued only as the label; the inserted sample carries no Sample.barcode.
  it('with the barcode window closed, inserts no barcode and issues the label with the code (#1378)', async () => {
    const saved = env.SAMPLE_BARCODE_WINDOW_CLOSED;
    env.SAMPLE_BARCODE_WINDOW_CLOSED = true;
    let outcome;
    try {
      outcome = await service.processSampleRow(db, { ...VALID_ROW, barcode: 'BC-CLOSED-1' }, rowContext());
    } finally {
      env.SAMPLE_BARCODE_WINDOW_CLOSED = saved;
    }

    expect(outcome).toEqual({ ok: true, sampleId: 'sample-id-1' });
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(samplesCollection.insertOne.mock.calls[0][0]).not.toHaveProperty('barcode');
    expect(physicalChain.labelIdentifiers.docs).toEqual([expect.objectContaining({ encodedValue: 'BC-CLOSED-1', status: 'active' })]);
  });

  it('returns the rejection without inserting, for the caller to record', async () => {
    const outcome = await service.processSampleRow(
      db,
      { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
      rowContext()
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.errors[0]).toMatch(/atcCode inválido/);
    expect(outcome.data).toEqual({ participantId: '12345678' });
    expect(outcome.sampleId).toBeUndefined();
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1538 RF004 AC2: rejects a row that names no collection before any participant write', async () => {
    sampleCollectionGate.assertSampleCollectionAdmits.mockRestore();

    const outcome = await service.processSampleRow(db, VALID_ROW, rowContext());

    expect(outcome.ok).toBe(false);
    expect(outcome.errors[0]).toMatch(/collectionId é obrigatório/);
    expect(patientIdentityService.matchOrUpsertParticipant).not.toHaveBeenCalled();
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1538 RF004 AC2: a row naming a collection reaches the gate with the trimmed collectionId COL-1', async () => {
    const outcome = await service.processSampleRow(db, { ...VALID_ROW, collectionId: ' COL-1 ' }, rowContext());

    expect(outcome).toEqual({ ok: true, sampleId: 'sample-id-1' });
    expect(sampleCollectionGate.assertSampleCollectionAdmits).toHaveBeenCalledTimes(1);
    expect(sampleCollectionGate.assertSampleCollectionAdmits.mock.calls[0][0]).toBe(db);
    expect(sampleCollectionGate.assertSampleCollectionAdmits.mock.calls[0][1].collectionId).toBe('COL-1');
  });

  it('flags a duplicate barcode as a duplicate rejection', async () => {
    ({ db, samplesCollection, patientsCollection } = makeDb({ existingBarcode: { _id: 'other' } }));

    const outcome = await service.processSampleRow(db, { ...VALID_ROW, barcode: 'BC-1' }, rowContext());

    expect(outcome).toMatchObject({ ok: false, duplicate: true });
    expect(outcome.errors[0]).toMatch(/código de barras BC-1/);
  });

  it('reports the inserted id with the error when a step after the insert throws', async () => {
    patientsCollection.updateOne = vi.fn().mockRejectedValue(new Error('patients down'));

    const outcome = await service.processSampleRow(db, VALID_ROW, rowContext());

    expect(outcome).toEqual({
      ok: false,
      errors: ['patients down'],
      data: { participantId: '12345678' },
      sampleId: 'sample-id-1',
    });
  });

  it('names the drug by its name when the candidate has no generic_name (#1337)', async () => {
    const drugService = { searchAndCacheDrug: vi.fn().mockResolvedValue([{ name: 'Acetaminofeno', atcCode: 'N02BE01' }]) };

    const outcome = await service.processSampleRow(
      db,
      { ...VALID_ROW, treatmentStatus: 'TREATED', medicationName: 'Tylenol' },
      rowContext({ drugService })
    );

    expect(outcome.ok).toBe(true);
    expect(drugService.searchAndCacheDrug).toHaveBeenCalledWith('Tylenol', { limit: 5 });
    expect(samplesCollection.insertOne.mock.calls[0][0].pharmacologyData).toMatchObject({
      medicationName: 'Acetaminofeno',
      atcCode: 'N02BE01',
    });
  });

  it('keeps the row drug name when the candidate has neither generic_name nor name (#1337)', async () => {
    const drugService = { searchAndCacheDrug: vi.fn().mockResolvedValue([{ atcCode: 'N02BE01' }]) };

    const outcome = await service.processSampleRow(
      db,
      { ...VALID_ROW, treatmentStatus: 'TREATED', medicationName: 'Tylenol' },
      rowContext({ drugService })
    );

    expect(outcome.ok).toBe(true);
    expect(samplesCollection.insertOne.mock.calls[0][0].pharmacologyData).toMatchObject({
      medicationName: 'Tylenol',
      atcCode: 'N02BE01',
    });
  });

  it('returns the model validation errors for an invalid row, inserting nothing (#1337)', async () => {
    const outcome = await service.processSampleRow(db, { ...VALID_ROW, quantity: '0' }, rowContext());

    expect(outcome).toEqual({
      ok: false,
      errors: ['quantity deve ser maior que zero'],
      data: { participantId: '12345678' },
    });
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('rejects a row whose sampleOrigin is not in the reference data (#1337)', async () => {
    ({ db, samplesCollection, patientsCollection } = makeDb({ sampleOriginFound: false }));

    const outcome = await service.processSampleRow(db, VALID_ROW, rowContext());

    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toEqual(['Origem "VENOUS_BLOOD" não encontrada no banco de dados. Use um valor cadastrado.']);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('rejects a row whose extractionProtocol is not in the reference data (#1337)', async () => {
    ({ db, samplesCollection, patientsCollection } = makeDb({ protocolFound: false }));

    const outcome = await service.processSampleRow(db, VALID_ROW, rowContext());

    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toEqual(['Protocolo de extração "TUBE_EDTA" não encontrado no banco de dados. Use um valor cadastrado.']);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('stamps organizationId as a string when one is set, and null when none is (#1337)', async () => {
    await service.processSampleRow(db, VALID_ROW, rowContext({ organizationId: 77 }));
    expect(samplesCollection.insertOne.mock.calls[0][0].organizationId).toBe('77');

    ({ db, samplesCollection, patientsCollection } = makeDb());
    await service.processSampleRow(db, VALID_ROW, rowContext());
    expect(samplesCollection.insertOne.mock.calls[0][0].organizationId).toBeNull();
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

// ──────────────────────────────────────────────────────────
// #702: the reference-data lookups in importSamples.
//
// makeDb() above stubs the three reference collections with
// `findOne: vi.fn().mockResolvedValue({ description: 'PLASMA' })` -- a
// fabricated document whose `description` holds the *id*, and a findOne that
// ignores its filter entirely. Both halves of that stub hide this bug: the
// shape matches the buggy query rather than the real seed data, and no
// filter is ever evaluated, so the lookup cannot miss.
//
// These tests use the real seed file (miabis.min.json) as the collection
// contents and a findOne that actually applies the filter.
// ──────────────────────────────────────────────────────────
describe('ImportLGPDService.importSamples reference-data lookups (#702)', () => {
  const miabis = require('../../src/reference-data/miabis.min.json');

  let db;

  // Replaces the three reference collections' stubs with the real seeded
  // documents -- `{ id: 'PLASMA', description: 'Plasma', code: ... }` -- behind
  // a findOne that honours the filter it is given.
  function useRealReferenceData(database) {
    for (const name of ['sampleTypes', 'sampleOrigins', 'extractionProtocols']) {
      const docs = miabis[name];
      const collection = database.collection(name);
      collection.findOne = vi.fn(async (filter = {}) =>
        docs.find((doc) => Object.entries(filter).every(([field, value]) => doc[field] === value)) ?? null);
    }
  }

  beforeEach(() => {
    ({ db } = makeDb());
    useRealReferenceData(db);

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

  it('imports a row whose sampleType/sampleOrigin/extractionProtocol are valid MIABIS ids', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    // Before the fix every one of these rows was rejected with
    // 'não encontrado no banco de dados', because the lookup asked for
    // { description: 'PLASMA' } against a document whose description is 'Plasma'.
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(1);
  });

  it('looks the three reference collections up by id, not by description', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(db.collection('sampleTypes').findOne).toHaveBeenCalledWith({ id: 'PLASMA' });
    expect(db.collection('sampleOrigins').findOne).toHaveBeenCalledWith({ id: 'VENOUS_BLOOD' });
    expect(db.collection('extractionProtocols').findOne).toHaveBeenCalledWith({ id: 'TUBE_EDTA' });
  });

  it('still rejects a row whose sampleType is not in the seeded reference data', async () => {
    // SampleModel.validate() screens unknown ids first, so reaching the
    // lookup's own miss path needs an id it accepts but the seed lacks.
    // Proving the reject path is not dead is the point: the fix must not
    // turn an always-miss into an always-hit.
    const collection = db.collection('sampleTypes');
    collection.findOne = vi.fn().mockResolvedValue(null);
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/não encontrado no banco de dados/);
  });
});

// ELM-0128 (#1376): a named collectionSite column is kept when it names a
// registered Organization, and the row is rejected before any participant
// write when it does not. A row naming none still gets the stamped one.
describe('ImportLGPDService.importSamples collectionSite (#1376)', () => {
  let db;
  let samplesCollection;
  let patientsCollection;
  let organizationsCollection;

  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection } = makeDb());
    organizationsCollection = createMatchingCollection([{ organizationId: 'org-b' }], { collectionName: 'organizations' });
    const collection = db.collection;
    db.collection = vi.fn((name) => (name === 'organizations' ? organizationsCollection : collection(name)));

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

  it('keeps a named site that is a registered Organization, with the stamped organizationId', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, collectionSite: 'org-b' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'org-a' });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne.mock.calls[0][0]).toMatchObject({ collectionSite: 'org-b', organizationId: 'org-a' });
  });

  it('rejects a row naming an unregistered site before any participant write', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, collectionSite: 'org-x' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'org-a' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(['collectionSite org-x não encontrado']);
    expect(patientIdentityService.matchOrUpsertParticipant).not.toHaveBeenCalled();
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('fills a row naming no site with the stamped organization, as before', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'org-a' });

    expect(result.success).toBe(1);
    expect(samplesCollection.insertOne.mock.calls[0][0].collectionSite).toBe('org-a');
    expect(organizationsCollection.findOne).not.toHaveBeenCalled();
  });
});
