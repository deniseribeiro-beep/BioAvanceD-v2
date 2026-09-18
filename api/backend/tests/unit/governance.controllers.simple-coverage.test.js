import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const notificationRuleController = require('../../src/controllers/notificationRule.controller');
const retentionPolicyController = require('../../src/controllers/retentionPolicy.controller');
const notificationRuleService = require('../../src/services/notificationRule.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const retentionPolicyService = require('../../src/services/retentionPolicy.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeReq({ db = {}, body = {}, params = { id: '507f1f77bcf86cd799439011' }, query = {}, user } = {}) {
  return {
    app: { locals: { db } },
    body,
    params,
    query,
    user,
  };
}

function statusPayload(res) {
  return {
    status: res.status.mock.calls.at(-1)?.[0],
    payload: res.json.mock.calls.at(-1)?.[0],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('simple governance controller branches for item 8', () => {
  it('covers notification-rule create/update db, audit, fallback and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    let res = makeRes();
    await notificationRuleController.createRule(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const createSpy = vi.spyOn(notificationRuleService, 'createRule');
    createSpy.mockResolvedValueOnce({
      _id: 'rule-1',
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['in_app'],
      version: 'v1',
      active: true,
    });
    res = makeRes();
    await notificationRuleController.createRule(makeReq(), res);
    expect(statusPayload(res).status).toBe(201);
    expect(auditLogger.log).not.toHaveBeenCalled();

    createSpy.mockResolvedValueOnce({
      _id: 'rule-2',
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['email'],
      version: 'v2',
      active: false,
    });
    res = makeRes();
    await notificationRuleController.createRule(makeReq({ user: { userID: 'u-1' } }), res);
    expect(statusPayload(res).status).toBe(201);
    expect(auditLogger.init).toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'NotificationRule',
      resourceId: 'rule-2',
    }));

    createSpy.mockRejectedValueOnce(new Error('create failed'));
    res = makeRes();
    await notificationRuleController.createRule(makeReq(), res);
    expect(statusPayload(res)).toEqual(expect.objectContaining({
      status: 400,
      payload: expect.objectContaining({ message: 'create failed' }),
    }));

    res = makeRes();
    await notificationRuleController.updateRule(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const updateSpy = vi.spyOn(notificationRuleService, 'updateRule');
    updateSpy.mockResolvedValueOnce({
      _id: 'rule-3',
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['in_app'],
      version: 'v3',
      active: true,
    });
    res = makeRes();
    const undefinedBodyReq = makeReq({ user: { _id: 'u-2' } });
    undefinedBodyReq.body = undefined;
    await notificationRuleController.updateRule(undefinedBodyReq, res);
    expect(updateSpy).toHaveBeenLastCalledWith(
      undefinedBodyReq.app.locals.db,
      undefinedBodyReq.params.id,
      {}
    );
    expect(statusPayload(res).status).toBe(200);
    expect(auditLogger.log).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ previousRuleId: null }),
    }));

    updateSpy.mockResolvedValueOnce({
      _id: 'rule-4',
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['in_app'],
      version: 'v4',
      active: true,
      previousRuleId: 'rule-3',
    });
    res = makeRes();
    await notificationRuleController.updateRule(makeReq({ user: { userID: 'u-3' } }), res);
    expect(auditLogger.log).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ previousRuleId: 'rule-3' }),
    }));

    updateSpy.mockResolvedValueOnce({
      _id: 'rule-5',
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['in_app'],
      version: 'v5',
      active: true,
    });
    res = makeRes();
    await notificationRuleController.updateRule(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    updateSpy.mockRejectedValueOnce(new Error('update failed'));
    res = makeRes();
    await notificationRuleController.updateRule(makeReq(), res);
    expect(statusPayload(res).payload.message).toBe('update failed');
  });

  it('covers notification-rule read/list/confirm success, absence, db and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    let res = makeRes();
    await notificationRuleController.getActiveRule(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const activeSpy = vi.spyOn(notificationRuleService, 'getActiveRuleForEventType');
    activeSpy.mockResolvedValueOnce(null);
    res = makeRes();
    await notificationRuleController.getActiveRule(makeReq({ query: { eventType: 'X' } }), res);
    expect(statusPayload(res).status).toBe(404);

    activeSpy.mockResolvedValueOnce({ _id: 'active' });
    res = makeRes();
    await notificationRuleController.getActiveRule(makeReq({ query: { eventType: 'X' } }), res);
    expect(statusPayload(res).status).toBe(200);

    activeSpy.mockRejectedValueOnce(new Error('active failed'));
    res = makeRes();
    await notificationRuleController.getActiveRule(makeReq({ query: { eventType: 'X' } }), res);
    expect(statusPayload(res).status).toBe(500);

    res = makeRes();
    await notificationRuleController.getRuleById(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const byIdSpy = vi.spyOn(notificationRuleService, 'getRuleById');
    byIdSpy.mockResolvedValueOnce(null);
    res = makeRes();
    await notificationRuleController.getRuleById(makeReq(), res);
    expect(statusPayload(res).status).toBe(404);

    byIdSpy.mockResolvedValueOnce({ _id: 'rule' });
    res = makeRes();
    await notificationRuleController.getRuleById(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    byIdSpy.mockRejectedValueOnce(new Error('id failed'));
    res = makeRes();
    await notificationRuleController.getRuleById(makeReq(), res);
    expect(statusPayload(res).status).toBe(400);

    res = makeRes();
    await notificationRuleController.getAllRules(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const allSpy = vi.spyOn(notificationRuleService, 'getAllRules');
    allSpy.mockResolvedValueOnce([{ _id: 'r1' }]);
    res = makeRes();
    await notificationRuleController.getAllRules(makeReq({ query: { eventType: 'X' } }), res);
    expect(allSpy).toHaveBeenLastCalledWith(expect.anything(), { eventType: 'X' });
    expect(statusPayload(res).status).toBe(200);

    allSpy.mockRejectedValueOnce(new Error('all failed'));
    res = makeRes();
    await notificationRuleController.getAllRules(makeReq(), res);
    expect(statusPayload(res).status).toBe(500);

    res = makeRes();
    await notificationRuleController.listNotifications(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const listSpy = vi.spyOn(notificationDispatchService, 'getNotifications');
    listSpy.mockResolvedValueOnce([]);
    res = makeRes();
    await notificationRuleController.listNotifications(makeReq({
      query: { eventType: 'X', status: 'delivered' },
    }), res);
    expect(listSpy).toHaveBeenLastCalledWith(expect.anything(), {
      eventType: 'X',
      status: 'delivered',
      limit: undefined,
    });
    expect(statusPayload(res).status).toBe(200);

    listSpy.mockResolvedValueOnce([]);
    res = makeRes();
    await notificationRuleController.listNotifications(makeReq({ query: { limit: '7' } }), res);
    expect(listSpy).toHaveBeenLastCalledWith(expect.anything(), {
      eventType: undefined,
      status: undefined,
      limit: 7,
    });

    listSpy.mockRejectedValueOnce(new Error('list failed'));
    res = makeRes();
    await notificationRuleController.listNotifications(makeReq(), res);
    expect(statusPayload(res).status).toBe(500);

    res = makeRes();
    await notificationRuleController.confirmNotification(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const confirmSpy = vi.spyOn(notificationDispatchService, 'confirmNotification');
    confirmSpy.mockResolvedValueOnce({ _id: 'n1' });
    res = makeRes();
    await notificationRuleController.confirmNotification(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    confirmSpy.mockRejectedValueOnce(new Error('confirm failed'));
    res = makeRes();
    await notificationRuleController.confirmNotification(makeReq(), res);
    expect(statusPayload(res).status).toBe(400);
  });

  it('covers retention-policy create/update db, audit, fallback and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    let res = makeRes();
    await retentionPolicyController.createPolicy(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const createSpy = vi.spyOn(retentionPolicyService, 'createPolicy');
    const basePolicy = {
      applicableEntityTypes: ['AuditEvent'],
      triggerEvent: 'createdAt',
      postRetentionAction: 'archive',
      retentionPeriod: { value: 1, unit: 'year' },
      active: true,
    };

    createSpy.mockResolvedValueOnce({ _id: 'p1', version: 'v1', ...basePolicy });
    res = makeRes();
    await retentionPolicyController.createPolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(201);
    expect(auditLogger.log).not.toHaveBeenCalled();

    createSpy.mockResolvedValueOnce({ _id: 'p2', version: 'v2', ...basePolicy });
    res = makeRes();
    await retentionPolicyController.createPolicy(makeReq({ user: { userID: 'u-1' } }), res);
    expect(statusPayload(res).status).toBe(201);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'RetentionPolicy',
      resourceId: 'p2',
    }));

    createSpy.mockRejectedValueOnce(new Error('create policy failed'));
    res = makeRes();
    await retentionPolicyController.createPolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(400);

    res = makeRes();
    await retentionPolicyController.updatePolicy(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const updateSpy = vi.spyOn(retentionPolicyService, 'updatePolicy');
    updateSpy.mockResolvedValueOnce({ _id: 'p3', version: 'v3', ...basePolicy });
    res = makeRes();
    const undefinedBodyReq = makeReq({ user: { _id: 'u-2' } });
    undefinedBodyReq.body = undefined;
    await retentionPolicyController.updatePolicy(undefinedBodyReq, res);
    expect(updateSpy).toHaveBeenLastCalledWith(
      undefinedBodyReq.app.locals.db,
      undefinedBodyReq.params.id,
      {}
    );
    expect(auditLogger.log).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ previousPolicyId: null }),
    }));

    updateSpy.mockResolvedValueOnce({
      _id: 'p4',
      version: 'v4',
      previousPolicyId: 'p3',
      ...basePolicy,
    });
    res = makeRes();
    await retentionPolicyController.updatePolicy(makeReq({ user: { userID: 'u-3' } }), res);
    expect(auditLogger.log).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ previousPolicyId: 'p3' }),
    }));

    updateSpy.mockResolvedValueOnce({ _id: 'p5', version: 'v5', ...basePolicy });
    res = makeRes();
    await retentionPolicyController.updatePolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    updateSpy.mockRejectedValueOnce(new Error('update policy failed'));
    res = makeRes();
    await retentionPolicyController.updatePolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(400);
  });

  it('covers retention-policy read/list success, absence, db and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    let res = makeRes();
    await retentionPolicyController.getActivePolicy(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const activeSpy = vi.spyOn(retentionPolicyService, 'getActivePolicy');
    activeSpy.mockResolvedValueOnce(null);
    res = makeRes();
    await retentionPolicyController.getActivePolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(404);

    activeSpy.mockResolvedValueOnce({ _id: 'p1' });
    res = makeRes();
    await retentionPolicyController.getActivePolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    activeSpy.mockRejectedValueOnce(new Error('active policy failed'));
    res = makeRes();
    await retentionPolicyController.getActivePolicy(makeReq(), res);
    expect(statusPayload(res).status).toBe(500);

    res = makeRes();
    await retentionPolicyController.getPolicyById(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const byIdSpy = vi.spyOn(retentionPolicyService, 'getPolicyById');
    byIdSpy.mockResolvedValueOnce(null);
    res = makeRes();
    await retentionPolicyController.getPolicyById(makeReq(), res);
    expect(statusPayload(res).status).toBe(404);

    byIdSpy.mockResolvedValueOnce({ _id: 'p2' });
    res = makeRes();
    await retentionPolicyController.getPolicyById(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    byIdSpy.mockRejectedValueOnce(new Error('policy id failed'));
    res = makeRes();
    await retentionPolicyController.getPolicyById(makeReq(), res);
    expect(statusPayload(res).status).toBe(400);

    res = makeRes();
    await retentionPolicyController.getAllPolicies(makeReq({ db: null }), res);
    expect(statusPayload(res).status).toBe(503);

    const allSpy = vi.spyOn(retentionPolicyService, 'getAllPolicies');
    allSpy.mockResolvedValueOnce([{ _id: 'p1' }]);
    res = makeRes();
    await retentionPolicyController.getAllPolicies(makeReq(), res);
    expect(statusPayload(res).status).toBe(200);

    allSpy.mockRejectedValueOnce(new Error('all policies failed'));
    res = makeRes();
    await retentionPolicyController.getAllPolicies(makeReq(), res);
    expect(statusPayload(res).status).toBe(500);
  });
});
