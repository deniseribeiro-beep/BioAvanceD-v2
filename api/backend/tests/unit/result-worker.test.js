import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';

const fhirService = require('../../src/services/fhir.service');
const resultWorker = require('../../src/workers/workers/result-worker');

function makeDb({ sample = null, insertedId = 'result-1' } = {}) {
  const collections = {};
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        collections[name] = {
          findOne: vi.fn().mockResolvedValue(sample),
          insertOne: vi.fn().mockResolvedValue({ insertedId }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      return collections[name];
    }),
  };
}

function writeCsv(rows) {
  const tmpFile = path.join(os.tmpdir(), `result-worker-${Date.now()}-${Math.random()}.csv`);
  fs.writeFileSync(tmpFile, rows.join('\n'));
  return tmpFile;
}

function writeZipWithEntry(fileName, content) {
  return new Promise((resolve, reject) => {
    const tmpZip = path.join(os.tmpdir(), `result-worker-${Date.now()}-${Math.random()}.zip`);
    const output = fs.createWriteStream(tmpZip);
    const archive = archiver('zip');
    output.on('close', () => resolve(tmpZip));
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(content, { name: fileName });
    archive.finalize();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResultWorker.process — CSV path (processResultRow)', () => {
  it('imports a matched row and produces FHIR resources', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-1' },
      diagnosticReport: { id: 'dr-1' },
    });

    const sample = { _id: 'samp-1', sampleID: 'SMP-001' };
    const db = makeDb({ sample });
    const csvFile = writeCsv(['sampleID,testName,resultValue', 'SMP-001,Glicose,95']);

    const result = await resultWorker.process(db, 'job-1', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.fhirResources).toHaveLength(2);
    expect(result.fhirResources[0]).toMatchObject({ resourceType: 'Observation', id: 'obs-1' });
    expect(result.fhirResources[1]).toMatchObject({ resourceType: 'DiagnosticReport', id: 'dr-1' });
    expect(fhirService.resultToFHIR).toHaveBeenCalled();
  });

  it('records a row error when required identifier fields are missing', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv(['testName,resultValue', 'Glicose,95']);

    const result = await resultWorker.process(db, 'job-1', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/sampleID, sampleId ou barcode é obrigatório/);
  });

  it('records a row error when the referenced sample is not found', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv(['sampleID,testName,resultValue', 'SMP-404,Glicose,95']);

    const result = await resultWorker.process(db, 'job-1', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/Amostra não encontrada: SMP-404/);
  });
});

describe('ResultWorker.process — RAW path', () => {
  it('reads the raw file and reports it as not yet implemented', async () => {
    const db = makeDb();
    const rawFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.raw`);
    fs.writeFileSync(rawFile, Buffer.from([0x01, 0x02, 0x03]));

    const result = await resultWorker.process(db, 'job-2', rawFile);
    fs.unlinkSync(rawFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/RAW ainda não totalmente implementado/);
    expect(result.errors[0].fileName).toBe(path.basename(rawFile));
  });
});

describe('ResultWorker.process — ZIP path', () => {
  it('extracts a CSV entry from the zip and processes it as a result row', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-2' },
      diagnosticReport: { id: 'dr-2' },
    });
    const sample = { _id: 'samp-2', sampleID: 'SMP-002' };
    const db = makeDb({ sample });

    const zipFile = await writeZipWithEntry('data.csv', 'sampleID,testName,resultValue\nSMP-002,Colesterol,180');
    const result = await resultWorker.process(db, 'job-3', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
    expect(result.fhirResources).toHaveLength(2);
  });

  it('records an error for an unsupported entry type inside the zip', async () => {
    const db = makeDb();
    const zipFile = await writeZipWithEntry('notes.txt', 'just some notes');

    const result = await resultWorker.process(db, 'job-3', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/Formato de arquivo não suportado/);
  });
});

describe('ResultWorker.process — top-level error handling', () => {
  it('rethrows and logs when the underlying processing throws', async () => {
    const badDb = {
      collection: vi.fn(() => {
        throw new Error('collection blew up');
      }),
    };
    const csvFile = writeCsv(['sampleID,testName,resultValue', 'SMP-500,Glicose,95']);

    await expect(resultWorker.process(badDb, 'job-4', csvFile)).rejects.toThrow('collection blew up');
    fs.unlinkSync(csvFile);
  });
});
