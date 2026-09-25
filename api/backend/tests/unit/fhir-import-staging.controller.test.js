import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/fhir-import-staging.controller');
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

describe('fhir-import-staging.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadMiddleware', () => {
    it('returns a middleware function', () => {
      const mw = controller.uploadMiddleware();
      expect(typeof mw).toBe('function');
    });
  });

  describe('stage', () => {
    it('happy path: parses uploaded JSON file and stages the bundle', async () => {
      const bundle = { resourceType: 'Bundle', entry: [] };
      const req = {
        app: { locals: { db: 'the-db' } },
        file: { buffer: Buffer.from(JSON.stringify(bundle)), originalname: 'bundle.json' },
        body: {},
        user: { userID: 'u-1' }
      };
      const res = createRes();

      const result = { batch: { id: 'b-1' }, records: [{ id: 'r-1' }] };
      vi.spyOn(fhirImportStagingService, 'stageBundle').mockResolvedValue(result);

      await controller.stage(req, res);

      expect(fhirImportStagingService.stageBundle).toHaveBeenCalledWith('the-db', bundle, {
        fileName: 'bundle.json',
        userID: 'u-1',
        organizationScope: null,
        organizationId: null,
        organizationIds: [],
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        batch: result.batch,
        records: result.records
      });
    });

    it('falls back to req.body when no file is uploaded', async () => {
      const payload = { resourceType: 'Bundle' };
      const req = {
        app: { locals: { db: 'the-db' } },
        body: payload,
        user: { id: 'u-2' }
      };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'stageBundle').mockResolvedValue({ batch: {}, records: [] });

      await controller.stage(req, res);

      expect(fhirImportStagingService.stageBundle).toHaveBeenCalledWith('the-db', payload, {
        fileName: undefined,
        userID: null,
        organizationScope: null,
        organizationId: null,
        organizationIds: [],
      });
    });

    it('falls back to null userID when req.user is absent', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        body: { resourceType: 'Bundle' }
      };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'stageBundle').mockResolvedValue({ batch: {}, records: [] });

      await controller.stage(req, res);

      expect(fhirImportStagingService.stageBundle).toHaveBeenCalledWith('the-db', expect.anything(), {
        fileName: undefined,
        userID: null,
        organizationScope: null,
        organizationId: null,
        organizationIds: [],
      });
    });

    it('returns 400 with a Portuguese message when the uploaded file is invalid JSON', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        file: { buffer: Buffer.from('not json'), originalname: 'broken.json' },
        body: {}
      };
      const res = createRes();

      await controller.stage(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Arquivo JSON FHIR inválido.'
      });
    });

    it('returns 500 with a default message when the service throws an error without statusCode/message', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        body: { resourceType: 'Bundle' }
      };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'stageBundle').mockRejectedValue(undefined);

      await controller.stage(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Erro no staging FHIR'
      });
    });

    it('returns the error statusCode/message when the service throws a typed error', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        body: { resourceType: 'Bundle' }
      };
      const res = createRes();

      const error = new Error('lote inválido');
      error.statusCode = 422;
      vi.spyOn(fhirImportStagingService, 'stageBundle').mockRejectedValue(error);

      await controller.stage(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'lote inválido'
      });
    });
  });

  describe('getBatch', () => {
    it('happy path: returns 200 with the batch result', async () => {
      const organizationScope = { scope: 'organization', organizationIds: ['org-1'] };
      const req = {
        app: { locals: { db: 'the-db' } },
        params: { id: 'batch-1' },
        organizationScope,
      };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'getBatch').mockResolvedValue({ batch: { id: 'batch-1' } });

      await controller.getBatch(req, res);

      expect(fhirImportStagingService.getBatch).toHaveBeenCalledWith('the-db', 'batch-1', {
        organizationScope,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, batch: { id: 'batch-1' } });
    });

    it('error path: returns the thrown error statusCode/message', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'missing' } };
      const res = createRes();

      const error = new Error('Lote não encontrado');
      error.statusCode = 404;
      vi.spyOn(fhirImportStagingService, 'getBatch').mockRejectedValue(error);

      await controller.getBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Lote não encontrado' });
    });
  });

  describe('validate', () => {
    it('happy path: returns 200 with validation result', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-2' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'validateBatch').mockResolvedValue({ valid: true });

      await controller.validate(req, res);

      expect(fhirImportStagingService.validateBatch).toHaveBeenCalledWith('the-db', 'batch-2');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, valid: true });
    });

    it('error path: returns 500 default message when service rejects without a message', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-2' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'validateBatch').mockRejectedValue({});

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Erro no staging FHIR' });
    });
  });

  describe('sendConsents', () => {
    it('happy path: forwards userID and returns 200', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-3' }, user: { userID: 'u-3' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'sendConsents').mockResolvedValue({ sent: 2 });

      await controller.sendConsents(req, res);

      expect(fhirImportStagingService.sendConsents).toHaveBeenCalledWith('the-db', 'batch-3', { userID: 'u-3' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, sent: 2 });
    });

    it('falls back to null userID when req.user is absent', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-3' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'sendConsents').mockResolvedValue({ sent: 0 });

      await controller.sendConsents(req, res);

      expect(fhirImportStagingService.sendConsents).toHaveBeenCalledWith('the-db', 'batch-3', { userID: null });
    });

    it('error path: returns the thrown error statusCode/message', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-3' } };
      const res = createRes();

      const error = new Error('consent service down');
      error.statusCode = 503;
      vi.spyOn(fhirImportStagingService, 'sendConsents').mockRejectedValue(error);

      await controller.sendConsents(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'consent service down' });
    });
  });

  describe('consentStatus', () => {
    it('happy path: returns 200 with the consent status', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-4' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'getConsentStatus').mockResolvedValue({ status: 'PENDING' });

      await controller.consentStatus(req, res);

      expect(fhirImportStagingService.getConsentStatus).toHaveBeenCalledWith('the-db', 'batch-4');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, status: 'PENDING' });
    });

    it('error path: returns 500 default message when service rejects with a message-less error', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-4' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'getConsentStatus').mockRejectedValue(new Error());

      await controller.consentStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Erro no staging FHIR' });
    });
  });

  describe('commit', () => {
    it('happy path: returns 200 with the commit result', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-5' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'commitBatch').mockResolvedValue({ committed: true });

      await controller.commit(req, res);

      expect(fhirImportStagingService.commitBatch).toHaveBeenCalledWith('the-db', 'batch-5');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, committed: true });
    });

    it('error path: returns the thrown error statusCode/message', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-5' } };
      const res = createRes();

      const error = new Error('cannot commit');
      error.statusCode = 409;
      vi.spyOn(fhirImportStagingService, 'commitBatch').mockRejectedValue(error);

      await controller.commit(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'cannot commit' });
    });
  });

  describe('attachExternalDocument', () => {
    it('happy path: forwards userID, note, and returns 200', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        params: { id: 'batch-6', recordId: 'rec-1' },
        user: { userID: 'u-6' },
        body: { note: 'signed consent' }
      };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'attachExternalDocument').mockResolvedValue({ attached: true });

      await controller.attachExternalDocument(req, res);

      expect(fhirImportStagingService.attachExternalDocument).toHaveBeenCalledWith('the-db', 'batch-6', 'rec-1', {
        userID: 'u-6',
        note: 'signed consent'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, attached: true });
    });

    it('falls back to null userID and undefined note when req.user/req.body are absent', async () => {
      const req = { app: { locals: { db: 'the-db' } }, params: { id: 'batch-6', recordId: 'rec-1' } };
      const res = createRes();

      vi.spyOn(fhirImportStagingService, 'attachExternalDocument').mockResolvedValue({ attached: true });

      await controller.attachExternalDocument(req, res);

      expect(fhirImportStagingService.attachExternalDocument).toHaveBeenCalledWith('the-db', 'batch-6', 'rec-1', {
        userID: null,
        note: undefined
      });
    });

    it('error path: returns the thrown error statusCode/message', async () => {
      const req = {
        app: { locals: { db: 'the-db' } },
        params: { id: 'batch-6', recordId: 'rec-1' },
        body: {}
      };
      const res = createRes();

      const error = new Error('record not found');
      error.statusCode = 404;
      vi.spyOn(fhirImportStagingService, 'attachExternalDocument').mockRejectedValue(error);

      await controller.attachExternalDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'record not found' });
    });
  });
});
