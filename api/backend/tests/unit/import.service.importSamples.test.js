import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');
const SampleGraphValidator = require2('../../src/services/SampleGraphValidator');
const qualityDomain = require2('../../src/services/quality-domain.service');
const governanceEvidenceResolver = require2('../../src/services/governance-evidence-resolver.service');
const sampleCollectionGate = require2('../../src/services/sample-collection-gate.service');
const { createMatchingCollection } = require2('../factories/filter.factory');
const env = require2('../../src/config/env');

const tmpFiles = [];

function writeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `import-service-samples-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  tmpFiles.push(filePath);
  return filePath;
}

function makeSamplesCollection() {
  const inserted = [];
  const updates = [];
  return {
    inserted,
    updates,
    findOne: async () => null,
    insertOne: async (doc) => {
      inserted.push(doc);
      return { insertedId: `sample-${inserted.length}` };
    },
    updateOne: async (query, update) => {
      updates.push({ query, update });
      return { modifiedCount: 1 };
    },
  };
}

function makeRcsAssessmentsCollection() {
  const inserted = [];
  return {
    inserted,
    // Mirrors the real MongoDB driver, which mutates the passed document
    // with the generated _id — recordAssessment's caller relies on this to
    // pin the sample to the returned snapshot's _id (#502, #506).
    insertOne: async (doc) => {
      doc._id = `rcs-${inserted.length + 1}`;
      inserted.push(doc);
      return { insertedId: doc._id };
    },
  };
}

function makeSpecimenPreanalyticsCollection() {
  const inserted = [];
  return {
    inserted,
    // Same real-driver _id mutation as rcsAssessmentsCollection above, for
    // recordProfile's caller (#502, #506).
    insertOne: async (doc) => {
      doc._id = `preanalytics-${inserted.length + 1}`;
      inserted.push(doc);
      return { insertedId: doc._id };
    },
  };
}

// #1225: each imported sample appends a SPECIMEN_UPSERTED outbox event. Its
// own collection keeps that upsert out of the samples collection's updates.
function makeOutboxCollection() {
  const events = [];
  return {
    events,
    createIndex: async () => true,
    updateOne: async (query, update) => {
      events.push(update.$setOnInsert);
      return { upsertedCount: 1 };
    },
  };
}

// #1313: the outbox's per-aggregate version counter.
function makeAggregateVersionsCollection() {
  const versions = new Map();
  return {
    findOneAndUpdate: async (query) => {
      const version = (versions.get(query._id) || 0) + 1;
      versions.set(query._id, version);
      return { _id: query._id, version };
    },
  };
}

// #1378: a row that gives a barcode is issued a LabelIdentifier on a
// container created and loaded for it, after the legacy placement
// (storageAssignments) it would adopt is read.
const PHYSICAL_CHAIN_COLLECTIONS = ['containers', 'specimenContainerAssignments', 'labelIdentifiers', 'storageAssignments'];

function makeDb(collection, rcsAssessmentsCollection = makeRcsAssessmentsCollection(), specimenPreanalyticsCollection = makeSpecimenPreanalyticsCollection(), outboxCollection = makeOutboxCollection()) {
  const aggregateVersionsCollection = makeAggregateVersionsCollection();
  // #1320: recordAssessment first freezes the RCS input in its own collection.
  const rcsInputSnapshotsCollection = createMatchingCollection([], { collectionName: 'rcsInputSnapshots' });
  const rcsGovernanceEvidenceSnapshotsCollection = createMatchingCollection([], { collectionName: 'rcsGovernanceEvidenceSnapshots' });
  const physicalChain = Object.fromEntries(PHYSICAL_CHAIN_COLLECTIONS.map((name) => [name, createMatchingCollection([], { collectionName: name })]));
  return {
    outboxCollection,
    physicalChain,
    collection: (name) => {
      if (physicalChain[name]) return physicalChain[name];
      if (name === 'rcsAssessments') return rcsAssessmentsCollection;
      if (name === 'rcsInputSnapshots') return rcsInputSnapshotsCollection;
      if (name === 'rcsGovernanceEvidenceSnapshots') return rcsGovernanceEvidenceSnapshotsCollection;
      if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
      if (name === 'graph_projection_outbox') return outboxCollection;
      if (name === 'graph_projection_outbox_aggregate_versions') return aggregateVersionsCollection;
      return collection;
    },
  };
}

const validSample = (overrides = {}) => ({
  participantId: '12345678',
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  quantity: 1.5,
  quality: 'GOOD',
  linkedProject: 'Projeto QA',
  registeredAt: '2026-01-01',
  ...overrides,
});

// RF004 AC2 (#1538): every row passes the collection gate; the cases below
// that are about other rules admit it, and the gate's own cases restore it.
beforeEach(() => {
  vi.spyOn(sampleCollectionGate, 'assertSampleCollectionAdmits').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

// RNF018 AC4 (#1537): the assessment certification returns, shaped as the
// quality domain shapes it; a JSON row's own grade never stands in for it.
const certifiedAssessment = () => ({
  governance_status: 1,
  final_grade: 'A',
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

describe('ImportService.importSamples (JSON)', () => {
  it('inserts a valid sample and pins the SpecimenPreanalytics snapshot when ethics/sprec are complete', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'AVAILABLE' });
    const filePath = writeTmpFile('valid.json', JSON.stringify(validSample({
      consentTemplateId: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();
    const db = makeDb(collection);

    const result = await importService.importSamples(db, { path: filePath, originalname: 'valid.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.updates).toHaveLength(2);
    expect(collection.updates.find((call) => call.update?.$set?.sealedRcsAssessmentId)).toBeDefined();
    // #1225: the imported sample reaches the graph under its Mongo _id with its donor.
    expect(db.outboxCollection.events).toHaveLength(1);
    expect(db.outboxCollection.events[0]).toMatchObject({
      eventType: 'SPECIMEN_UPSERTED',
      aggregateId: 'sample-1',
      payload: { specimenId: 'sample-1', participantId: '12345678' },
    });
    const sprecPinUpdate = collection.updates.find((call) => call.update?.$set?.sealedSpecimenPreanalyticsId);
    expect(sprecPinUpdate.update.$set.sealedSpecimenPreanalyticsId).toBe('preanalytics-1');
  });

  it('forces QUARANTINE (no update needed) when tcle_id/sprec ethics data is missing, since it defaults to QUARANTINE already', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'AVAILABLE' });
    const filePath = writeTmpFile('no-ethics.json', JSON.stringify(validSample()));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'no-ethics.json' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(0);
  });

  it('still pins the SpecimenPreanalytics snapshot and logs a warning when compliance validation throws', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockRejectedValue(new Error('graph unavailable'));
    const filePath = writeTmpFile('compliance-fails.json', JSON.stringify(validSample({
      consentTemplateId: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'compliance-fails.json' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(2);
    expect(collection.updates.find((call) => call.update?.$set?.sealedRcsAssessmentId)).toBeDefined();
    const sprecPinUpdate = collection.updates.find((call) => call.update?.$set?.sealedSpecimenPreanalyticsId);
    expect(sprecPinUpdate.update.$set.sealedSpecimenPreanalyticsId).toBe('preanalytics-1');
  });

  it('records a model-validation error and does not insert when participantId is missing', async () => {
    const filePath = writeTmpFile('invalid.json', JSON.stringify({ sampleType: 'PLASMA' }));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'invalid.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors[0].errors.length).toBeGreaterThan(0);
    expect(collection.inserted).toHaveLength(0);
  });

  it('imports an array of JSON samples, counting both the success and the invalid row in total', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('array.json', JSON.stringify([
      validSample(),
      { sampleType: 'PLASMA' },
    ]));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'array.json' });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('records an error and continues when insertOne rejects', async () => {
    const filePath = writeTmpFile('insert-fails.json', JSON.stringify(validSample()));
    const collection = makeSamplesCollection();
    collection.insertOne = async () => { throw new Error('duplicate key'); };

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'insert-fails.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: 'duplicate key' }),
    ]);
  });

  it('certifies a JSON row from its sprec and stores no grade the row carries (RNF018 AC4, #1537)', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue(certifiedAssessment());
    const sprec = { sampleType: 'BLD', primaryContainer: 'SST' };
    const filePath = writeTmpFile('forged-grade.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-1',
      sprec,
      rcsEvaluation: { rcs_score: 12, final_grade: 'E', score_based_grade: 'E' },
      rcsScore: 12,
      finalGrade: 'E',
    })));
    const collection = makeSamplesCollection();
    const rcsAssessmentsCollection = makeRcsAssessmentsCollection();

    const result = await importService.importSamples(makeDb(collection, rcsAssessmentsCollection), { path: filePath, originalname: 'forged-grade.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(qualityDomain.resolveMethodologicalQuality).toHaveBeenCalledWith({ sprec });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0].rcsEvaluation).toEqual(certifiedAssessment());
    expect(collection.inserted[0].rcsScore).toBe(87.5);
    expect(collection.inserted[0].finalGrade).toBe('A');
    expect(rcsAssessmentsCollection.inserted).toHaveLength(1);
    expect(rcsAssessmentsCollection.inserted[0]).toEqual(expect.objectContaining({
      specimenId: 'SPEC-JSON-1',
      rcsScore: 87.5,
      finalGrade: 'A',
    }));
    const rcsPinUpdate = collection.updates.find((call) => call.update?.$set?.sealedRcsAssessmentId);
    expect(rcsPinUpdate.update.$set.sealedRcsAssessmentId).toBe('rcs-1');
  });

  it('stores no RCS result and records no RcsAssessment for a JSON row that carries a grade but no sprec (RNF018 AC4, #1537)', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('grade-no-sprec.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-5',
      rcsEvaluation: { rcs_score: 99, final_grade: 'A', score_based_grade: 'A' },
      rcsScore: 99,
      finalGrade: 'A',
      sealedRcsAssessmentId: 'forged-assessment',
    })));
    const collection = makeSamplesCollection();
    const rcsAssessmentsCollection = makeRcsAssessmentsCollection();

    const result = await importService.importSamples(makeDb(collection, rcsAssessmentsCollection), { path: filePath, originalname: 'grade-no-sprec.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(rcsAssessmentsCollection.inserted).toEqual([]);
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0].rcsEvaluation ?? null).toBeNull();
    expect(collection.inserted[0].rcsScore ?? null).toBeNull();
    expect(collection.inserted[0].sealedRcsAssessmentId ?? null).toBeNull();
  });

  it("resolves a JSON row's governanceEvidence before certification and never reads its governanceEvidenceResolution (RNF018 AC5, #1537)", async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const resolution = { marker: 'resolved-by-the-server' };
    vi.spyOn(governanceEvidenceResolver, 'resolveGovernanceEvidence').mockResolvedValue(resolution);
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue(certifiedAssessment());
    const governanceEvidence = { documentation: [{ uri: 'urn:doc:1', hash: 'abc' }] };
    const filePath = writeTmpFile('with-evidence.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-6',
      sprec: { sampleType: 'BLD', primaryContainer: 'SST' },
      governanceEvidence,
      governanceEvidenceResolution: { forged: true },
    })));
    const collection = makeSamplesCollection();
    const db = makeDb(collection);

    const result = await importService.importSamples(db, { path: filePath, originalname: 'with-evidence.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(governanceEvidenceResolver.resolveGovernanceEvidence).toHaveBeenCalledWith(db, { governanceEvidence, specimenId: 'SPEC-JSON-6' });
    expect(qualityDomain.resolveMethodologicalQuality).toHaveBeenCalledTimes(1);
    expect(qualityDomain.resolveMethodologicalQuality.mock.calls[0][1]).toEqual({ governanceEvidenceResolution: resolution });
  });

  it('logs a warning and still counts the row as success when recordAssessment rejects', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('rcs-record-fails.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-2',
      sprec: { sampleType: 'BLD', primaryContainer: 'SST' },
    })));
    const collection = makeSamplesCollection();
    const rcsAssessmentsCollection = makeRcsAssessmentsCollection();
    rcsAssessmentsCollection.insertOne = async () => { throw new Error('rcsAssessments write failed'); };

    const result = await importService.importSamples(makeDb(collection, rcsAssessmentsCollection), { path: filePath, originalname: 'rcs-record-fails.json' });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('records a referenced SpecimenPreanalytics snapshot when the imported sample carries sprec (#493)', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('with-sprec.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-3',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();
    const specimenPreanalyticsCollection = makeSpecimenPreanalyticsCollection();

    const result = await importService.importSamples(makeDb(collection, undefined, specimenPreanalyticsCollection), { path: filePath, originalname: 'with-sprec.json' });

    expect(result.success).toBe(1);
    expect(specimenPreanalyticsCollection.inserted).toHaveLength(1);
    expect(specimenPreanalyticsCollection.inserted[0]).toEqual(expect.objectContaining({
      specimenId: 'SPEC-JSON-3',
      sampleType: 'BLD',
      primaryContainer: 'PED',
    }));
    const sprecPinUpdate = collection.updates.find((call) => call.update?.$set?.sealedSpecimenPreanalyticsId);
    expect(sprecPinUpdate.update.$set.sealedSpecimenPreanalyticsId).toBe('preanalytics-1');
  });

  it('logs a warning and still counts the row as success when recordProfile rejects (#493)', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('sprec-record-fails.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-4',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();
    const specimenPreanalyticsCollection = makeSpecimenPreanalyticsCollection();
    specimenPreanalyticsCollection.insertOne = async () => { throw new Error('specimenPreanalytics write failed'); };

    const result = await importService.importSamples(makeDb(collection, undefined, specimenPreanalyticsCollection), { path: filePath, originalname: 'sprec-record-fails.json' });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
  });
});

describe('ImportService.importSamples (JSON) LabelIdentifier issue (#1378)', () => {
  beforeEach(() => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
  });

  it('issues a row with a barcode one active LabelIdentifier on its one container', async () => {
    const filePath = writeTmpFile('labelled.json', JSON.stringify(validSample({ barcode: '  BC-IMPORT-1 ' })));
    const db = makeDb(makeSamplesCollection());

    const result = await importService.importSamples(db, { path: filePath, originalname: 'labelled.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    const { containers, specimenContainerAssignments, labelIdentifiers } = db.physicalChain;
    expect(containers.docs).toHaveLength(1);
    const { containerId } = containers.docs[0];
    expect(specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({ containerId, sourceEventId: expect.stringMatching(/^specimen-label-issuance:sample-1:/) }),
    ]);
    expect(labelIdentifiers.docs).toEqual([
      expect.objectContaining({
        encodedValue: 'BC-IMPORT-1',
        targetType: 'container',
        targetId: containerId,
        identifierOrigin: 'institution_applied',
        status: 'active',
        printBatchId: null,
      }),
    ]);
  });

  it('issues no label to a row without a barcode, since this import generates none', async () => {
    const filePath = writeTmpFile('unlabelled.json', JSON.stringify(validSample()));
    const db = makeDb(makeSamplesCollection());

    const result = await importService.importSamples(db, { path: filePath, originalname: 'unlabelled.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(db.physicalChain.labelIdentifiers.docs).toEqual([]);
    expect(db.physicalChain.containers.docs).toEqual([]);
  });

  it('records a row error when its barcode is already an active label', async () => {
    const filePath = writeTmpFile('taken.json', JSON.stringify(validSample({ barcode: 'BC-TAKEN-1' })));
    const db = makeDb(makeSamplesCollection());
    db.physicalChain.labelIdentifiers.insertOne = vi.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    const result = await importService.importSamples(db, { path: filePath, originalname: 'taken.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([{ row: 1, error: expect.stringMatching(/BC-TAKEN-1 já ativo/) }]);
  });
});

// #1378 (ELM-0116): once the migration window is closed, a row's code is
// issued only as the label; the inserted sample carries no Sample.barcode.
describe('ImportService.importSamples with the barcode window closed (#1378)', () => {
  let saved;
  beforeEach(() => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    saved = env.SAMPLE_BARCODE_WINDOW_CLOSED;
    env.SAMPLE_BARCODE_WINDOW_CLOSED = true;
  });
  afterEach(() => {
    env.SAMPLE_BARCODE_WINDOW_CLOSED = saved;
  });

  it('a JSON row inserts no barcode and is issued the label with its code', async () => {
    const filePath = writeTmpFile('closed.json', JSON.stringify(validSample({ barcode: 'BC-CLOSED-1' })));
    const collection = makeSamplesCollection();
    const db = makeDb(collection);

    const result = await importService.importSamples(db, { path: filePath, originalname: 'closed.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0]).not.toHaveProperty('barcode');
    expect(db.physicalChain.labelIdentifiers.docs).toEqual([expect.objectContaining({ encodedValue: 'BC-CLOSED-1', status: 'active' })]);
  });

  it('a CSV row inserts no barcode and is issued the label with its code', async () => {
    const filePath = writeTmpFile(
      'closed.csv',
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt,barcode\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01,BC-CLOSED-2\n',
    );
    const collection = makeSamplesCollection();
    const db = makeDb(collection);

    const result = await importService.importSamples(db, { path: filePath, originalname: 'closed.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0]).not.toHaveProperty('barcode');
    expect(db.physicalChain.labelIdentifiers.docs).toEqual([expect.objectContaining({ encodedValue: 'BC-CLOSED-2', status: 'active' })]);
  });
});

describe('ImportService.importSamples (CSV)', () => {
  it('short-circuits with a structural error when required CSV columns are missing', async () => {
    const filePath = writeTmpFile('bad-structure.csv', 'foo,bar\n1,2\n');
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'bad-structure.csv' });

    expect(result).toEqual({ success: 0, errors: [{ row: 0, error: expect.stringContaining('participantId') }], total: 0 });
    expect(collection.inserted).toHaveLength(0);
  });

  it('records a parse error (non-numeric quantity) without stopping the batch, counting it in total', async () => {
    const filePath = writeTmpFile(
      'parse-error.csv',
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,notanumber,GOOD,Projeto QA,2026-01-01\n',
    );
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'parse-error.csv' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('quantity')]));
    expect(collection.inserted).toHaveLength(0);
  });

  it('records a model-validation error for a row with an invalid sampleType, counting it in total', async () => {
    const filePath = writeTmpFile(
      'invalid-row.csv',
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt\n12345678,NOT_A_TYPE,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n',
    );
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'invalid-row.csv' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors[0].errors.length).toBeGreaterThan(0);
    expect(collection.inserted).toHaveLength(0);
  });

  it('inserts a valid CSV row (no ethics/sprec data) and logs a warning after a failed compliance check', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockRejectedValue(new Error('graph down'));
    const filePath = writeTmpFile(
      'valid-row.csv',
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n',
    );
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'valid-row.csv' });

    expect(result.success).toBe(1);
    // #536 removed the releaseStatus fallback write this test used to pin —
    // confirm the deleted field never resurfaces.
    for (const u of collection.updates) {
      expect(u.update.$set || {}).not.toHaveProperty('releaseStatus');
    }
  });

  it('short-circuits with a structural error naming the read failure when the CSV does not exist (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `does-not-exist-samples-${Date.now()}.csv`);
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: missingPath, originalname: 'missing.csv' });

    expect(result).toEqual({ success: 0, errors: [{ row: 0, error: expect.stringContaining('ENOENT') }], total: 0 });
  });

  // #1175: the row read is a second stream, after validateCSVStructure's own.
  // Its source 'error' was never listened for, so a file removed between the
  // two reads crashed the process instead of rejecting.
  it('rejects when the row read fails after the structure check passed (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `does-not-exist-samples-${Date.now()}.csv`);
    vi.spyOn(importService, 'validateCSVStructure').mockResolvedValueOnce({ valid: true });
    const collection = makeSamplesCollection();

    await expect(importService.importSamples(makeDb(collection), { path: missingPath, originalname: 'missing.csv' }))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// RF004 AC2, ELM-0118 (Specimen.collectionId 1..1 Core, #1538): an imported
// row enters only a collection the gate createSample runs admits.
describe('ImportService.importSamples runs the collection gate (#1538)', () => {
  const CSV_HEADER = 'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt,collectionId';

  it('refuses a JSON row that names no collection and inserts nothing', async () => {
    sampleCollectionGate.assertSampleCollectionAdmits.mockRestore();
    const filePath = writeTmpFile('no-collection.json', JSON.stringify(validSample()));
    const collection = makeSamplesCollection();
    const insertOne = vi.spyOn(collection, 'insertOne');

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'no-collection.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 1, error: expect.stringMatching(/collectionId é obrigatório/) }),
    ]);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('refuses a CSV row whose collectionId cell is empty and inserts nothing', async () => {
    sampleCollectionGate.assertSampleCollectionAdmits.mockRestore();
    const filePath = writeTmpFile('no-collection.csv', `${CSV_HEADER}\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01,\n`);
    const collection = makeSamplesCollection();
    const insertOne = vi.spyOn(collection, 'insertOne');

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'no-collection.csv' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 1, error: expect.stringMatching(/collectionId é obrigatório/) }),
    ]);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("hands the gate a CSV row's trimmed collectionId", async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('collection.csv', `${CSV_HEADER}\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01, COL-1 \n`);
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'collection.csv' });

    expect(result.success).toBe(1);
    expect(sampleCollectionGate.assertSampleCollectionAdmits).toHaveBeenCalledTimes(1);
    const [, sampleData] = sampleCollectionGate.assertSampleCollectionAdmits.mock.calls[0];
    expect(sampleData.collectionId).toBe('COL-1');
  });
});

// #1376, #1192: the organization the caller's scope resolved is the
// sample's tenancy key; a row never supplies it.
describe('ImportService.importSamples stamps the caller organization (#1376)', () => {
  const CSV_HEADER = 'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt';

  beforeEach(() => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
  });

  it('a JSON row is stamped with the organization and takes it as its site', async () => {
    const filePath = writeTmpFile('org.json', JSON.stringify(validSample()));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'org.json' }, { organizationId: 'org-a' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted[0]).toMatchObject({ organizationId: 'org-a', collectionSite: 'org-a' });
  });

  it('a CSV row is stamped with the organization and takes it as its site', async () => {
    const filePath = writeTmpFile('org.csv', `${CSV_HEADER}\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n`);
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'org.csv' }, { organizationId: 'org-a' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted[0]).toMatchObject({ organizationId: 'org-a', collectionSite: 'org-a' });
  });

  it('a JSON row naming its collection site keeps it and is still stamped with the organization', async () => {
    const filePath = writeTmpFile('org-site.json', JSON.stringify(validSample({ collectionSite: 'org-b' })));
    const collection = makeSamplesCollection();

    await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'org-site.json' }, { organizationId: 'org-a' });

    expect(collection.inserted[0]).toMatchObject({ organizationId: 'org-a', collectionSite: 'org-b' });
  });

  it("a JSON row carrying its own organizationId is stamped with the caller's instead", async () => {
    const filePath = writeTmpFile('org-row.json', JSON.stringify(validSample({ organizationId: 'org-x' })));
    const collection = makeSamplesCollection();

    await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'org-row.json' }, { organizationId: 'org-a' });

    expect(collection.inserted[0].organizationId).toBe('org-a');
  });

  it('with no organization resolved a row keeps organizationId null, as before', async () => {
    const filePath = writeTmpFile('no-org.json', JSON.stringify(validSample({ organizationId: 'org-x' })));
    const collection = makeSamplesCollection();

    await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'no-org.json' });

    expect(collection.inserted[0].organizationId).toBeNull();
    expect(collection.inserted[0].collectionSite).toBeNull();
  });
});

describe('ImportService.importSamples (unsupported extension / top-level error)', () => {
  it('returns empty results for an unsupported file extension', async () => {
    const filePath = writeTmpFile('data.txt', 'irrelevant');
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'data.txt' });

    expect(result).toEqual({ success: 0, errors: [], total: 0 });
  });

  it('rejects when the JSON file does not exist', async () => {
    const collection = makeSamplesCollection();
    await expect(importService.importSamples(makeDb(collection), {
      path: path.join(os.tmpdir(), 'does-not-exist-samples.json'),
      originalname: 'does-not-exist-samples.json',
    })).rejects.toThrow();
  });
});
