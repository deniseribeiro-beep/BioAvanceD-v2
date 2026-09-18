import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const accessController = require('../../src/controllers/accessRequest.controller');
const nonconformanceController = require('../../src/controllers/nonconformance.controller');
const legalHoldController = require('../../src/controllers/legalHold.controller');
const dispositionController = require('../../src/controllers/dispositionAction.controller');

const accessService = require('../../src/services/accessRequest.service');
const nonconformanceService = require('../../src/services/nonconformance.service');
const legalHoldService = require('../../src/services/legalHold.service');
const dispositionService = require('../../src/services/dispositionAction.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

function makeRes() {
  const res = {};
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeReq(overrides = {}) {
  return {
    app: { locals: { db: { marker: 'db' } } },
    user: { userID: 'user-1' },
    params: { id: 'entity-1' },
    body: {},
    ...overrides,
  };
}

async function invoke(controller, method, req) {
  const res = makeRes();
  await controller[method](req, res);
  return res;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
});

describe('item 8 governance controller coverage', () => {
  describe('AccessRequestController', () => {
    const methods = [
      'createAccessRequest',
      'evaluateCompatibility',
      'recordDecision',
      'distribute',
      'revoke',
      'getAccessCheck',
      'getById',
      'getAll',
    ];

    it.each(methods)('%s returns 503 without a database', async (method) => {
      const res = await invoke(accessController, method, makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);
    });

    it('creates and audits an access request, and skips audit without an authenticated user', async () => {
      const record = {
        accessRequestId: 'AR-1',
        requesterId: 'r1',
        studyId: 'study-1',
        requestedItems: ['specimen-1'],
      };
      vi.spyOn(accessService, 'createRequest').mockResolvedValue(record);

      let req = makeReq({ body: { studyId: 'study-1' } });
      let res = await invoke(accessController, 'createAccessRequest', req);
      expect(res.statusCode).toBe(201);
      expect(accessService.createRequest).toHaveBeenCalledWith(req.app.locals.db, req.body);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE',
        resourceId: 'AR-1',
      }));

      auditLogger.log.mockClear();
      req = makeReq({ user: null, body: { studyId: 'study-1' } });
      res = await invoke(accessController, 'createAccessRequest', req);
      expect(res.statusCode).toBe(201);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('evaluates compatibility, records a decision, distributes and revokes with/without an actor', async () => {
      vi.spyOn(accessService, 'evaluateCompatibility').mockResolvedValue({
        accessRequestId: 'AR-1',
        overallCompatible: true,
        consentCompatibility: { permitted: true },
      });
      let res = await invoke(accessController, 'evaluateCompatibility', makeReq());
      expect(res.statusCode).toBe(200);

      vi.spyOn(accessService, 'recordDecision').mockResolvedValue({
        accessRequestId: 'AR-1',
        committeeDecision: { status: 'approved' },
        approvalPeriod: { startsAt: '2026-09-18' },
      });
      let req = makeReq({ body: { status: 'approved' } });
      res = await invoke(accessController, 'recordDecision', req);
      expect(res.statusCode).toBe(200);
      expect(accessService.recordDecision).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', req.body, 'user-1'
      );

      req = makeReq({ user: null, body: undefined });
      res = await invoke(accessController, 'recordDecision', req);
      expect(res.statusCode).toBe(200);
      expect(accessService.recordDecision).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', {}, null
      );

      vi.spyOn(accessService, 'markDistributed').mockResolvedValue({
        accessRequestId: 'AR-1',
        distributionStatus: 'distributed',
        distributedAt: new Date('2026-09-18T12:00:00Z'),
      });
      res = await invoke(accessController, 'distribute', makeReq());
      expect(res.statusCode).toBe(200);

      vi.spyOn(accessService, 'revokeAccess').mockResolvedValue({
        accessRequestId: 'AR-1',
        committeeDecision: { status: 'revoked' },
      });
      req = makeReq({ body: { justification: 'withdrawn approval' } });
      res = await invoke(accessController, 'revoke', req);
      expect(res.statusCode).toBe(200);
      expect(accessService.revokeAccess).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', 'withdrawn approval', 'user-1'
      );

      req = makeReq({ user: null, body: undefined });
      await invoke(accessController, 'revoke', req);
      expect(accessService.revokeAccess).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', undefined, null
      );
    });

    it('covers access-check and get-by-id found/not-found paths plus getAll', async () => {
      vi.spyOn(accessService, 'getAccessCheck')
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce(null);
      let res = await invoke(accessController, 'getAccessCheck', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(accessController, 'getAccessCheck', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(accessService, 'getById')
        .mockResolvedValueOnce({ accessRequestId: 'AR-1' })
        .mockResolvedValueOnce(null);
      res = await invoke(accessController, 'getById', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(accessController, 'getById', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(accessService, 'getAll').mockResolvedValue([{ accessRequestId: 'AR-1' }]);
      res = await invoke(accessController, 'getAll', makeReq());
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it.each([
      ['createAccessRequest', 'createRequest', 400],
      ['evaluateCompatibility', 'evaluateCompatibility', 400],
      ['recordDecision', 'recordDecision', 400],
      ['distribute', 'markDistributed', 400],
      ['revoke', 'revokeAccess', 400],
      ['getAccessCheck', 'getAccessCheck', 500],
      ['getById', 'getById', 400],
      ['getAll', 'getAll', 500],
    ])('%s maps service failure to the controller error status', async (method, serviceMethod, status) => {
      vi.spyOn(accessService, serviceMethod).mockRejectedValue(new Error('synthetic failure'));
      const res = await invoke(accessController, method, makeReq());
      expect(res.statusCode).toBe(status);
      expect(res.body.message).toBe('synthetic failure');
    });
  });

  describe('NonconformanceController', () => {
    const methods = ['open', 'recordCorrectiveAction', 'verifyEffectiveness', 'getById', 'getAll'];

    it.each(methods)('%s returns 503 without a database', async (method) => {
      const res = await invoke(nonconformanceController, method, makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);
    });

    it('opens using body detectedBy, then user fallback and anonymous null', async () => {
      vi.spyOn(nonconformanceService, 'open').mockImplementation(async (_db, data) => ({
        nonconformanceId: 'NC-1',
        nonconformanceType: 'quality',
        affectedEntityIds: ['spec-1'],
        detectedBy: data.detectedBy,
      }));

      let req = makeReq({ body: { detectedBy: 'explicit' } });
      let res = await invoke(nonconformanceController, 'open', req);
      expect(res.statusCode).toBe(201);
      expect(nonconformanceService.open.mock.calls.at(-1)[1].detectedBy).toBe('explicit');

      req = makeReq({ body: {} });
      await invoke(nonconformanceController, 'open', req);
      expect(nonconformanceService.open.mock.calls.at(-1)[1].detectedBy).toBe('user-1');

      req = makeReq({ user: null, body: {} });
      await invoke(nonconformanceController, 'open', req);
      expect(nonconformanceService.open.mock.calls.at(-1)[1].detectedBy).toBeNull();
    });

    it('records corrective action and verifies effectiveness with actor fallbacks', async () => {
      vi.spyOn(nonconformanceService, 'recordCorrectiveAction').mockResolvedValue({
        nonconformanceId: 'NC-1',
        correctiveAction: { action: 'reprocess' },
      });
      let req = makeReq({ body: undefined });
      let res = await invoke(nonconformanceController, 'recordCorrectiveAction', req);
      expect(res.statusCode).toBe(200);
      expect(nonconformanceService.recordCorrectiveAction).toHaveBeenCalledWith(
        req.app.locals.db, 'entity-1', {}
      );

      vi.spyOn(nonconformanceService, 'verifyEffectiveness').mockImplementation(async (_db, _id, data) => ({
        nonconformanceId: 'NC-1',
        effectivenessVerification: { outcome: 'effective', verifiedBy: data.verifiedBy },
        status: 'closed',
      }));
      req = makeReq({ body: {} });
      await invoke(nonconformanceController, 'verifyEffectiveness', req);
      expect(nonconformanceService.verifyEffectiveness.mock.calls.at(-1)[2].verifiedBy).toBe('user-1');

      req = makeReq({ user: null, body: {} });
      await invoke(nonconformanceController, 'verifyEffectiveness', req);
      expect(nonconformanceService.verifyEffectiveness.mock.calls.at(-1)[2].verifiedBy).toBeNull();
    });

    it('covers getById found/not-found and getAll success', async () => {
      vi.spyOn(nonconformanceService, 'getById')
        .mockResolvedValueOnce({ nonconformanceId: 'NC-1' })
        .mockResolvedValueOnce(null);
      let res = await invoke(nonconformanceController, 'getById', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(nonconformanceController, 'getById', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(nonconformanceService, 'getAll').mockResolvedValue([{ nonconformanceId: 'NC-1' }]);
      res = await invoke(nonconformanceController, 'getAll', makeReq());
      expect(res.statusCode).toBe(200);
    });

    it.each([
      ['open', 'open', 400],
      ['recordCorrectiveAction', 'recordCorrectiveAction', 400],
      ['verifyEffectiveness', 'verifyEffectiveness', 400],
      ['getById', 'getById', 400],
      ['getAll', 'getAll', 500],
    ])('%s covers the catch path', async (method, serviceMethod, status) => {
      vi.spyOn(nonconformanceService, serviceMethod).mockRejectedValue(new Error('synthetic failure'));
      const res = await invoke(nonconformanceController, method, makeReq());
      expect(res.statusCode).toBe(status);
    });
  });

  describe('LegalHoldController', () => {
    const methods = ['impose', 'release', 'getById', 'getAll'];

    it.each(methods)('%s returns 503 without a database', async (method) => {
      const res = await invoke(legalHoldController, method, makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);
    });

    it('imposes with explicit/user/anonymous actor and releases with user/anonymous actor', async () => {
      vi.spyOn(legalHoldService, 'imposeHold').mockImplementation(async (_db, data) => ({
        legalHoldId: 'LH-1',
        targetEntityType: 'Specimen',
        targetEntityIds: ['spec-1'],
        reason: 'ethics',
        imposedBy: data.imposedBy,
      }));

      let req = makeReq({ body: { imposedBy: 'explicit' } });
      let res = await invoke(legalHoldController, 'impose', req);
      expect(res.statusCode).toBe(201);
      expect(legalHoldService.imposeHold.mock.calls.at(-1)[1].imposedBy).toBe('explicit');

      req = makeReq({ body: {} });
      await invoke(legalHoldController, 'impose', req);
      expect(legalHoldService.imposeHold.mock.calls.at(-1)[1].imposedBy).toBe('user-1');

      req = makeReq({ user: null, body: {} });
      await invoke(legalHoldController, 'impose', req);
      expect(legalHoldService.imposeHold.mock.calls.at(-1)[1].imposedBy).toBeNull();

      vi.spyOn(legalHoldService, 'releaseHold').mockResolvedValue({
        legalHoldId: 'LH-1',
        releaseReason: 'cleared',
      });
      req = makeReq({ body: { releaseReason: 'cleared' } });
      await invoke(legalHoldController, 'release', req);
      expect(legalHoldService.releaseHold).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', 'user-1', 'cleared'
      );

      req = makeReq({ user: null, body: undefined });
      await invoke(legalHoldController, 'release', req);
      expect(legalHoldService.releaseHold).toHaveBeenLastCalledWith(
        req.app.locals.db, 'entity-1', null, undefined
      );
    });

    it('covers getById found/not-found and getAll success', async () => {
      vi.spyOn(legalHoldService, 'getById')
        .mockResolvedValueOnce({ legalHoldId: 'LH-1' })
        .mockResolvedValueOnce(null);
      let res = await invoke(legalHoldController, 'getById', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(legalHoldController, 'getById', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(legalHoldService, 'getAll').mockResolvedValue([{ legalHoldId: 'LH-1' }]);
      res = await invoke(legalHoldController, 'getAll', makeReq());
      expect(res.statusCode).toBe(200);
    });

    it.each([
      ['impose', 'imposeHold', 400],
      ['release', 'releaseHold', 400],
      ['getById', 'getById', 400],
      ['getAll', 'getAll', 500],
    ])('%s covers the catch path', async (method, serviceMethod, status) => {
      vi.spyOn(legalHoldService, serviceMethod).mockRejectedValue(new Error('synthetic failure'));
      const res = await invoke(legalHoldController, method, makeReq());
      expect(res.statusCode).toBe(status);
    });
  });

  describe('DispositionActionController', () => {
    const methods = ['record', 'getCertificate', 'getById', 'getAll'];

    it.each(methods)('%s returns 503 without a database', async (method) => {
      const res = await invoke(dispositionController, method, makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);
    });

    it('records with explicit/user/anonymous performer and audits authenticated requests', async () => {
      vi.spyOn(dispositionService, 'recordDisposition').mockImplementation(async (_db, data) => ({
        dispositionActionId: 'DA-1',
        dispositionAction: 'destroy',
        entityType: 'Specimen',
        affectedRecordIds: ['spec-1'],
        retentionPolicyId: 'RP-1',
        performedBy: data.performedBy,
      }));

      let req = makeReq({ body: { performedBy: 'explicit' } });
      let res = await invoke(dispositionController, 'record', req);
      expect(res.statusCode).toBe(201);
      expect(dispositionService.recordDisposition.mock.calls.at(-1)[1].performedBy).toBe('explicit');
      expect(auditLogger.log).toHaveBeenCalled();

      req = makeReq({ body: {} });
      await invoke(dispositionController, 'record', req);
      expect(dispositionService.recordDisposition.mock.calls.at(-1)[1].performedBy).toBe('user-1');

      auditLogger.log.mockClear();
      req = makeReq({ user: null, body: {} });
      await invoke(dispositionController, 'record', req);
      expect(dispositionService.recordDisposition.mock.calls.at(-1)[1].performedBy).toBeNull();
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('maps active legal/ethical hold errors to 409 and ordinary errors to 400', async () => {
      vi.spyOn(dispositionService, 'recordDisposition')
        .mockRejectedValueOnce(new Error('bloqueio legal ou ético ativo'))
        .mockRejectedValueOnce(new Error('ordinary failure'));

      let res = await invoke(dispositionController, 'record', makeReq());
      expect(res.statusCode).toBe(409);
      res = await invoke(dispositionController, 'record', makeReq());
      expect(res.statusCode).toBe(400);
    });

    it('covers certificate and getById found/not-found plus getAll success', async () => {
      vi.spyOn(dispositionService, 'getCertificate')
        .mockResolvedValueOnce({ certificateId: 'C-1' })
        .mockResolvedValueOnce(null);
      let res = await invoke(dispositionController, 'getCertificate', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(dispositionController, 'getCertificate', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(dispositionService, 'getById')
        .mockResolvedValueOnce({ dispositionActionId: 'DA-1' })
        .mockResolvedValueOnce(null);
      res = await invoke(dispositionController, 'getById', makeReq());
      expect(res.statusCode).toBe(200);
      res = await invoke(dispositionController, 'getById', makeReq());
      expect(res.statusCode).toBe(404);

      vi.spyOn(dispositionService, 'getAll').mockResolvedValue([{ dispositionActionId: 'DA-1' }]);
      res = await invoke(dispositionController, 'getAll', makeReq());
      expect(res.statusCode).toBe(200);
    });

    it.each([
      ['getCertificate', 'getCertificate', 400],
      ['getById', 'getById', 400],
      ['getAll', 'getAll', 500],
    ])('%s covers the catch path', async (method, serviceMethod, status) => {
      vi.spyOn(dispositionService, serviceMethod).mockRejectedValue(new Error('synthetic failure'));
      const res = await invoke(dispositionController, method, makeReq());
      expect(res.statusCode).toBe(status);
    });
  });
});
