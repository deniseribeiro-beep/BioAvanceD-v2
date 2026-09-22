import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Load the real singleton modules that the workers reference
// then stub specific methods on them — works in forks pool because
// the workers hold the same module-cache reference we mutate here.
const importLGPDService = require('../../src/services/import-lgpd.service');
const importService = require('../../src/services/import.service');
const fhirService = require('../../src/services/fhir.service');

const patientWorker = require('../../src/workers/workers/patient-worker');
const temperatureWorker = require('../../src/workers/workers/temperature-worker');
const sampleWorker = require('../../src/workers/workers/sample-worker');
const resultWorker = require('../../src/workers/workers/result-worker');

const NON_EXISTENT = '/this/path/does/not/exist/workers-test-file.csv';

let tmpFile;

function makeCursor(rows = []) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function makeDb(rows = []) {
  return {
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue(makeCursor(rows)),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'ins-1' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    }),
  };
}

// Stubs installed on the real singleton objects — restored in afterEach
const stubs = {};

function stub(obj, method) {
  if (!stubs[method]) {
    stubs[method] = { obj, original: obj[method] };
    obj[method] = vi.fn();
  }
  return obj[method];
}

beforeEach(() => {
  // Stub every method we need across all workers
  stub(importLGPDService, 'importPatients');
  stub(importLGPDService, 'importSamples');
  stub(importService, 'importTemperature');
  stub(fhirService, 'patientToFHIR');
  stub(fhirService, 'sampleToFHIR');
  stub(fhirService, 'temperatureToFHIR');
  stub(fhirService, 'validateFHIRResource');
  stub(fhirService, 'findResourceByIdentifier');

  tmpFile = path.join(os.tmpdir(), `worker-test-${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, 'col1,col2\nval1,val2\n');
});

afterEach(() => {
  // Restore originals and clear the stubs registry for next test
  for (const [, { obj, original }] of Object.entries(stubs)) {
    // We'll just clear the mock state rather than restore — simpler
    void original;
  }
  Object.keys(stubs).forEach((k) => delete stubs[k]);

  if (fs.existsSync(tmpFile)) { fs.unlinkSync(tmpFile); }
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────
// PatientWorker
// ──────────────────────────────────────────────────────────
describe('PatientWorker', () => {
  it('throws when file does not exist', async () => {
    await expect(patientWorker.process(makeDb(), 'job-1', NON_EXISTENT)).rejects.toThrow('Arquivo não encontrado');
  });

  it('returns result summary with no recent patients', async () => {
    importLGPDService.importPatients.mockResolvedValue({ total: 0, success: 0, errors: [] });

    const result = await patientWorker.process(makeDb([]), 'job-1', tmpFile);

    expect(result).toHaveProperty('total', 0);
    expect(result).toHaveProperty('success', 0);
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('processingTime');
    expect(result.fhirResourcesCreated).toBeUndefined();
  });

  it('does not perform FHIR conversion (removed from executable path, see #212/canonical-data-cleanup)', async () => {
    const fakePatient = { _id: 'p1', participantId: '12345678' };
    importLGPDService.importPatients.mockResolvedValue({ total: 1, success: 1, errors: [] });

    const db = makeDb([fakePatient]);
    const result = await patientWorker.process(db, 'job-1', tmpFile, { fileName: 'patients.csv' });

    expect(fhirService.patientToFHIR).not.toHaveBeenCalled();
    expect(result).toEqual({
      total: 1,
      success: 1,
      errors: [],
      processingTime: expect.any(Number),
    });
  });

  // #969: this file's other assertions all passed because the stubbed service
  // returns a shape `importPatients` never emits. `toEqual` ignores keys whose
  // value is `undefined`, so `duplicates: results.duplicates` reading a key
  // that was not in the return literal was invisible here AND in the assertion
  // above. Drive the worker over the REAL return shape instead.
  it('#969: propagates `duplicates` from the service return (real shape, not the trimmed stub)', async () => {
    importLGPDService.importPatients.mockResolvedValue({
      total: 4,
      success: 1,
      errors: [{ row: 2 }, { row: 3 }, { row: 4 }],
      skipped: 0,
      duplicates: 2,
      stagingBatchId: 'batch-969',
    });

    const result = await patientWorker.process(makeDb([]), 'job-969', tmpFile);

    expect(result.duplicates).toBe(2);
    expect(result).toHaveProperty('duplicates');
  });
});

// ──────────────────────────────────────────────────────────
// TemperatureWorker
// ──────────────────────────────────────────────────────────
describe('TemperatureWorker', () => {
  it('throws when file does not exist', async () => {
    await expect(temperatureWorker.process(makeDb(), 'job-2', NON_EXISTENT)).rejects.toThrow('Arquivo não encontrado');
  });

  it('returns result summary with no recent temperatures', async () => {
    importService.importTemperature.mockResolvedValue({ total: 0, success: 0, errors: [] });

    const result = await temperatureWorker.process(makeDb([]), 'job-2', tmpFile);

    expect(result).toHaveProperty('total', 0);
    expect(result.fhirResourcesCreated).toBeUndefined();
    expect(typeof result.processingTime).toBe('number');
  });

  it('does not perform FHIR conversion (removed from executable path, see #212/canonical-data-cleanup)', async () => {
    const fakeTemp = { _id: 't1', sensorId: 'S-001', value: 4.5 };
    importService.importTemperature.mockResolvedValue({ total: 1, success: 1, errors: [] });

    const db = makeDb([fakeTemp]);
    const result = await temperatureWorker.process(db, 'job-2', tmpFile);

    expect(fhirService.temperatureToFHIR).not.toHaveBeenCalled();
    expect(result).toEqual({
      total: 1,
      success: 1,
      errors: [],
      processingTime: expect.any(Number),
    });
  });
});

// ──────────────────────────────────────────────────────────
// SampleWorker
// ──────────────────────────────────────────────────────────
describe('SampleWorker', () => {
  it('throws when file does not exist', async () => {
    await expect(sampleWorker.process(makeDb(), 'job-3', NON_EXISTENT)).rejects.toThrow('Arquivo não encontrado');
  });

  it('returns result summary with no samples', async () => {
    importLGPDService.importSamples.mockResolvedValue({ total: 0, success: 0, errors: [], importedSampleIds: [] });

    const result = await sampleWorker.process(makeDb([]), 'job-3', tmpFile);

    expect(result).toHaveProperty('total', 0);
    expect(result.fhirResourcesCreated).toBeUndefined();
  });

  it('does not perform FHIR conversion (removed from executable path, see #212/canonical-data-cleanup)', async () => {
    const fakeSample = { _id: 's1', specimenId: 'SMP-001' };
    importLGPDService.importSamples.mockResolvedValue({
      total: 1, success: 1, errors: [], importedSampleIds: ['s1']
    });

    const db = makeDb([fakeSample]);
    const result = await sampleWorker.process(db, 'job-3', tmpFile);

    expect(fhirService.sampleToFHIR).not.toHaveBeenCalled();
    expect(result).toEqual({
      total: 1,
      success: 1,
      errors: [],
      processingTime: expect.any(Number),
    });
  });

  // #969: same blindness as PatientWorker's — see the note there.
  it('#969: propagates `duplicates` from the service return (real shape, not the trimmed stub)', async () => {
    importLGPDService.importSamples.mockResolvedValue({
      total: 3,
      success: 1,
      errors: [{ row: 2 }, { row: 3 }],
      skipped: 0,
      duplicates: 2,
      importedSampleIds: ['s1'],
      stagingBatchId: 'batch-969',
    });

    const result = await sampleWorker.process(makeDb([]), 'job-969', tmpFile);

    expect(result.duplicates).toBe(2);
    expect(result).toHaveProperty('duplicates');
  });
});

// ──────────────────────────────────────────────────────────
// ResultWorker
// ──────────────────────────────────────────────────────────
describe('ResultWorker', () => {
  it('throws when file does not exist', async () => {
    await expect(resultWorker.process(makeDb(), 'job-4', NON_EXISTENT + '.zip')).rejects.toThrow('Arquivo não encontrado');
  });

  it('throws for unsupported file extension when file exists', async () => {
    const pdfFile = tmpFile.replace(/\.csv$/, '.pdf');
    fs.writeFileSync(pdfFile, 'dummy content');
    try {
      await expect(resultWorker.process(makeDb(), 'job-4', pdfFile)).rejects.toThrow('Formato de arquivo não suportado');
    } finally {
      if (fs.existsSync(pdfFile)) { fs.unlinkSync(pdfFile); }
    }
  });
});
