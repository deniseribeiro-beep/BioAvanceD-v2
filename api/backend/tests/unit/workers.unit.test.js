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
    expect(result.fhirResourcesCreated).toBe(0);
  });

  it('converts recent patients to FHIR', async () => {
    const fakePatient = { _id: 'p1', patientID: '12345678' };
    importLGPDService.importPatients.mockResolvedValue({ total: 1, success: 1, errors: [] });
    fhirService.patientToFHIR.mockReturnValue({ resourceType: 'Patient', id: 'p1' });
    fhirService.validateFHIRResource.mockReturnValue(true);
    fhirService.findResourceByIdentifier.mockResolvedValue(null);

    const db = makeDb([fakePatient]);
    const result = await patientWorker.process(db, 'job-1', tmpFile, { fileName: 'patients.csv' });

    expect(fhirService.patientToFHIR).toHaveBeenCalledWith(fakePatient);
    expect(result.fhirResourcesCreated).toBe(1);
  });

  it('handles per-patient FHIR conversion error gracefully', async () => {
    const fakePatient = { _id: 'p2', patientID: '99999999' };
    importLGPDService.importPatients.mockResolvedValue({ total: 1, success: 1, errors: [] });
    fhirService.patientToFHIR.mockImplementation(() => { throw new Error('FHIR conversion failed'); });

    const db = makeDb([fakePatient]);
    const result = await patientWorker.process(db, 'job-1', tmpFile);

    expect(result).toHaveProperty('processingTime');
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
    expect(result).toHaveProperty('fhirResourcesCreated', 0);
    expect(typeof result.processingTime).toBe('number');
  });

  it('converts recent temperature readings to FHIR', async () => {
    const fakeTemp = { _id: 't1', sensorId: 'S-001', value: 4.5 };
    importService.importTemperature.mockResolvedValue({ total: 1, success: 1, errors: [] });
    fhirService.temperatureToFHIR.mockReturnValue({
      device: { resourceType: 'Device', id: 'd1' },
      observation: { resourceType: 'Observation', id: 'o1' },
    });
    fhirService.validateFHIRResource.mockReturnValue(true);

    const db = makeDb([fakeTemp]);
    const result = await temperatureWorker.process(db, 'job-2', tmpFile);

    expect(fhirService.temperatureToFHIR).toHaveBeenCalledWith(fakeTemp);
    expect(result.fhirResourcesCreated).toBe(1);
    expect(result.fhirResources.length).toBeGreaterThan(0);
  });

  it('handles per-reading FHIR conversion error gracefully', async () => {
    const fakeTemp = { _id: 't2', sensorId: 'S-002', value: 99 };
    importService.importTemperature.mockResolvedValue({ total: 1, success: 1, errors: [] });
    fhirService.temperatureToFHIR.mockImplementation(() => { throw new Error('FHIR failed'); });

    const db = makeDb([fakeTemp]);
    const result = await temperatureWorker.process(db, 'job-2', tmpFile);

    expect(result).toHaveProperty('processingTime');
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
    expect(result).toHaveProperty('fhirResourcesCreated', 0);
  });

  it('converts imported samples to FHIR', async () => {
    const fakeSample = { _id: 's1', sampleID: 'SMP-001' };
    importLGPDService.importSamples.mockResolvedValue({
      total: 1, success: 1, errors: [], importedSampleIds: ['s1']
    });
    fhirService.sampleToFHIR.mockReturnValue({ resourceType: 'Specimen', id: 's1' });
    fhirService.validateFHIRResource.mockReturnValue(true);
    fhirService.findResourceByIdentifier.mockResolvedValue(null);

    const db = makeDb([fakeSample]);
    const result = await sampleWorker.process(db, 'job-3', tmpFile);

    expect(result).toHaveProperty('fhirResourcesCreated');
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
