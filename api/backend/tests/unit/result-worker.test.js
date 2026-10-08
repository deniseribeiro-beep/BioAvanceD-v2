import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { EventEmitter } from 'events';

const fhirService = require('../../src/services/fhir.service');
const yauzl = require('yauzl');
const resultWorker = require('../../src/workers/workers/result-worker');

function makeDb({ sample = null, insertedId = 'result-1' } = {}) {
  const collections = {};
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        collections[name] = {
          // Only the samples collection holds the sample. Every collection
          // used to return it, so the worker's read of 'amostras', a
          // collection nothing writes, passed here and found nothing live.
          findOne: vi.fn().mockResolvedValue(name === 'samples' ? sample : null),
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

    const sample = { _id: 'samp-1', specimenId: 'SMP-001' };
    const db = makeDb({ sample });
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-001,Glicose,95']);

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

  it('#861: persists importJobID on the inserted result when process() receives a job id', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-1b' },
      diagnosticReport: { id: 'dr-1b' },
    });

    const sample = { _id: 'samp-1b', specimenId: 'SMP-001B' };
    const db = makeDb({ sample });
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-001B,Glicose,95']);

    await resultWorker.process(db, 'job-import-1', csvFile);
    fs.unlinkSync(csvFile);

    const resultsCollection = db.collection('results');
    expect(resultsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ importJobID: 'job-import-1' })
    );
  });

  it('#861: omits importJobID entirely when process() receives no job id', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-1c' },
      diagnosticReport: { id: 'dr-1c' },
    });

    const sample = { _id: 'samp-1c', specimenId: 'SMP-001C' };
    const db = makeDb({ sample });
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-001C,Glicose,95']);

    await resultWorker.process(db, undefined, csvFile);
    fs.unlinkSync(csvFile);

    const resultsCollection = db.collection('results');
    expect(resultsCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedData = resultsCollection.insertOne.mock.calls[0][0];
    expect(insertedData).not.toHaveProperty('importJobID');
  });

  it('records a row error when required identifier fields are missing', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv(['testName,resultValue', 'Glicose,95']);

    const result = await resultWorker.process(db, 'job-1', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/specimenId ou barcode é obrigatório/);
  });

  it('records a row error when the referenced sample is not found', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-404,Glicose,95']);

    const result = await resultWorker.process(db, 'job-1', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/Amostra não encontrada: SMP-404/);
  });

  it('reports the barcode in the not-found error when specimenId is absent', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv(['barcode,testName,resultValue', 'BC-404,Glicose,95']);

    const result = await resultWorker.process(db, 'job-1a', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/Amostra não encontrada: BC-404/);
  });

  it('#1340: a specimenId-only row resolves its own sample, not the first barcode-less one', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-1340' },
      diagnosticReport: { id: 'dr-1340' },
    });
    // The driver sends an undefined filter value as null, and Mongo's
    // { field: null } matches a document that lacks the field. The fake
    // applies both rules, with a barcode-less sample stored first.
    const stored = [
      { _id: 'other', specimenId: 'OTHER-RAW-1' },
      { _id: 'mine', specimenId: 'SMP-1340' },
    ];
    const matches = (doc, clause) => Object.entries(clause).every(([k, v]) =>
      (v === undefined || v === null) ? doc[k] === undefined || doc[k] === null : doc[k] === v);
    const db = makeDb();
    const samples = db.collection('samples');
    samples.findOne.mockImplementation(async (filter) =>
      stored.find((doc) => filter.$or.some((clause) => matches(doc, clause))) || null);
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-1340,Glicose,95']);

    const result = await resultWorker.process(db, 'job-1340', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(1);
    const inserted = db.collection('results').insertOne.mock.calls[0][0];
    expect(inserted.specimenId).toBe('SMP-1340');
    expect(samples.findOne.mock.calls[0][0]).toEqual({ $or: [{ specimenId: 'SMP-1340' }] });
  });

  it('resolves the sample by barcode and falls back to alternate field names (test/code/value/testDate)', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-3' },
      diagnosticReport: { id: 'dr-3' },
    });
    const sample = { _id: 'samp-3', specimenId: 'SMP-003' };
    const db = makeDb({ sample });
    const csvFile = writeCsv([
      'barcode,test,code,value,testDate',
      'BC-001,Colesterol,COD1,180,2026-01-01',
    ]);

    const result = await resultWorker.process(db, 'job-1b', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('falls back to defaults when optional row fields are entirely absent', async () => {
    const sample = { _id: 'samp-4', specimenId: 'SMP-004' };
    const db = makeDb({ sample });
    const csvFile = writeCsv(['specimenId', 'SMP-004']);

    const result = await resultWorker.process(db, 'job-1c', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
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
    // #890: the .raw stub carries a machine-readable code and increments
    // unprocessedFormats, so import-worker.js can tell "wrote nothing
    // because the format is unimplemented" apart from "wrote nothing
    // because every row failed for cause".
    expect(result.errors[0].code).toBe('FORMAT_NOT_IMPLEMENTED');
    expect(result.unprocessedFormats).toBe(1);
  });
});

