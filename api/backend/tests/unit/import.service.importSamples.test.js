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

function makeDb(collection) {
  return { collection: () => collection };
}

const validSample = (overrides = {}) => ({
  patientID: '12345678',
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  quantity: 1.5,
  quality: 'GOOD',
  linkedProject: 'Projeto QA',
  registerDate: '2026-01-01',
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
      tcle_id: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'valid.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.updates).toHaveLength(1);
    expect(collection.updates[0].update.$set.release_status).toBe('AVAILABLE');
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
      tcle_id: 'tcle-1',
      sprec: { sampleType: 'BLD', primaryContainer: 'PED' },
    })));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'compliance-fails.json' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(1);
    expect(collection.updates[0].update.$set.release_status).toBe('QUARANTINE');
  });

  // NOTE: `total` does NOT count this row (documenting a real bug, not asserting
  // desired behavior) - the JSON branch's `continue` on a validation failure skips
  // the `results.total++` at the bottom of the loop; the CSV/XLSX branch of this
  // same method does not have this bug (it increments total explicitly before its
  // own `continue`s). Same undercounting pattern as #79/#65/#86, filed for this
  // JSON branch as issue #88.
  it('records a model-validation error and does not insert when patientID is missing (total undercounts due to a known bug)', async () => {
    const filePath = writeTmpFile('invalid.json', JSON.stringify({ sampleType: 'PLASMA' }));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'invalid.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(0);
    expect(result.errors[0].errors.length).toBeGreaterThan(0);
    expect(collection.inserted).toHaveLength(0);
  });

  // NOTE: `total` ends at 1, not 2 - same known-bug undercounting as above (issue #88).
  it('imports an array of JSON samples, counting the success but total undercounts the invalid row (known bug)', async () => {
    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({ suggestedStatus: 'QUARANTINE' });
    const filePath = writeTmpFile('array.json', JSON.stringify([
      validSample(),
      { sampleType: 'PLASMA' },
    ]));
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'array.json' });

    expect(result.total).toBe(1);
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
});

describe('ImportService.importSamples (CSV)', () => {
  it('short-circuits with a structural error when required CSV columns are missing', async () => {
    const filePath = writeTmpFile('bad-structure.csv', 'foo,bar\n1,2\n');
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'bad-structure.csv' });

    expect(result).toEqual({ success: 0, errors: [{ row: 0, error: expect.stringContaining('patientID') }], total: 0 });
    expect(collection.inserted).toHaveLength(0);
  });

  it('records a parse error (non-numeric quantity) without stopping the batch, counting it in total', async () => {
    const filePath = writeTmpFile(
      'parse-error.csv',
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registerDate\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,notanumber,GOOD,Projeto QA,2026-01-01\n',
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
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registerDate\n12345678,NOT_A_TYPE,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n',
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
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,registerDate\n12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,Projeto QA,2026-01-01\n',
    );
    const collection = makeSamplesCollection();

    const result = await importService.importSamples(makeDb(collection), { path: filePath, originalname: 'valid-row.csv' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(1);
    expect(collection.updates[0].update.$set.release_status).toBe('QUARANTINE');
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
