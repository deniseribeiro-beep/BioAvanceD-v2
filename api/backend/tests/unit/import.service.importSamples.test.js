import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');
const SampleGraphValidator = require2('../../src/services/SampleGraphValidator');

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

function makeDb(collection, rcsAssessmentsCollection = makeRcsAssessmentsCollection(), specimenPreanalyticsCollection = makeSpecimenPreanalyticsCollection()) {
  return {
    collection: (name) => {
      if (name === 'rcsAssessments') return rcsAssessmentsCollection;
      if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
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

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

describe('ImportService.importSamples (JSON)', () => {
  it('inserts a valid sample and upgrades release_status to AVAILABLE when ethics/sprec are complete', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'AVAILABLE' });
    const filePath = writeTmpFile('valid.json', JSON.stringify(validSample({
      consentTemplateId: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'valid.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.updates).toHaveLength(2);
    const releaseStatusUpdate = collection.updates.find((call) => call.update?.$set?.releaseStatus);
    expect(releaseStatusUpdate.update.$set.releaseStatus).toBe('AVAILABLE');
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

  it('keeps the sample in QUARANTINE and logs a warning when compliance validation throws', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockRejectedValue(new Error('graph unavailable'));
    const filePath = writeTmpFile('compliance-fails.json', JSON.stringify(validSample({
      consentTemplateId: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'compliance-fails.json' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(2);
    const releaseStatusUpdate = collection.updates.find((call) => call.update?.$set?.releaseStatus);
    expect(releaseStatusUpdate.update.$set.releaseStatus).toBe('QUARANTINE');
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

  it('records a referenced RcsAssessment snapshot when the imported sample carries rcsEvaluation', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('with-rcs.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-1',
      rcsEvaluation: { rcs_score: 87, score_based_grade: 'B' },
    })));
    const collection = makeSamplesCollection();
    const rcsAssessmentsCollection = makeRcsAssessmentsCollection();

    const result = await importService.importSamples(makeDb(collection, rcsAssessmentsCollection), { path: filePath, originalname: 'with-rcs.json' });

    expect(result.success).toBe(1);
    expect(rcsAssessmentsCollection.inserted).toHaveLength(1);
    expect(rcsAssessmentsCollection.inserted[0]).toEqual(expect.objectContaining({
      specimenId: 'SPEC-JSON-1',
      rcsScore: 87,
      scoreBasedGrade: 'B',
    }));
    const rcsPinUpdate = collection.updates.find((call) => call.update?.$set?.sealedRcsAssessmentId);
    expect(rcsPinUpdate.update.$set.sealedRcsAssessmentId).toBe('rcs-1');
  });

  it('logs a warning and still counts the row as success when recordAssessment rejects', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('rcs-record-fails.json', JSON.stringify(validSample({
      specimenId: 'SPEC-JSON-2',
      rcsEvaluation: { rcs_score: 50, score_based_grade: 'C' },
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

  it('inserts a valid CSV row and keeps QUARANTINE (no ethics/sprec data) after a failed compliance check, logging a warning', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockRejectedValue(new Error('graph down'));
    const filePath = writeTmpFile(
      'valid-row.csv',
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registeredAt\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n',
    );
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'valid-row.csv' });

    expect(result.success).toBe(1);
    // #502: recording the RcsAssessment/SpecimenPreanalytics snapshot each
    // pins the sample via its own updateOne — this test only asserts the
    // releaseStatus fallback itself, not the total update count.
    const releaseStatusUpdate = collection.updates.find((u) => 'releaseStatus' in (u.update.$set || {}));
    expect(releaseStatusUpdate.update.$set.releaseStatus).toBe('QUARANTINE');
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
