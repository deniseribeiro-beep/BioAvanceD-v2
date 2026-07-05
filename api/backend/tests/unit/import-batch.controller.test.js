import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/import-batch.controller');
const stagingImportService = require('../../src/services/staging-import.service');
const logger = require('../../src/utils/logger');
const fs = require('fs');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

describe('import-batch.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('multer storage/fileFilter config (internal callbacks)', () => {
    const multerPath = require.resolve('multer');
    const controllerPath = require.resolve('../../src/controllers/import-batch.controller');

    function loadControllerWithCapturedMulterConfig() {
      let diskStorageConfig;
      let uploadConfig;

      const realMulterModule = require.cache[multerPath];
      const realMulter = realMulterModule.exports;

      const wrapper = (config) => {
        uploadConfig = config;
        return realMulter(config);
      };
      wrapper.diskStorage = (config) => {
        diskStorageConfig = config;
        return realMulter.diskStorage(config);
      };
      realMulterModule.exports = wrapper;

      delete require.cache[controllerPath];
      try {
        require('../../src/controllers/import-batch.controller');
      } finally {
        realMulterModule.exports = realMulter;
      }

      return {
        get destination() { return diskStorageConfig.destination; },
        get filename() { return diskStorageConfig.filename; },
        get fileFilter() { return uploadConfig.fileFilter; }
      };
    }

    afterEach(() => {
      delete require.cache[controllerPath];
      require('../../src/controllers/import-batch.controller');
    });

    it('destination: creates uploads dir when missing and calls back with it', async () => {
      const { destination } = await loadControllerWithCapturedMulterConfig();

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();

      destination({}, {}, cb);

      expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('uploads'), { recursive: true });
      expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('uploads'));
    });

    it('destination: skips mkdir when uploads dir already exists', async () => {
      const { destination } = await loadControllerWithCapturedMulterConfig();

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();

      destination({}, {}, cb);

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('uploads'));
    });

    it('filename: builds a unique suffixed name preserving the original extension', async () => {
      const { filename } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      filename({}, { originalname: 'patients.csv' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, generatedName] = cb.mock.calls[0];
      expect(err).toBeNull();
      expect(generatedName).toMatch(/^\d+-\d+\.csv$/);
    });

    it('fileFilter: rejects blocked extensions (.exe) with a 400 error', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'virus.exe', mimetype: 'application/octet-stream' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(err.message).toBe('Formato de arquivo não seguro');
      expect(err.status).toBe(400);
    });

    it('fileFilter: rejects disallowed mimetypes even with a safe extension', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'payload.csv', mimetype: 'application/x-msdownload' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(err.message).toBe('Formato de arquivo não seguro');
      expect(err.status).toBe(400);
    });

    it('fileFilter: accepts an allowed extension/mimetype combination', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'patients.csv', mimetype: 'text/csv' }, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  describe('uploadMiddleware', () => {
    it('returns a middleware function', () => {
      const mw = controller.uploadMiddleware();
      expect(typeof mw).toBe('function');
    });
  });

  describe('normalizeBatchStatus', () => {
    it('maps staged -> PENDING', () => {
      expect(controller.normalizeBatchStatus('staged')).toBe('PENDING');
    });

    it('maps queued -> PENDING', () => {
      expect(controller.normalizeBatchStatus('queued')).toBe('PENDING');
    });

    it('maps processing -> PROCESSING', () => {
      expect(controller.normalizeBatchStatus('processing')).toBe('PROCESSING');
    });

    it('maps completed -> COMPLETED', () => {
      expect(controller.normalizeBatchStatus('completed')).toBe('COMPLETED');
    });

    it('maps failed -> FAILED', () => {
      expect(controller.normalizeBatchStatus('failed')).toBe('FAILED');
    });

    it('maps unknown value -> PENDING (default fallback)', () => {
      expect(controller.normalizeBatchStatus('bogus')).toBe('PENDING');
    });

    it('maps undefined -> PENDING (default fallback)', () => {
      expect(controller.normalizeBatchStatus(undefined)).toBe('PENDING');
    });

    it('is case-insensitive (uppercase STAGED -> PENDING)', () => {
      expect(controller.normalizeBatchStatus('STAGED')).toBe('PENDING');
    });
  });

  describe('createBatchImport', () => {
    it('returns 400 when req.file is missing', async () => {
      const req = {};
      const res = createRes();

      await controller.createBatchImport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Arquivo não fornecido'
      });
    });

    it('happy path: returns 202 with correct body shape and cleans up temp file', async () => {
      const req = {
        file: { path: '/tmp/some-upload.csv', originalname: 'some-upload.csv' }
      };
      const res = createRes();

      const jobResult = {
        jobId: 'job-123',
        stagingImport: {
          jobId: 'staging-456',
          status: 'staged',
          fileName: 'some-upload.csv'
        }
      };

      vi.spyOn(stagingImportService, 'createBatchImportJob').mockResolvedValue(jobResult);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.createBatchImport(req, res);

      expect(stagingImportService.createBatchImportJob).toHaveBeenCalledWith(req.file);
      expect(fs.existsSync).toHaveBeenCalledWith(req.file.path);
      expect(unlinkSpy).toHaveBeenCalledWith(req.file.path);
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Arquivo recebido e job enfileirado para staging',
        data: {
          jobId: 'job-123',
          stagingImportId: 'staging-456',
          status: 'staged',
          fileName: 'some-upload.csv'
        }
      });
    });

    it('happy path: does not attempt cleanup when temp file does not exist', async () => {
      const req = {
        file: { path: '/tmp/gone.csv', originalname: 'gone.csv' }
      };
      const res = createRes();

      vi.spyOn(stagingImportService, 'createBatchImportJob').mockResolvedValue({
        jobId: 'job-1',
        stagingImport: { jobId: 's-1', status: 'staged', fileName: 'gone.csv' }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.createBatchImport(req, res);

      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('error path: returns 500, logs error, and still attempts temp-file cleanup', async () => {
      const req = {
        file: { path: '/tmp/broken.csv', originalname: 'broken.csv' }
      };
      const res = createRes();

      const error = new Error('service exploded');
      vi.spyOn(stagingImportService, 'createBatchImportJob').mockRejectedValue(error);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.createBatchImport(req, res);

      expect(loggerSpy).toHaveBeenCalledWith('Erro ao criar batch import:', error);
      expect(unlinkSpy).toHaveBeenCalledWith(req.file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao criar batch import',
        message: 'service exploded'
      });
    });
  });

  describe('getBatchImportStatus', () => {
    it('returns 400 when jobId param is missing', async () => {
      const req = { params: {} };
      const res = createRes();

      await controller.getBatchImportStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'jobId não fornecido'
      });
    });

    it('returns 404 when no matching StagingImport is found', async () => {
      const req = { params: { jobId: 'job-xyz' } };
      const res = createRes();

      const StagingImport = require('../../src/models/StagingImport');
      vi.spyOn(StagingImport, 'findOne').mockResolvedValue(null);

      await controller.getBatchImportStatus(req, res);

      expect(StagingImport.findOne).toHaveBeenCalledWith({ jobId: 'job-xyz' });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Lote não encontrado'
      });
    });

    it('happy path: totalRows === 0 yields progress 0', async () => {
      const req = { params: { jobId: 'job-zero' } };
      const res = createRes();

      const stagingImport = {
        jobId: 'job-zero',
        fileName: 'zero.csv',
        status: 'staged',
        totalRows: 0,
        processedRows: 0,
        importErrors: undefined,
        rawData: undefined,
        createdAt: 'c1',
        updatedAt: 'u1'
      };

      const StagingImport = require('../../src/models/StagingImport');
      vi.spyOn(StagingImport, 'findOne').mockResolvedValue(stagingImport);

      await controller.getBatchImportStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          jobId: 'job-zero',
          fileName: 'zero.csv',
          status: 'PENDING',
          rawStatus: 'staged',
          totalRows: 0,
          processedRows: 0,
          progress: 0,
          errors: [],
          rawData: {},
          createdAt: 'c1',
          updatedAt: 'u1'
        }
      });
    });

    it('happy path: computes rounded progress percentage from non-zero rows', async () => {
      const req = { params: { jobId: 'job-progress' } };
      const res = createRes();

      const stagingImport = {
        jobId: 'job-progress',
        fileName: 'progress.csv',
        status: 'processing',
        totalRows: 3,
        processedRows: 1,
        importErrors: ['row 2 bad'],
        rawData: { foo: 'bar' },
        createdAt: 'c2',
        updatedAt: 'u2'
      };

      const StagingImport = require('../../src/models/StagingImport');
      vi.spyOn(StagingImport, 'findOne').mockResolvedValue(stagingImport);

      await controller.getBatchImportStatus(req, res);

      // 1/3 * 100 = 33.33... -> rounds to 33
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          jobId: 'job-progress',
          fileName: 'progress.csv',
          status: 'PROCESSING',
          rawStatus: 'processing',
          totalRows: 3,
          processedRows: 1,
          progress: 33,
          errors: ['row 2 bad'],
          rawData: { foo: 'bar' },
          createdAt: 'c2',
          updatedAt: 'u2'
        }
      });
    });

    it('error path: returns 500 with error message when findOne throws', async () => {
      const req = { params: { jobId: 'job-err' } };
      const res = createRes();

      const error = new Error('db unreachable');
      const StagingImport = require('../../src/models/StagingImport');
      vi.spyOn(StagingImport, 'findOne').mockRejectedValue(error);
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.getBatchImportStatus(req, res);

      expect(loggerSpy).toHaveBeenCalledWith('Erro ao obter status do batch import:', error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao obter status do batch import',
        message: 'db unreachable'
      });
    });
  });
});