describe('ResultWorker.process — ZIP path', () => {
  it('extracts a CSV entry from the zip and processes it as a result row', async () => {
    vi.spyOn(fhirService, 'resultToFHIR').mockReturnValue({
      observation: { id: 'obs-2' },
      diagnosticReport: { id: 'dr-2' },
    });
    const sample = { _id: 'samp-2', specimenId: 'SMP-002' };
    const db = makeDb({ sample });

    const zipFile = await writeZipWithEntry('data.csv', 'specimenId,testName,resultValue\nSMP-002,Colesterol,180');
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
    // #890: the generic-file stub carries a machine-readable code and
    // increments unprocessedFormats, mirroring the .raw stub's discriminator.
    expect(result.errors[0].code).toBe('FORMAT_UNSUPPORTED');
    expect(result.unprocessedFormats).toBe(1);
  });
});

describe('ResultWorker.process — CSV path, unprocessedFormats anti-regression (#890)', () => {
  it('leaves unprocessedFormats at 0 when every CSV row fails for cause (not an unimplemented format)', async () => {
    const db = makeDb({ sample: null });
    const csvFile = writeCsv([
      'specimenId,testName,resultValue',
      'SMP-901,Glicose,95',
      'SMP-902,Colesterol,180',
    ]);

    const result = await resultWorker.process(db, 'job-890-csv', csvFile);
    fs.unlinkSync(csvFile);

    expect(result.total).toBe(2);
    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(2);
    // The discriminator: a CSV with all-rows-rejected is a different failure
    // class from a .raw/generic-file unimplemented-format stub (RNF015 AC#7).
    // Rows failed for cause (RF029 AC#6 -> staging/quarantine), not because
    // the format itself is unsupported, so unprocessedFormats must stay 0.
    expect(result.unprocessedFormats).toBe(0);
  });
});

