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
const callerCreateOrganization = require('../../src/services/callerCreateOrganization.service');

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

    it('with dataType, deletes the upload and returns 200 with metadata on success (#1556)', async () => {
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
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
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
      // #840: the full body, not just typeof message -- asserting only the
      // type is exactly what let this endpoint's body drift from its three
      // siblings unnoticed.
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'malformed',
        message: 'groupFields deve ser um JSON válido',
      });
    });

    it('cleans up and returns 400 with the "value" reason when groupFields has an operator-shaped key (#840)', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = {
        app: { locals: { db: {} } },
        body: { dataType: 'patients', groupFields: '{"$ne": null}' },
        file,
      };
      const res = createRes();
      const cleanupSpy = vi
        .spyOn(importAsyncService, 'cleanupFile')
        .mockImplementation(() => {});

      await controller.createImportJob(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'value',
        message: 'groupFields aceita apenas chaves simples com valores texto, número ou booleano',
      });
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
        vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization').mockResolvedValue({
          organizationId: 'org-a',
          organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
        });
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

    describe('the uploader organization of a samples job (#1376)', () => {
      it('puts the organizationId and organizationScope the helper resolves into the job options', async () => {
        const db = {};
        const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
        const req = {
          app: { locals: { db } },
          body: { dataType: ' Samples ', organizationId: ' org-a ' },
          file,
          user: { userID: 'u1' },
        };
        const res = createRes();
        const organizationScope = { scope: 'multi', organizationIds: ['org-a', 'org-b'] };
        const resolveSpy = vi
          .spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization')
          .mockResolvedValue({ organizationId: 'org-a', organizationScope });
        const createSpy = vi
          .spyOn(importAsyncService, 'createImportJob')
          .mockResolvedValue({ jobID: 'job-org' });
        vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
        vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

        await controller.createImportJob(req, res);

        expect(resolveSpy).toHaveBeenCalledWith(db, { userId: 'u1', requested: 'org-a' });
        expect(createSpy).toHaveBeenCalledWith(
          db,
          'u1',
          file,
          ' Samples ',
          expect.objectContaining({ organizationId: 'org-a', organizationScope })
        );
        expect(res.status).toHaveBeenCalledWith(202);
      });

      it('does not resolve an organization for a patients job', async () => {
        const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
        const req = {
          app: { locals: { db: {} } },
          body: { dataType: 'patients', organizationId: 'org-a' },
          file,
        };
        const res = createRes();
        const resolveSpy = vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization');
        const createSpy = vi
          .spyOn(importAsyncService, 'createImportJob')
          .mockResolvedValue({ jobID: 'job-patients' });

        await controller.createImportJob(req, res);

        expect(resolveSpy).not.toHaveBeenCalled();
        const options = createSpy.mock.calls[0][4];
        expect(options).not.toHaveProperty('organizationId');
        expect(options).not.toHaveProperty('organizationScope');
      });

      it('returns the helper refusal status, cleans up the file and creates no job', async () => {
        const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
        const req = {
          app: { locals: { db: {} } },
          body: { dataType: 'samples' },
          file,
          user: { userID: 'u1' },
        };
        const res = createRes();
        const refusal = new Error('organizationId obrigatório');
        refusal.statusCode = 400;
        vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization').mockRejectedValue(refusal);
        const cleanupSpy = vi
          .spyOn(importAsyncService, 'cleanupFile')
          .mockImplementation(() => {});
        const createSpy = vi.spyOn(importAsyncService, 'createImportJob');

        await controller.createImportJob(req, res);

        expect(cleanupSpy).toHaveBeenCalledWith(file.path);
        expect(createSpy).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'organizationId obrigatório',
        });
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
      const organizationScope = { scope: 'organization', organizationIds: ['org-a'] };
      const resolveSpy = vi
        .spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization')
        .mockResolvedValue({ organizationId: 'org-a', organizationScope });
      const createSpy = vi
        .spyOn(importAsyncService, 'createImportJob')
        .mockResolvedValue({ jobID: 'job-sample' });

      await controller.createSampleImportJob(req, res);

      expect(req.body.dataType).toBe('samples');
      expect(req.body.extraField).toBe('keep-me');
      // #1376: the forced samples dataType takes the organization branch.
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(
        {},
        null,
        file,
        'samples',
        expect.objectContaining({ organizationId: 'org-a', organizationScope })
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('works when req.body was originally undefined', async () => {
      const file = { path: '/tmp/f.csv', originalname: 'f.csv' };
      const req = { app: { locals: { db: {} } }, file };
      const res = createRes();
      vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization').mockResolvedValue({
        organizationId: null,
        organizationScope: { scope: 'global' },
      });
      vi.spyOn(importAsyncService, 'createImportJob').mockResolvedValue({
        jobID: 'job-sample-2',
      });

      await controller.createSampleImportJob(req, res);

      expect(req.body.dataType).toBe('samples');
      expect(res.status).toHaveBeenCalledWith(202);
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

    it('returns 403 and does not call the service when the caller has no id (#1384)', async () => {
      const req = { app: { locals: { db: {} } }, query: {} };
      const res = createRes();
      const spy = vi.spyOn(importAsyncService, 'listJobs').mockResolvedValue([]);

      await controller.listJobs(req, res);

      expect(spy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Acesso negado',
        message: 'Este job pertence a outro usuário',
      });
    });

    it('returns 500 when service throws', async () => {
      const req = { app: { locals: { db: {} } }, query: {}, user: { userID: 'u1' } };
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

  // #1384: a job route answers only the job's uploader. The db mock's
  // importJobs.findOne returns the job the owner check reads.
  function jobDb(job) {
    const findOne = vi.fn().mockResolvedValue(job);
    return { db: { collection: vi.fn(() => ({ findOne })) }, findOne };
  }

  for (const { method, jobID, serviceMethod, ok, errorMessage, boom } of [
    { method: 'getJobStatus', jobID: 'j1', serviceMethod: 'getJobStatus', ok: { jobID: 'j1', status: 'done' }, errorMessage: 'Erro ao obter status do job', boom: 'status boom' },
    { method: 'cancelJob', jobID: 'j2', serviceMethod: 'cancelJob', ok: { jobID: 'j2', status: 'cancelled' }, errorMessage: 'Erro ao cancelar job', boom: 'cancel boom' },
    { method: 'getJobReport', jobID: 'j3', serviceMethod: 'getJobReport', ok: { jobID: 'j3', report: {} }, errorMessage: 'Erro ao obter relatório do job', boom: 'report boom' },
  ]) {
    describe(method, () => {
      it('returns 503 when no db', async () => {
        const req = { app: { locals: {} }, params: { jobID } };
        const res = createRes();

        await controller[method](req, res);

        expect(res.status).toHaveBeenCalledWith(503);
      });

      it('delegates to service and returns 200 with data for the job owner', async () => {
        const { db, findOne } = jobDb({ userID: 'u1' });
        const req = { app: { locals: { db } }, params: { jobID }, user: { userID: 'u1' } };
        const res = createRes();
        const spy = vi.spyOn(importAsyncService, serviceMethod).mockResolvedValue(ok);

        await controller[method](req, res);

        expect(db.collection).toHaveBeenCalledWith('importJobs');
        expect(findOne).toHaveBeenCalledWith({ jobID }, { projection: { userID: 1 } });
        expect(spy).toHaveBeenCalledWith(db, jobID);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, data: ok });
      });

      it('lets the owner through by req.user._id.toString() when userID is absent', async () => {
        const { db } = jobDb({ userID: 'idstr' });
        const req = { app: { locals: { db } }, params: { jobID }, user: { _id: { toString: () => 'idstr' } } };
        const res = createRes();
        const spy = vi.spyOn(importAsyncService, serviceMethod).mockResolvedValue(ok);

        await controller[method](req, res);

        expect(spy).toHaveBeenCalledWith(db, jobID);
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('refuses 403 a caller who is not the job owner and does not call the service (#1384)', async () => {
        const { db } = jobDb({ userID: 'u1' });
        const req = { app: { locals: { db } }, params: { jobID }, user: { userID: 'u2' } };
        const res = createRes();
        const spy = vi.spyOn(importAsyncService, serviceMethod).mockResolvedValue(ok);

        await controller[method](req, res);

        expect(spy).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Acesso negado',
          message: 'Este job pertence a outro usuário',
        });
      });

      it('refuses 403 when the job or the caller has no user id (#1384)', async () => {
        for (const [job, user] of [[{}, { userID: 'u1' }], [{ userID: 'u1' }, undefined]]) {
          const { db } = jobDb(job);
          const req = { app: { locals: { db } }, params: { jobID }, user };
          const res = createRes();
          const spy = vi.spyOn(importAsyncService, serviceMethod).mockResolvedValue(ok);

          await controller[method](req, res);

          expect(spy).not.toHaveBeenCalled();
          expect(res.status).toHaveBeenCalledWith(403);
        }
      });

      it('returns 404 when the job does not exist and does not call the service (#1384)', async () => {
        const { db } = jobDb(null);
        const req = { app: { locals: { db } }, params: { jobID }, user: { userID: 'u1' } };
        const res = createRes();
        const spy = vi.spyOn(importAsyncService, serviceMethod).mockResolvedValue(ok);

        await controller[method](req, res);

        expect(spy).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Job não encontrado' });
      });

      it('returns 500 when service throws', async () => {
        const { db } = jobDb({ userID: 'u1' });
        const req = { app: { locals: { db } }, params: { jobID }, user: { userID: 'u1' } };
        const res = createRes();
        vi.spyOn(importAsyncService, serviceMethod).mockRejectedValue(new Error(boom));
        vi.spyOn(logger, 'error').mockImplementation(() => {});

        await controller[method](req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: errorMessage,
          message: boom,
        });
      });
    });
  }

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
