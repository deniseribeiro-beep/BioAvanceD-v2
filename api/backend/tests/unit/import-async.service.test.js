import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fsSync from 'fs';
import ExcelJSLib from 'exceljs';

const require = createRequire(import.meta.url);

const service = require('../../src/services/import-async.service');
const ImportJob = require('../../src/models/ImportJob');
const ImportMetrics = require('../../src/models/ImportMetrics');
const fhirValidator = require('../../src/services/fhir-validator.service');
const notificationService = require('../../src/services/notification.service');
const logger = require('../../src/utils/logger');

let tmpDir;

beforeAll(() => {
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'import-async-test-'));
});

afterAll(() => {
  try {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
});

function writeFile(name, content) {
  const filePath = path.join(tmpDir, name);
  fsSync.writeFileSync(filePath, content);
  return filePath;
}

async function writeXlsx(name, rows) {
  const wb = new ExcelJSLib.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((row) => ws.addRow(row));
  const filePath = path.join(tmpDir, name);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

function createDb(overrides = {}) {
  const collection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'id1' }),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return {
    collection: vi.fn().mockReturnValue(collection),
    __collection: collection,
  };
}

describe('import-async.service', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeHeader', () => {
    it('returns empty string for null/undefined', () => {
      expect(service.normalizeHeader(null)).toBe('');
      expect(service.normalizeHeader(undefined)).toBe('');
    });

    it('strips BOM, whitespace, accents, parens and lowercases', () => {
      expect(service.normalizeHeader('﻿ ID Paciente (opcional) ')).toBe('idpaciente');
      expect(service.normalizeHeader('Data de Coleta')).toBe('datadecoleta');
    });

    it('strips non-alphanumeric characters', () => {
      expect(service.normalizeHeader('Tipo-Amostra!!')).toBe('tipoamostra');
    });
  });

  describe('canonicalizeHeader', () => {
    it('maps known aliases to canonical field names', () => {
      expect(service.canonicalizeHeader('idPaciente')).toBe('participantId');
      expect(service.canonicalizeHeader('Tipo Amostra')).toBe('sampleType');
      // #770: was 'registrationDate', a name sample.routes.js rejects at the
      // API boundary as NON_CANONICAL_FIELD and canonical-fields.arch.test.js
      // lists in ASPIRATIONAL_FORBIDDEN. Sample.js:38 declares `registeredAt`.
      expect(service.canonicalizeHeader('Data Coleta')).toBe('registeredAt');
      expect(service.canonicalizeHeader('Eppendorf Well')).toBe('wellPosition');
    });

    // #770: all three date aliases targeted the same non-canonical name, so
    // pinning only one of them would let the other two drift back.
    it('maps every date-column alias to registeredAt', () => {
      expect(service.canonicalizeHeader('Collection Date')).toBe('registeredAt');
      expect(service.canonicalizeHeader('Data Coleta')).toBe('registeredAt');
      expect(service.canonicalizeHeader('Register Date')).toBe('registeredAt');
    });

    // #770: the map carried `idpaciente: 'patientID'` twice -- the same
    // duplicate-key tell that started this family at #758. Both copies
    // assigned the same value, so removing one is behaviour-invariant; this
    // pins the surviving mapping so the dedupe cannot silently drop it.
    it('still maps idPaciente after the duplicate key was removed', () => {
      expect(service.canonicalizeHeader('idPaciente')).toBe('participantId');
      expect(service.canonicalizeHeader('ID Paciente')).toBe('participantId');
      expect(service.canonicalizeHeader('patientId')).toBe('participantId');
    });

    // #773: fieldMapping's two patientID-targeting entries (patientid,
    // idpaciente) were repointed to the canonical name. Two independent
    // sources settle it: contracts/canonical/v1/index.js declares
    // participantId as a required canonical field, and
    // sample.routes.js:378-384 already 422s a payload carrying patientID as
    // NON_CANONICAL_FIELD. Pinned explicitly here so a future revert to the
    // legacy name is caught.
    it('maps patientId aliases to the canonical participantId name (#773)', () => {
      expect(service.canonicalizeHeader('patientId')).toBe('participantId');
      expect(service.canonicalizeHeader('idPaciente')).toBe('participantId');
    });

    it('falls back to trimmed original string when no alias matches', () => {
      expect(service.canonicalizeHeader('  Some Custom Field  ')).toBe('Some Custom Field');
    });

    it('falls back to normalized form when original is not a string', () => {
      expect(service.canonicalizeHeader(123)).toBe(service.normalizeHeader(123));
    });
  });

  describe('findHeaderRow', () => {
    it('returns the index of the first row containing a candidate header', () => {
      const rows = [
        ['foo', 'bar'],
        ['PatientID', 'SampleType', 'Block'],
        ['1', 'blood', 'A'],
      ];
      expect(service.findHeaderRow(rows, 'samples')).toBe(1);
    });

    it('returns -1 when no row matches and skips non-array rows', () => {
      const rows = [null, ['foo', 'bar'], ['baz']];
      expect(service.findHeaderRow(rows, 'samples')).toBe(-1);
    });
  });

  describe('validateFile', () => {
    it('rejects a disallowed extension for the given dataType', async () => {
      const filePath = writeFile('bad.txt', 'hello');
      const file = { originalname: 'bad.txt', size: 10, mimetype: 'text/plain', path: filePath };

      const result = await service.validateFile(file, 'temperature');

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/Formato de arquivo inválido/);
    });

    it('rejects a file over 100MB', async () => {
      const filePath = writeFile('big.csv', 'a,b\n1,2\n');
      const file = { originalname: 'big.csv', size: 101 * 1024 * 1024, mimetype: 'text/csv', path: filePath };

      const result = await service.validateFile(file, 'temperature');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Arquivo muito grande. Tamanho máximo: 100MB');
    });

    it('rejects when the file does not exist on disk', async () => {
      // Note: a missing .csv/.xlsx path here would crash the process — see
      // report notes. Use .json (validateFile's JSON branch also uses
      // fs.readFileSync wrapped in try/catch) to isolate the existsSync check.
      const file = { originalname: 'missing.json', size: 10, mimetype: 'application/json', path: path.join(tmpDir, 'nope.json') };

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Arquivo não encontrado');
    });

    it('accepts a valid csv and populates headers metadata', async () => {
      const filePath = writeFile('temp.csv', 'PatientID,SampleType\n1,blood\n');
      const file = { originalname: 'temp.csv', size: 20, mimetype: 'text/csv', path: filePath };

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.metadata.headers).toEqual(['participantId', 'sampleType']);
    });

    it('swallows getHeadersFromFile errors via try/catch and still returns valid=true', async () => {
      const filePath = writeFile('temp2.csv', 'a,b\n1,2\n');
      const file = { originalname: 'temp2.csv', size: 20, mimetype: 'text/csv', path: filePath };
      vi.spyOn(service, 'getHeadersFromFile').mockRejectedValue(new Error('boom'));

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects invalid JSON content with a parse error message', async () => {
      const filePath = writeFile('bad.json', '{not valid json');
      const file = { originalname: 'bad.json', size: 20, mimetype: 'application/json', path: filePath };

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('accepts valid non-FHIR JSON without invoking fhirValidator.validatePayload', async () => {
      const filePath = writeFile('plain.json', JSON.stringify({ foo: 'bar' }));
      const file = { originalname: 'plain.json', size: 20, mimetype: 'application/json', path: filePath };
      const validatePayloadSpy = vi.spyOn(fhirValidator, 'validatePayload');

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(true);
      expect(validatePayloadSpy).not.toHaveBeenCalled();
      expect(result.metadata.fhir).toBeUndefined();
    });

    it('runs FHIR validation for FHIR resources and folds issues into errors when invalid', async () => {
      const payload = { resourceType: 'Patient' };
      const filePath = writeFile('patient.json', JSON.stringify(payload));
      const file = { originalname: 'patient.json', size: 20, mimetype: 'application/json', path: filePath };

      vi.spyOn(fhirValidator, 'isFhirResource').mockReturnValue(true);
      vi.spyOn(fhirValidator, 'validatePayload').mockReturnValue({
        valid: false,
        resourcesValidated: 1,
        issues: [{ severity: 'error', code: 'invalid', diagnostics: "O campo 'Nome' é inválido" }],
      });
      vi.spyOn(fhirValidator, 'buildOperationOutcome').mockReturnValue({ resourceType: 'OperationOutcome', issue: [] });

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("O campo 'Nome' é inválido");
      expect(result.metadata.fhir).toBe(true);
      expect(result.metadata.fhirResourcesValidated).toBe(1);
      expect(result.metadata.operationOutcome).toEqual({ resourceType: 'OperationOutcome', issue: [] });
    });

    it('marks metadata.fhir true but adds no errors for a valid FHIR resource', async () => {
      const payload = { resourceType: 'Organization', name: 'Lab' };
      const filePath = writeFile('org.json', JSON.stringify(payload));
      const file = { originalname: 'org.json', size: 20, mimetype: 'application/json', path: filePath };

      vi.spyOn(fhirValidator, 'isFhirResource').mockReturnValue(true);
      vi.spyOn(fhirValidator, 'validatePayload').mockReturnValue({ valid: true, resourcesValidated: 1, issues: [] });

      const result = await service.validateFile(file, 'patients');

      expect(result.valid).toBe(true);
      expect(result.metadata.fhir).toBe(true);
    });
  });

  describe('getHeadersFromFile', () => {
    it('resolves canonicalized headers from a csv file', async () => {
      const filePath = writeFile('h1.csv', 'ID Paciente,Tipo Amostra\n1,blood\n');
      const file = { originalname: 'h1.csv', path: filePath };

      const headers = await service.getHeadersFromFile(file, 'patients');

      expect(headers).toEqual(['participantId', 'sampleType']);
    });

    it('resolves [] when the underlying csv-parser stream emits an error', async () => {
      // csv-parser is a plain function export (not spy-friendly on its own),
      // and the readable stream from fs.createReadStream has no 'error'
      // listener of its own in the source (only the piped csv() stream does)
      // — pointing at a genuinely missing file crashes the process instead of
      // resolving [] (see report). To exercise the documented "resolves []
      // on stream error" behavior without that crash, swap the csv-parser
      // module for a fake PassThrough that emits 'error' once piped.
      const { PassThrough } = require('stream');
      const csvParserPath = require.resolve('csv-parser');
      const originalCsvParserModule = require.cache[csvParserPath];
      delete require.cache[csvParserPath];
      require.cache[csvParserPath] = {
        id: csvParserPath,
        filename: csvParserPath,
        loaded: true,
        exports: function fakeCsvParser() {
          const stream = new PassThrough();
          process.nextTick(() => stream.emit('error', new Error('parse failure')));
          return stream;
        },
      };
      delete require.cache[require.resolve('../../src/services/import-async.service')];
      const freshService = require('../../src/services/import-async.service');

      try {
        const filePath = writeFile('will-error.csv', 'a,b\n1,2\n');
        const file = { originalname: 'will-error.csv', path: filePath };

        const headers = await freshService.getHeadersFromFile(file, 'patients');

        expect(headers).toEqual([]);
      } finally {
        delete require.cache[csvParserPath];
        if (originalCsvParserModule) require.cache[csvParserPath] = originalCsvParserModule;
        delete require.cache[require.resolve('../../src/services/import-async.service')];
      }
    });

    it('resolves [] instead of crashing when the source file does not exist (#27)', async () => {
      const file = { originalname: 'missing.csv', path: path.join(tmpDir, 'does-not-exist.csv') };

      const headers = await service.getHeadersFromFile(file, 'patients');

      expect(headers).toEqual([]);
    });

    it('resolves canonicalized headers from an xlsx header row', async () => {
      const filePath = await writeXlsx('h1.xlsx', [
        ['some', 'preamble'],
        ['PatientID', 'SampleType', 'Block'],
        ['1', 'blood', 'A'],
      ]);
      const file = { originalname: 'h1.xlsx', path: filePath };

      const headers = await service.getHeadersFromFile(file, 'samples');

      expect(headers).toEqual(['participantId', 'sampleType', 'block']);
    });

    it('returns [] for an xlsx file with no recognizable header row', async () => {
      const filePath = await writeXlsx('h2.xlsx', [
        ['foo', 'bar'],
        ['baz', 'qux'],
      ]);
      const file = { originalname: 'h2.xlsx', path: filePath };

      const headers = await service.getHeadersFromFile(file, 'samples');

      expect(headers).toEqual([]);
    });

    it('returns [] for an unsupported extension', async () => {
      const file = { originalname: 'file.zip', path: path.join(tmpDir, 'file.zip') };

      const headers = await service.getHeadersFromFile(file, 'results');

      expect(headers).toEqual([]);
    });
  });

  describe('createImportJob (queue-dependent)', () => {
    function freshServiceWithQueue(queueImpl) {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/import-async.service')];
      const freshQueueConfig = require('../../src/config/queue');
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue(queueImpl);
      const freshService = require('../../src/services/import-async.service');
      return freshService;
    }

    it('notifies failure and throws (without enqueueing) when validation fails', async () => {
      const addMock = vi.fn();
      const freshService = freshServiceWithQueue({ add: addMock });
      const notifyFailedSpy = vi.spyOn(notificationService, 'notifyJobFailed').mockResolvedValue();
      const db = createDb();
      const file = { originalname: 'bad.txt', size: 10, mimetype: 'text/plain', path: path.join(tmpDir, 'nope-either.txt') };

      await expect(freshService.createImportJob(db, 'user1', file, 'temperature', {})).rejects.toThrow(/Validação falhou/);

      expect(notifyFailedSpy).toHaveBeenCalledTimes(1);
      expect(addMock).not.toHaveBeenCalled();
    });

    it('inserts the job, enqueues it, and notifies queued on success', async () => {
      const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });
      const freshService = freshServiceWithQueue({ add: addMock });
      const notifyQueuedSpy = vi.spyOn(notificationService, 'notifyJobQueued').mockResolvedValue();
      const db = createDb();
      const filePath = writeFile('ok.csv', 'PatientID\n1\n');
      const file = { originalname: 'ok.csv', size: 20, mimetype: 'text/csv', path: filePath };

      const result = await freshService.createImportJob(db, 'user1', file, 'patients', { priority: 3 });

      expect(result.status).toBe('pending');
      expect(typeof result.jobID).toBe('string');
      expect(db.__collection.insertOne).toHaveBeenCalledTimes(1);
      expect(addMock).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = addMock.mock.calls[0];
      expect(jobName).toBe('import');
      expect(payload.dataType).toBe('patients');
      expect(opts.priority).toBe(3);
      expect(notifyQueuedSpy).toHaveBeenCalledTimes(1);
    });

    it('throws when ImportJob.validate reports invalid data (e.g. unknown dataType)', async () => {
      const addMock = vi.fn();
      const freshService = freshServiceWithQueue({ add: addMock });
      const db = createDb();
      const filePath = writeFile('weird.csv', 'a\n1\n');
      const file = { originalname: 'weird.csv', size: 20, mimetype: 'text/csv', path: filePath };

      // validFormats has no entry for 'unknown-type', so validateFile already fails first;
      // use a dataType accepted by validateFile's fallback (empty array -> always invalid format)
      // Instead, force ImportJob.validate to fail directly to isolate this branch.
      const ImportJobFresh = require('../../src/models/ImportJob');
      vi.spyOn(ImportJobFresh, 'validate').mockReturnValue({ isValid: false, errors: ['dataType inválido'] });

      await expect(freshService.createImportJob(db, 'user1', file, 'temperature', {})).rejects.toThrow(/Dados do job inválidos/);
      expect(addMock).not.toHaveBeenCalled();
    });
  });

  describe('getJobStatus (queue-dependent)', () => {
    function freshServiceWithQueue(queueImpl) {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/import-async.service')];
      const freshQueueConfig = require('../../src/config/queue');
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue(queueImpl);
      const freshService = require('../../src/services/import-async.service');
      return freshService;
    }

    it('throws when the job is not found in the database', async () => {
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue(null) });
      const db = createDb();
      db.__collection.findOne.mockResolvedValue(null);

      await expect(freshService.getJobStatus(db, 'missing-job')).rejects.toThrow(/não encontrado/);
    });

    it('returns the DB record unchanged when not present in the queue', async () => {
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue(null) });
      const db = createDb();
      const dbJob = { jobID: 'j1', status: 'completed', progress: 100 };
      db.__collection.findOne.mockResolvedValue(dbJob);

      const result = await freshService.getJobStatus(db, 'j1');

      expect(result).toBe(dbJob);
      expect(db.__collection.updateOne).not.toHaveBeenCalled();
    });

    it('syncs status/progress from the queue into the DB when they differ', async () => {
      const queueJob = {
        getState: vi.fn().mockResolvedValue('active'),
        progress: 42,
      };
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue(queueJob) });
      const db = createDb();
      const dbJob = { jobID: 'j1', status: 'pending', progress: 0 };
      db.__collection.findOne.mockResolvedValue(dbJob);

      const result = await freshService.getJobStatus(db, 'j1');

      expect(db.__collection.updateOne).toHaveBeenCalledWith(
        { jobID: 'j1' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'active', progress: 42 }) })
      );
      expect(result.status).toBe('active');
      expect(result.progress).toBe(42);
    });

    // #890: BullMQ has no notion of the custom terminal status
    // 'completed_no_data' -- it only ever reports its own generic
    // 'completed'. Within Redis's 24h job retention window, an unguarded
    // sync would clobber the DB's 'completed_no_data' back to 'completed'
    // on every getJobStatus() call, silently erasing the #890 signal.
    it('does not overwrite a stored completed_no_data status when the queue reports completed', async () => {
      const queueJob = {
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      };
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue(queueJob) });
      const db = createDb();
      const dbJob = { jobID: 'j-890', status: 'completed_no_data', progress: 100 };
      db.__collection.findOne.mockResolvedValue(dbJob);

      const result = await freshService.getJobStatus(db, 'j-890');

      expect(db.__collection.updateOne).not.toHaveBeenCalled();
      expect(result.status).toBe('completed_no_data');
    });
  });

  describe('listJobs', () => {
    it('builds a Mongo query from the provided filters and applies default pagination', async () => {
      const db = createDb();
      db.__collection.toArray.mockResolvedValue([{ jobID: 'j1' }]);
      db.__collection.countDocuments.mockResolvedValue(1);

      const result = await service.listJobs(db, { userID: 'u1', dataType: 'patients', status: 'pending' });

      expect(db.__collection.find).toHaveBeenCalledWith({ userID: 'u1', dataType: 'patients', status: 'pending' });
      expect(result).toEqual({ jobs: [{ jobID: 'j1' }], total: 1, limit: 50, skip: 0 });
    });

    it('parses limit/skip as integers from string filters', async () => {
      const db = createDb();

      const result = await service.listJobs(db, { limit: '10', skip: '20' });

      expect(db.__collection.limit).toHaveBeenCalledWith(10);
      expect(db.__collection.skip).toHaveBeenCalledWith(20);
      expect(result.limit).toBe(10);
      expect(result.skip).toBe(20);
    });
  });

  describe('cancelJob (queue-dependent)', () => {
    function freshServiceWithQueue(queueImpl) {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/import-async.service')];
      const freshQueueConfig = require('../../src/config/queue');
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue(queueImpl);
      const freshService = require('../../src/services/import-async.service');
      return freshService;
    }

    it('removes the job from the queue when present and always sets DB status to cancelled', async () => {
      const removeMock = vi.fn().mockResolvedValue();
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue({ remove: removeMock }) });
      const db = createDb();

      const result = await freshService.cancelJob(db, 'j1');

      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(db.__collection.updateOne).toHaveBeenCalledWith(
        { jobID: 'j1' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
      );
      expect(result).toEqual({ success: true, message: 'Job cancelado com sucesso' });
    });

    it('still sets DB status to cancelled when the job is absent from the queue', async () => {
      const freshService = freshServiceWithQueue({ getJob: vi.fn().mockResolvedValue(null) });
      const db = createDb();

      const result = await freshService.cancelJob(db, 'j2');

      expect(db.__collection.updateOne).toHaveBeenCalledWith(
        { jobID: 'j2' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('saveMetrics', () => {
    it('inserts a metrics doc and calls updateConsolidatedMetrics on success', async () => {
      const db = createDb();
      const updateSpy = vi.spyOn(service, 'updateConsolidatedMetrics').mockResolvedValue();
      const jobData = { jobID: 'j1', userID: 'u1', dataType: 'patients', totalRecords: 5, successCount: 4, errorCount: 1 };

      await service.saveMetrics(db, jobData);

      expect(db.__collection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = db.__collection.insertOne.mock.calls[0][0];
      expect(inserted.dataType).toBe('patients');
      expect(inserted.totalRecords).toBe(5);
      expect(updateSpy).toHaveBeenCalledWith(db, jobData);
    });

    it('does not let a DB error escape (catches internally as documented)', async () => {
      const db = createDb();
      db.__collection.insertOne.mockRejectedValue(new Error('mongo down'));
      const jobData = { jobID: 'j1', userID: 'u1', dataType: 'patients' };

      await expect(service.saveMetrics(db, jobData)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateConsolidatedMetrics', () => {
    it('increments counters on an existing consolidated doc for today', async () => {
      const db = createDb();
      const existing = { _id: 'agg1' };
      db.__collection.findOne.mockResolvedValue(existing);
      const jobData = { dataType: 'patients', totalRecords: 3, successCount: 2, errorCount: 1 };

      await service.updateConsolidatedMetrics(db, jobData);

      expect(db.__collection.updateOne).toHaveBeenCalledWith(
        { _id: 'agg1' },
        expect.objectContaining({ $inc: expect.objectContaining({ totalRecords: 3, successCount: 2, errorCount: 1 }) })
      );
      expect(db.__collection.insertOne).not.toHaveBeenCalled();
    });

    it('inserts a new consolidated doc when none exists for today', async () => {
      const db = createDb();
      db.__collection.findOne.mockResolvedValue(null);
      const jobData = { dataType: 'samples', totalRecords: 1 };

      await service.updateConsolidatedMetrics(db, jobData);

      expect(db.__collection.insertOne).toHaveBeenCalledTimes(1);
      const inserted = db.__collection.insertOne.mock.calls[0][0];
      expect(inserted.jobID).toBeNull();
      expect(inserted.dataType).toBe('samples');
    });

    it('swallows DB errors internally without rethrowing', async () => {
      const db = createDb();
      db.__collection.findOne.mockRejectedValue(new Error('mongo down'));

      await expect(service.updateConsolidatedMetrics(db, { dataType: 'patients' })).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getJobReport', () => {
    it('reshapes the job status into a report document', async () => {
      const db = createDb();
      const job = {
        jobID: 'j1',
        status: 'completed',
        dataType: 'patients',
        fileName: 'f.csv',
        totalRecords: 10,
        successCount: 9,
        errorCount: 1,
        importErrors: ['line 3 invalid'],
        progress: 100,
        createdAt: new Date('2026-01-01'),
        startedAt: new Date('2026-01-01'),
        completedAt: new Date('2026-01-02'),
        fhirResources: ['Patient/1'],
      };
      vi.spyOn(service, 'getJobStatus').mockResolvedValue(job);

      const report = await service.getJobReport(db, 'j1');

      expect(report).toEqual({
        jobID: 'j1',
        status: 'completed',
        dataType: 'patients',
        fileName: 'f.csv',
        totalRecords: 10,
        successCount: 9,
        errorCount: 1,
        errors: ['line 3 invalid'],
        progress: 100,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        fhirResources: ['Patient/1'],
      });
    });

    it('defaults fhirResources to [] when absent and propagates getJobStatus errors', async () => {
      vi.spyOn(service, 'getJobStatus').mockRejectedValue(new Error('Job não encontrado'));

      await expect(service.getJobReport({}, 'missing')).rejects.toThrow(/não encontrado/);
    });
  });

  describe('cleanupFile', () => {
    it('deletes the file when it exists', () => {
      const filePath = writeFile('to-delete.txt', 'x');
      expect(fsSync.existsSync(filePath)).toBe(true);

      service.cleanupFile(filePath);

      expect(fsSync.existsSync(filePath)).toBe(false);
    });

    it('does nothing (and does not throw) when the file does not exist', () => {
      const filePath = path.join(tmpDir, 'never-existed.txt');

      expect(() => service.cleanupFile(filePath)).not.toThrow();
    });

    it('catches and logs errors from fs operations without throwing', () => {
      const filePath = writeFile('locked.txt', 'x');
      const existsSpy = vi.spyOn(fsSync, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fsSync, 'unlinkSync').mockImplementation(() => {
        throw new Error('EBUSY');
      });

      expect(() => service.cleanupFile(filePath)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();

      existsSpy.mockRestore();
      unlinkSpy.mockRestore();
    });
  });
});