describe('ResultWorker.process — top-level error handling', () => {
  it('rethrows and logs when the underlying processing throws', async () => {
    const badDb = {
      collection: vi.fn(() => {
        throw new Error('collection blew up');
      }),
    };
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-500,Glicose,95']);

    await expect(resultWorker.process(badDb, 'job-4', csvFile)).rejects.toThrow('collection blew up');
    fs.unlinkSync(csvFile);
  });

  it('throws when the source file does not exist', async () => {
    const db = makeDb();
    await expect(
      resultWorker.process(db, 'job-5', path.join(os.tmpdir(), 'does-not-exist-result-worker.csv'))
    ).rejects.toThrow(/não encontrado/);
  });

  it('throws for an unsupported file extension', async () => {
    const db = makeDb();
    const txtFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.txt`);
    fs.writeFileSync(txtFile, 'irrelevant');

    await expect(resultWorker.process(db, 'job-6', txtFile)).rejects.toThrow(
      /Formato de arquivo não suportado/
    );
    fs.unlinkSync(txtFile);
  });
});

describe('ResultWorker.process — ZIP path, yauzl-level failures (mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when yauzl fails to open the archive', async () => {
    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      cb(new Error('bad zip'));
    });
    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    await expect(resultWorker.process(db, 'job-7', zipFile)).rejects.toThrow('bad zip');
    fs.unlinkSync(zipFile);
  });

  it('rejects when the zipfile itself emits an error event', async () => {
    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      zipfile.readEntry = vi.fn(() => {
        setImmediate(() => zipfile.emit('error', new Error('zip stream error')));
      });
      cb(null, zipfile);
    });
    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    await expect(resultWorker.process(db, 'job-8', zipFile)).rejects.toThrow('zip stream error');
    fs.unlinkSync(zipFile);
  });

  it('skips directory entries inside the zip', async () => {
    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'subdir/' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      cb(null, zipfile);
    });
    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-9', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.total).toBe(0);
  });

  it('records an error and continues when openReadStream fails for an entry', async () => {
    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'broken.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => cb(new Error('cannot open stream')));
      cb(null, zipfile);
    });
    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-10', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Erro ao extrair broken\.csv: cannot open stream/);
  });

  function makeFakeWriteStream() {
    const stream = new EventEmitter();
    stream.destroyed = false;
    stream.destroy = vi.fn(() => {
      stream.destroyed = true;
    });
    return stream;
  }

  it('cleans up and records an error when the read stream emits an error, then ignores a second error on the same entry', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      return fakeWriteStream;
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('temp_')) {
        return true;
      }
      return true;
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'broken-read.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => {
          fakeReadStream.emit('error', new Error('read boom'));
          // A second failure on the same entry must be a no-op (entryHandled guard).
          fakeReadStream.emit('error', new Error('read boom again'));
        });
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-11', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Erro ao ler broken-read\.csv: read boom/);
    expect(fakeWriteStream.destroy).toHaveBeenCalledTimes(1);
  });

  it('skips destroy() when the write stream is already destroyed', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      fakeWriteStream.destroyed = true;
      return fakeWriteStream;
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'already-destroyed.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => fakeReadStream.emit('error', new Error('read boom')));
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-11b', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.errors[0].error).toMatch(/Erro ao ler already-destroyed\.csv: read boom/);
    expect(fakeWriteStream.destroy).not.toHaveBeenCalled();
  });

  it('logs when finishEntry\'s own tempPath cleanup fails, and ignores a close event that arrives after the entry was already handled', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      return fakeWriteStream;
    });
    const realExistsSync = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('temp_')) {
        return true;
      }
      return realExistsSync(p);
    });
    const loggerWarnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn');
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('finishEntry cleanup failed');
    });
    const processFileSpy = vi.spyOn(resultWorker, 'processFile');

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'late-close.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => {
          fakeReadStream.emit('error', new Error('read boom'));
          // The close event can still fire after finishEntry already ran for this entry.
          fakeWriteStream.emit('close');
        });
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-14b', zipFile);
    fs.unlinkSync.mockRestore();
    fs.unlinkSync(zipFile);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Erro ao ler late-close\.csv: read boom/);
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/Falha ao remover arquivo temporário/));
    expect(processFileSpy).not.toHaveBeenCalled();
  });

  it('records an error when the write stream itself emits an error, and logs when destroy() throws', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      fakeWriteStream.destroy = vi.fn(() => {
        throw new Error('destroy exploded');
      });
      return fakeWriteStream;
    });
    const realExistsSync = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('temp_')) {
        return false;
      }
      return realExistsSync(p);
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const loggerWarnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn');

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'broken-write.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => {
          fakeWriteStream.emit('error', new Error('write boom'));
        });
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-12', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.errors[0].error).toMatch(/Erro ao gravar broken-write\.csv: write boom/);
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/Falha ao encerrar stream temporário/));
  });

  it('records a per-entry error and logs when cleanup unlink fails after successful processing', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      return fakeWriteStream;
    });
    const loggerWarnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn');
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('cleanup unlink failed');
    });
    vi.spyOn(resultWorker, 'processFile').mockImplementation(async (db, jobID, filePath, results) => {
      results.total += 1;
      results.success += 1;
    });

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'ok.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => fakeWriteStream.emit('close'));
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-13', zipFile);
    fs.unlinkSync.mockRestore();
    fs.unlinkSync(zipFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/Falha ao remover arquivo temporário/));
  });

  it('records a per-entry error when processFile rejects after the write stream closes', async () => {
    let fakeWriteStream;
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      fakeWriteStream = makeFakeWriteStream();
      return fakeWriteStream;
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(resultWorker, 'processFile').mockRejectedValue(new Error('process file boom'));

    const fakeReadStream = new EventEmitter();
    fakeReadStream.pipe = vi.fn();

    vi.spyOn(yauzl, 'open').mockImplementation((filePath, opts, cb) => {
      const zipfile = new EventEmitter();
      let calls = 0;
      zipfile.readEntry = vi.fn(() => {
        calls += 1;
        setImmediate(() => {
          if (calls === 1) {
            zipfile.emit('entry', { fileName: 'fails.csv' });
          } else {
            zipfile.emit('end');
          }
        });
      });
      zipfile.openReadStream = vi.fn((entry, cb) => {
        cb(null, fakeReadStream);
        setImmediate(() => fakeWriteStream.emit('close'));
      });
      cb(null, zipfile);
    });

    const db = makeDb();
    const zipFile = path.join(os.tmpdir(), `result-worker-${Date.now()}.zip`);
    fs.writeFileSync(zipFile, 'not a real zip');

    const result = await resultWorker.process(db, 'job-14', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.errors[0].error).toMatch(/Erro ao processar fails\.csv: process file boom/);
  });
});

describe('ResultWorker.process — ZIP path, real archives', () => {
  it('extracts a .raw entry from the zip and routes it through processFile\'s raw branch', async () => {
    const db = makeDb();
    const zipFile = await writeZipWithEntry('scan.raw', Buffer.from([0x01, 0x02]));

    const result = await resultWorker.process(db, 'job-15', zipFile);
    fs.unlinkSync(zipFile);

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/RAW ainda não totalmente implementado/);
    expect(result.errors[0].fileName).toMatch(/scan\.raw$/);
  });
});

describe('ResultWorker.processCSV — stream-level failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when a row throws synchronously outside processResultRow\'s own try/catch', async () => {
    vi.spyOn(resultWorker, 'processResultRow').mockRejectedValue(new Error('row processing exploded'));
    const db = makeDb();
    const csvFile = writeCsv(['specimenId,testName,resultValue', 'SMP-600,Glicose,95']);

    await expect(resultWorker.process(db, 'job-16', csvFile)).rejects.toThrow('row processing exploded');
    fs.unlinkSync(csvFile);
  });

  // #1175: .pipe() does not forward the SOURCE stream's 'error', so a file
  // removed after process()'s existsSync check crashed the worker with an
  // uncaught exception instead of rejecting.
  it('rejects when the source read stream fails (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `result-worker-missing-${Date.now()}.csv`);
    const results = { success: 0, errors: [], total: 0 };

    await expect(resultWorker.processCSV(makeDb(), 'job-17', missingPath, results, []))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
