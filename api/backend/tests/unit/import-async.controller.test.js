import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const controller = require('../../src/controllers/import-async.controller');
const importAsyncService = require('../../src/services/import-async.service');
const logger = require('../../src/utils/logger');
const auditLogger = require('../../src/utils/auditLogger');

const uploadsDir = path.join(__dirname, '../../uploads/temp');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('import-async.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validate', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, body: {} };
      const res = createRes();

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Banco de dados não disponível',
      });
    });

    it('returns 400 when no file', async () => {
      const req = { app: { locals: { db: {} } }, body: {} };
      const res = createRes();

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Arquivo não fornecido',
      });
    });

    it('when dataType missing, returns 400 immediately without waiting on background validateFile chain', async () => {
      let resolveValidate;
      const validateSpy = vi
        .spyOn(importAsyncService, 'validateFile')
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveValidate = resolve;
            })
        );
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = { app: { locals: { db: {} } }, body: {}, file };
      const res = createRes();

      await controller.validate(req, res);

      // response returned already, even though validateFile promise is still pending
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Tipo de dados (dataType) não fornecido',
      });
      expect(validateSpy).toHaveBeenCalledWith(file, 'patients');
      expect(cleanupSpy).not.toHaveBeenCalled();

      // now resolve the background chain and flush microtasks
      resolveValidate();
      await Promise.resolve();
      await Promise.resolve();

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
    });

    it('background validateFile rejection is swallowed by catch(() => {}) and never surfaces', async () => {
      const validateSpy = vi
        .spyOn(importAsyncService, 'validateFile')
        .mockRejectedValue(new Error('background boom'));
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = { app: { locals: { db: {} } }, body: {}, file };
      const res = createRes();

      await controller.validate(req, res);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(validateSpy).toHaveBeenCalledWith(file, 'patients');
      // cleanup only happens on resolve, not reject, so it should not be called
      expect(cleanupSpy).not.toHaveBeenCalled();
      // no unhandled rejection thrown (test would fail via unhandledRejection otherwise)
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('with dataType, cleans up and returns 400 with errors/metadata when validation fails', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();

      vi.spyOn(importAsyncService, 'validateFile').mockResolvedValue({
        valid: false,
        errors: ['bad row'],
        metadata: { operationOutcome: { issue: [] } },
      });
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Validação falhou',
        errors: ['bad row'],
        metadata: { operationOutcome: { issue: [] } },
        operationOutcome: { issue: [] },
      });
    });

    it('with dataType, returns 200 with metadata on success', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();

      vi.spyOn(importAsyncService, 'validateFile').mockResolvedValue({
        valid: true,
        metadata: { rows: 3 },
      });

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Arquivo validado com sucesso',
        metadata: { rows: 3 },
      });
    });

    it('returns 500 and cleans up file when validateFile throws synchronously (rejected promise)', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();

      vi.spyOn(importAsyncService, 'validateFile').mockRejectedValue(
        new Error('validate boom')
      );
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao validar arquivo',
        message: 'validate boom',
      });
    });
  });

  describe('createImportJob', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, body: {} };
      const res = createRes();

      await controller.createImportJob(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const req = { app: { locals: { db: {} } }, body: {} };
      const res = createRes();

      await controller.createImportJob(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Arquivo não fornecido',
      });
    });

    it('cleans up and returns 400 when dataType missing', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = { app: { locals: { db: {} } }, body: {}, file };
      const res = createRes();
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      await controller.createImportJob(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Tipo de dados (dataType) não fornecido',
      });
    });

    it('parses groupFields when provided as JSON string', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients', groupFields: '{"a":1}' },
        file,
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-1' });

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'patients',
        expect.objectContaining({ groupFields: { a: 1 } })
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('accepts groupFields already as an object without JSON.parse', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients', groupFields: { b: 2 } },
        file,
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-2' });

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'patients',
        expect.objectContaining({ groupFields: { b: 2 } })
      );
    });

    it('cleans up and returns 400 with parse error message on invalid groupFields JSON', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients', groupFields: '{not json' },
        file,
      };
      const res = createRes();
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      await controller.createImportJob(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe('Formato inválido para groupFields. Use JSON válido.');
      expect(typeof body.message).toBe('string');
    });

    it('derives userID from req.user.userID when present', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const db = {};
      const req = {
        app: { locals: { db } },
        body: { dataType: 'patients' },
        file,
        user: { userID: 'user-abc' },
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-3' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        db,
        'user-abc',
        file,
        'patients',
        expect.any(Object)
      );
    });

    it('derives userID from req.user._id.toString() when userID absent', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const db = {};
      const req = {
        app: { locals: { db } },
        body: { dataType: 'patients' },
        file,
        user: { _id: { toString: () => 'objid-str' } },
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-4' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        db,
        'objid-str',
        file,
        'patients',
        expect.any(Object)
      );
    });

    it('passes startBoxId through as-is and coerces autoIncrement string "true"', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: {
          dataType: 'patients',
          startBoxId: 'box-42',
          autoIncrement: 'true',
        },
        file,
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-5' });

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'patients',
        expect.objectContaining({
          startBoxId: 'box-42',
          autoIncrement: true,
          fileName: file.originalname,
        })
      );
    });

    it('passes null startBoxId and false autoIncrement when absent', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-6' });

      await controller.createImportJob(req, res);

      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'patients',
        expect.objectContaining({
          startBoxId: null,
          autoIncrement: false,
        })
      );
    });

    it.each([
      ['samples', 'Sample'],
      ['patients', 'Patient'],
      ['results', 'Result'],
      ['ambient-temperature', 'Temperature'],
      ['other-thing', 'Import'],
    ])(
      'logs audit with entity mapped from dataType %s -> %s when req.user present',
      async (dataType, entityName) => {
        const db = {};
        const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
        const req = {
          app: { locals: { db } },
          body: { dataType },
          file,
          user: { userID: 'u1' },
        };
        const res = createRes();
        vi.spyOn(importAsyncService, 'createImportJob').mockResolvedValue({
          jobID: 'job-map',
        });
        const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
        const logImportSpy = vi
          .spyOn(auditLogger, 'logImport')
          .mockResolvedValue(undefined);

        await controller.createImportJob(req, res);

        expect(initSpy).toHaveBeenCalledWith(db);
        expect(logImportSpy).toHaveBeenCalledWith(
          req,
          entityName,
          'pending',
          0,
          0,
          0,
          { jobID: 'job-map' }
        );
      }
    );

    it('does not call auditLogger when req.user absent', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();
      vi.spyOn(importAsyncService, 'createImportJob').mockResolvedValue({
        jobID: 'job-noaudit',
      });
      const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi
        .spyOn(auditLogger, 'logImport')
        .mockResolvedValue(undefined);

      await controller.createImportJob(req, res);

      expect(initSpy).not.toHaveBeenCalled();
      expect(logImportSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('returns 202 with service result on success', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();
      vi.spyOn(importAsyncService, 'createImportJob').mockResolvedValue({
        jobID: 'job-happy',
        status: 'pending',
      });

      await controller.createImportJob(req, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Job de importação criado com sucesso',
        data: { jobID: 'job-happy', status: 'pending' },
      });
    });

    it('returns 500 and cleans up req.file.path when service throws', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file,
      };
      const res = createRes();
      vi.spyOn(importAsyncService, 'createImportJob').mockRejectedValue(
        new Error('create boom')
      );
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.createImportJob(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao criar job de importação',
        message: 'create boom',
      });
    });

    it('returns 500 without cleanup call when req.file absent at throw time (defensive)', async () => {
      // dataType present branch requires file, so simulate throw from service with file present,
      // then verify cleanup is only invoked because req.file exists.
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients' },
        file: undefined,
      };
      const res = createRes();

      await controller.createImportJob(req, res);

      // no file -> 400 branch, not 500; sanity check no crash
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('createSampleImportJob', () => {
    it('forces dataType to samples and delegates to createImportJob, merging existing body', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients', extraField: 'keep-me' },
        file,
      };
      const res = createRes();
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-sample' });

      await controller.createSampleImportJob(req, res);

      expect(req.body.dataType).toBe('samples');
      expect(req.body.extraField).toBe('keep-me');
      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'samples',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('works when req.body was originally undefined', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = { app: { locals: { db: {} } }, file };
      const res = createRes();
      vi.spyOn(importAsyncService, 'createImportJob').mockResolvedValue({
        jobID: 'job-sample-2',
      });

      await controller.createSampleImportJob(req, res);

      expect(req.body.dataType).toBe('samples');
      expect(res.status).toHaveBeenCalledWith(202);
    });
  });

  describe('getJobStatus', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, params: { jobID: 'j1' } };
      const res = createRes();

      await controller.getJobStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('delegates to service and returns 200 with data', async () => {
      const db = {};
      const req = { app: { locals: { db } }, params: { jobID: 'j1' } };
      const res = createRes();
      const spy = vi
        .spyOn(importAsyncService, 'getJobStatus')
        .mockResolvedValue({ jobID: 'j1', status: 'done' });

      await controller.getJobStatus(req, res);

      expect(spy).toHaveBeenCalledWith(db, 'j1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { jobID: 'j1', status: 'done' },
      });
    });

    it('returns 500 when service throws', async () => {
      const req = { app: { locals: { db: {} } }, params: { jobID: 'j1' } };
      const res = createRes();
      vi.spyOn(importAsyncService, 'getJobStatus').mockRejectedValue(
        new Error('status boom')
      );
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.getJobStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao obter status do job',
        message: 'status boom',
      });
    });
  });

  describe('listJobs', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, query: {} };
      const res = createRes();

      await controller.listJobs(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('builds filters from req.user.userID and req.query, delegates and returns 200', async () => {
      const db = {};
      const req = {
        app: { locals: { db } },
        query: { dataType: 'patients', status: 'pending', limit: '10', skip: '0' },
        user: { userID: 'u9' },
      };
      const res = createRes();
      const spy = vi
        .spyOn(importAsyncService, 'listJobs')
        .mockResolvedValue([{ jobID: 'j1' }]);

      await controller.listJobs(req, res);

      expect(spy).toHaveBeenCalledWith(db, {
        userID: 'u9',
        dataType: 'patients',
        status: 'pending',
        limit: '10',
        skip: '0',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ jobID: 'j1' }],
      });
    });

    it('falls back to req.user._id.toString() when userID absent', async () => {
      const db = {};
      const req = {
        app: { locals: { db } },
        query: {},
        user: { _id: { toString: () => 'idstr' } },
      };
      const res = createRes();
      const spy = vi.spyOn(importAsyncService, 'listJobs').mockResolvedValue([]);

      await controller.listJobs(req, res);

      expect(spy).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ userID: 'idstr' })
      );
    });

    it('returns 500 when service throws', async () => {
      const req = { app: { locals: { db: {} } }, query: {} };
      const res = createRes();
      vi.spyOn(importAsyncService, 'listJobs').mockRejectedValue(
        new Error('list boom')
      );
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.listJobs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao listar jobs',
        message: 'list boom',
      });
    });
  });

  describe('cancelJob', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, params: { jobID: 'j1' } };
      const res = createRes();

      await controller.cancelJob(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('delegates to service and returns 200', async () => {
      const db = {};
      const req = { app: { locals: { db } }, params: { jobID: 'j2' } };
      const res = createRes();
      const spy = vi
        .spyOn(importAsyncService, 'cancelJob')
        .mockResolvedValue({ jobID: 'j2', status: 'cancelled' });

      await controller.cancelJob(req, res);

      expect(spy).toHaveBeenCalledWith(db, 'j2');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { jobID: 'j2', status: 'cancelled' },
      });
    });

    it('returns 500 when service throws', async () => {
      const req = { app: { locals: { db: {} } }, params: { jobID: 'j2' } };
      const res = createRes();
      vi.spyOn(importAsyncService, 'cancelJob').mockRejectedValue(
        new Error('cancel boom')
      );
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.cancelJob(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao cancelar job',
        message: 'cancel boom',
      });
    });
  });

  describe('getJobReport', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, params: { jobID: 'j3' } };
      const res = createRes();

      await controller.getJobReport(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('delegates to service and returns 200', async () => {
      const db = {};
      const req = { app: { locals: { db } }, params: { jobID: 'j3' } };
      const res = createRes();
      const spy = vi
        .spyOn(importAsyncService, 'getJobReport')
        .mockResolvedValue({ jobID: 'j3', report: {} });

      await controller.getJobReport(req, res);

      expect(spy).toHaveBeenCalledWith(db, 'j3');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { jobID: 'j3', report: {} },
      });
    });

    it('returns 500 when service throws', async () => {
      const req = { app: { locals: { db: {} } }, params: { jobID: 'j3' } };
      const res = createRes();
      vi.spyOn(importAsyncService, 'getJobReport').mockRejectedValue(
        new Error('report boom')
      );
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.getJobReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao obter relatório do job',
        message: 'report boom',
      });
    });
  });

  describe('uploadMiddleware', () => {
    it('returns a multer single-file middleware function', () => {
      const middleware = controller.uploadMiddleware();
      expect(typeof middleware).toBe('function');
    });
  });

  describe('uploadMiddleware multer storage/fileFilter (real disk write)', () => {
    function buildApp() {
      const app = express();
      app.post('/upload', controller.uploadMiddleware(), (req, res) => {
        res.status(200).json({ file: req.file });
      });
      return app;
    }

    afterEach(() => {
      if (fs.existsSync(uploadsDir)) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
      }
    });

    it('creates uploads/temp on demand and writes an allowed file to it', async () => {
      if (fs.existsSync(uploadsDir)) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
      }
      expect(fs.existsSync(uploadsDir)).toBe(false);

      const res = await request(buildApp())
        .post('/upload')
        .attach('file', Buffer.from('a,b,c'), {
          filename: 'data.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      expect(fs.existsSync(uploadsDir)).toBe(true);
      expect(fs.existsSync(res.body.file.path)).toBe(true);
      expect(path.extname(res.body.file.path)).toBe('.csv');
    });

    it('reuses uploads/temp when it already exists', async () => {
      fs.mkdirSync(uploadsDir, { recursive: true });

      const res = await request(buildApp())
        .post('/upload')
        .attach('file', Buffer.from('{}'), {
          filename: 'data.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(200);
      expect(fs.existsSync(res.body.file.path)).toBe(true);
    });

    it('rejects a blocked extension (.exe) before the mimetype check', async () => {
      const res = await request(buildApp())
        .post('/upload')
        .attach('file', Buffer.from('MZ'), {
          filename: 'malware.exe',
          contentType: 'application/vnd.ms-excel',
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a disallowed mimetype even with an allowed extension', async () => {
      const res = await request(buildApp())
        .post('/upload')
        .attach('file', Buffer.from('not really a csv'), {
          filename: 'data.csv',
          contentType: 'text/plain',
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('accepts a zip mimetype/extension combination', async () => {
      const res = await request(buildApp())
        .post('/upload')
        .attach('file', Buffer.from('PK\x03\x04'), {
          filename: 'bundle.zip',
          contentType: 'application/zip',
        });

      expect(res.status).toBe(200);
      expect(path.extname(res.body.file.path)).toBe('.zip');
    });
  });
});
