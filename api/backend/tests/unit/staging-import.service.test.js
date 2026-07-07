import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const StagingImport = require('../../src/models/StagingImport');
const connectionModule = require('../../src/infrastructure/database/mongodb/connection');
const queueModule = require('../../src/config/queue');
const logger = require('../../src/utils/logger');

const SERVICE_PATH = require.resolve('../../src/services/staging-import.service');

function reloadService() {
  delete require.cache[SERVICE_PATH];
  return require('../../src/services/staging-import.service');
}

describe('staging-import.service', () => {
  let stagingImportService;

  beforeEach(() => {
    vi.spyOn(connectionModule, 'connectMongoDB').mockResolvedValue(undefined);
    vi.spyOn(queueModule, 'getQueue').mockReturnValue(null);
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    stagingImportService = reloadService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sanitizeFileName', () => {
    it('strips special characters, keeping alnum, dot, underscore, dash', () => {
      expect(stagingImportService.sanitizeFileName('my file (1)!.csv')).toBe('my_file__1__.csv');
    });

    it('defaults to "batch-import" for falsy input', () => {
      expect(stagingImportService.sanitizeFileName(undefined)).toBe('batch-import');
      expect(stagingImportService.sanitizeFileName('')).toBe('batch-import');
      expect(stagingImportService.sanitizeFileName(null)).toBe('batch-import');
    });

    it('trims whitespace before sanitizing', () => {
      expect(stagingImportService.sanitizeFileName('  data.txt  ')).toBe('data.txt');
    });
  });

  describe('ensureDirectoryExists', () => {
    it('creates the directory when it does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      stagingImportService.ensureDirectoryExists('/some/dir');

      expect(mkdirSpy).toHaveBeenCalledWith('/some/dir', { recursive: true });
    });

    it('does not create the directory when it already exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      stagingImportService.ensureDirectoryExists('/some/dir');

      expect(mkdirSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildStagingFilePath', () => {
    it('composes the staging dir with the sanitized file name and ensures the dir exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      const result = stagingImportService.buildStagingFilePath('job-123', 'weird name!.csv');

      const expectedDir = path.join(stagingImportService.getStagingDirectory(), 'job-123');
      const expectedPath = path.join(expectedDir, 'weird_name_.csv');

      expect(result).toBe(expectedPath);
      expect(mkdirSpy).toHaveBeenCalledWith(expectedDir, { recursive: true });
    });
  });

  describe('persistRawFile', () => {
    it('throws when file is falsy', async () => {
      await expect(stagingImportService.persistRawFile(null, 'job-1')).rejects.toThrow(
        'Arquivo bruto não encontrado para staging'
      );
    });

    it('throws when file.path is missing', async () => {
      await expect(
        stagingImportService.persistRawFile({ originalname: 'a.csv' }, 'job-1')
      ).rejects.toThrow('Arquivo bruto não encontrado para staging');
    });

    it('throws when file does not exist on disk', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(
        stagingImportService.persistRawFile(
          { path: '/tmp/upload-1', originalname: 'a.csv' },
          'job-1'
        )
      ).rejects.toThrow('Arquivo bruto não encontrado para staging');
    });

    it('copies the file and returns the expected metadata shape on success', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const copyFileSpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {});

      const file = {
        path: '/tmp/upload-1',
        originalname: 'my report.csv',
        mimetype: 'text/csv',
        size: 1234,
      };

      const result = await stagingImportService.persistRawFile(file, 'job-42');

      const expectedStagingDir = path.join(
        stagingImportService.getStagingDirectory(),
        'job-42'
      );
      const expectedPath = path.join(expectedStagingDir, 'my_report.csv');

      expect(copyFileSpy).toHaveBeenCalledWith('/tmp/upload-1', expectedPath);
      expect(result).toEqual({
        storageType: 'filesystem',
        storagePath: expectedPath,
        originalName: 'my report.csv',
        mimeType: 'text/csv',
        size: 1234,
      });
    });
  });

  describe('createStagingImport', () => {
    it('connects to mongo, persists the raw file, and creates the StagingImport doc', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {});

      const toObjectResult = { jobId: 'fixed-uuid', fileName: 'data.csv', status: 'staged' };
      const createSpy = vi.spyOn(StagingImport, 'create').mockResolvedValue({
        toObject: () => toObjectResult,
      });

      const file = {
        path: '/tmp/upload-2',
        originalname: 'data.csv',
        mimetype: 'text/csv',
        size: 99,
      };

      const result = await stagingImportService.createStagingImport(file);

      expect(connectionModule.connectMongoDB).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      const createArg = createSpy.mock.calls[0][0];
      expect(createArg).toMatchObject({
        fileName: 'data.csv',
        status: 'staged',
        totalRows: 0,
        processedRows: 0,
        importErrors: [],
      });
      expect(typeof createArg.jobId).toBe('string');
      expect(createArg.rawData).toMatchObject({
        storageType: 'filesystem',
        originalName: 'data.csv',
      });
      expect(result).toBe(toObjectResult);
    });

    it('writes to a field that actually exists on the StagingImport schema (#43)', () => {
      const doc = new StagingImport({
        jobId: 'schema-check',
        fileName: 'data.csv',
        status: 'staged',
        totalRows: 0,
        processedRows: 0,
        importErrors: [{ message: 'boom', occurredAt: new Date() }],
        rawData: { storageType: 'filesystem' },
      });

      expect(doc.toObject().importErrors).toHaveLength(1);
      expect(doc.toObject().importErrors[0].message).toBe('boom');
    });
  });

  describe('dispatchBatchJob', () => {
    it('throws when getQueue() returns falsy', async () => {
      queueModule.getQueue.mockReturnValue(null);

      await expect(
        stagingImportService.dispatchBatchJob({ jobId: 'job-1', fileName: 'a.csv' })
      ).rejects.toThrow('Fila de importação indisponível');
    });

    it('adds the job to the queue with correct name/payload/options and marks the import as queued', async () => {
      const queueJob = { id: 'queue-job-id-1' };
      const addSpy = vi.fn().mockResolvedValue(queueJob);
      queueModule.getQueue.mockReturnValue({ add: addSpy });

      const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

      const stagingImport = { jobId: 'job-99', fileName: 'batch.csv' };
      const result = await stagingImportService.dispatchBatchJob(stagingImport);

      expect(addSpy).toHaveBeenCalledWith(
        'batch-import',
        {
          jobId: 'job-99',
          stagingImportId: 'job-99',
          fileName: 'batch.csv',
        },
        {
          jobId: 'job-99',
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      expect(updateOneSpy).toHaveBeenCalledTimes(1);
      const [filterArg, updateArg] = updateOneSpy.mock.calls[0];
      expect(filterArg).toEqual({ jobId: 'job-99' });
      expect(updateArg.$set.status).toBe('queued');
      expect(updateArg.$set.updatedAt).toBeInstanceOf(Date);

      expect(result).toBe(queueJob);
    });
  });

  describe('createBatchImportJob', () => {
    it('happy path: chains createStagingImport -> dispatchBatchJob and returns the composed result', async () => {
      const stagingImportDoc = { jobId: 'job-happy', fileName: 'ok.csv' };
      const createStagingImportSpy = vi
        .spyOn(stagingImportService, 'createStagingImport')
        .mockResolvedValue(stagingImportDoc);
      const queueJob = { id: 'q-1' };
      const dispatchSpy = vi
        .spyOn(stagingImportService, 'dispatchBatchJob')
        .mockResolvedValue(queueJob);

      const file = { originalname: 'ok.csv' };
      const result = await stagingImportService.createBatchImportJob(file);

      expect(createStagingImportSpy).toHaveBeenCalledWith(file);
      expect(dispatchSpy).toHaveBeenCalledWith(stagingImportDoc);
      expect(result).toEqual({
        jobId: 'job-happy',
        stagingImport: stagingImportDoc,
        queueJob,
      });
    });

    it('failure path: when dispatchBatchJob throws, records failure on StagingImport and rethrows', async () => {
      const stagingImportDoc = { jobId: 'job-fail', fileName: 'bad.csv' };
      vi.spyOn(stagingImportService, 'createStagingImport').mockResolvedValue(stagingImportDoc);
      const dispatchError = new Error('queue exploded');
      vi.spyOn(stagingImportService, 'dispatchBatchJob').mockRejectedValue(dispatchError);
      const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

      await expect(stagingImportService.createBatchImportJob({ originalname: 'bad.csv' })).rejects.toThrow(
        'queue exploded'
      );

      expect(updateOneSpy).toHaveBeenCalledTimes(1);
      const [filterArg, updateArg] = updateOneSpy.mock.calls[0];
      expect(filterArg).toEqual({ jobId: 'job-fail' });
      expect(updateArg.$set.status).toBe('failed');
      expect(updateArg.$set.updatedAt).toBeInstanceOf(Date);
      expect(updateArg.$push.importErrors.message).toBe('queue exploded');
      expect(updateArg.$push.importErrors.occurredAt).toBeInstanceOf(Date);
    });

    it('failure path: when createStagingImport itself throws, skips the failure-recording branch and rethrows', async () => {
      const creationError = new Error('mongo unavailable');
      vi.spyOn(stagingImportService, 'createStagingImport').mockRejectedValue(creationError);
      const dispatchSpy = vi.spyOn(stagingImportService, 'dispatchBatchJob');
      const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

      await expect(
        stagingImportService.createBatchImportJob({ originalname: 'x.csv' })
      ).rejects.toThrow('mongo unavailable');

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(updateOneSpy).not.toHaveBeenCalled();
    });
  });
});
