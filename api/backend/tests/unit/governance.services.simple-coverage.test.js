import { afterEach, describe, expect, it, vi } from 'vitest';

const notificationRuleService = require('../../src/services/notificationRule.service');
const retentionPolicyService = require('../../src/services/retentionPolicy.service');
const logger = require('../../src/utils/logger');

function makeCollection(versions = []) {
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(versions.map((version) => ({ version }))),
  };
  return {
    cursor,
    collection: {
      find: vi.fn(() => cursor),
      findOne: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'inserted-id' }),
    },
  };
}

function dbFor(collection) {
  return { collection: vi.fn(() => collection) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('simple governance service branches for item 8', () => {
  it('covers notification rule version parsing/generation and create active/previous branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    expect(notificationRuleService.parseVersionNumber(' v12 ')).toBe(12);
    expect(notificationRuleService.parseVersionNumber('12')).toBe(12);
    expect(notificationRuleService.parseVersionNumber('release-x')).toBe(0);
    expect(notificationRuleService.parseVersionNumber()).toBe(0);

    let fixture = makeCollection(['v2', '10', 'bad', undefined]);
    let db = dbFor(fixture.collection);
    await expect(notificationRuleService.generateNextVersion(db, 'TEMP')).resolves.toBe('v11');
    expect(fixture.collection.find).toHaveBeenCalledWith(
      { eventType: 'TEMP' },
      { projection: { version: 1 } }
    );

    const base = {
      eventType: 'TEMP',
      channels: ['in_app'],
      recipientRoleCodes: ['ADMIN'],
      sensitiveFieldsAllowlist: [],
      maxDeliveryMinutes: 2,
    };

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    const inactive = await notificationRuleService.createRule(db, { ...base, active: false });
    expect(inactive).toEqual(expect.objectContaining({
      version: 'v1',
      active: false,
      previousRuleId: null,
    }));
    expect(fixture.collection.updateMany).not.toHaveBeenCalled();

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    const activeByDefault = await notificationRuleService.createRule(db, base);
    expect(activeByDefault.active).toBe(true);
    expect(fixture.collection.updateMany).toHaveBeenCalledWith(
      { eventType: 'TEMP', active: true },
      { $set: expect.objectContaining({ active: false, updatedAt: expect.any(Date) }) }
    );

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    await expect(notificationRuleService.createRule(
      db,
      base,
      { previousRuleId: 'not-an-object-id' }
    )).rejects.toThrow('ID da regra de notificação anterior é inválido');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    const previousId = '507f1f77bcf86cd799439011';
    fixture.collection.findOne.mockResolvedValueOnce(null);
    await expect(notificationRuleService.createRule(
      db,
      base,
      { previousRuleId: previousId }
    )).rejects.toThrow('Regra de notificação anterior não encontrada');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce({ _id: previousId, eventType: 'TEMP' });
    const versioned = await notificationRuleService.createRule(
      db,
      { ...base, active: true },
      { previousRuleId: `  ${previousId}  ` }
    );
    expect(versioned.previousRuleId).toBe(previousId);
  });

  it('covers notification update/read/list invalid-id, not-found, default-filter and filtered branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const base = {
      eventType: 'ORIGINAL',
      channels: ['in_app'],
      recipientRoleCodes: ['ADMIN'],
      maxDeliveryMinutes: 2,
    };

    let fixture = makeCollection([]);
    let db = dbFor(fixture.collection);
    await expect(notificationRuleService.updateRule(db, 'bad-id', base))
      .rejects.toThrow('ID da regra de notificação inválido');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce(null);
    await expect(notificationRuleService.updateRule(db, '507f1f77bcf86cd799439011', base))
      .rejects.toThrow('Regra de notificação não encontrada');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439011',
      eventType: 'PARENT_EVENT',
    });
    const updated = await notificationRuleService.updateRule(
      db,
      '507f1f77bcf86cd799439011',
      { ...base, eventType: 'CALLER_TRIED_TO_CHANGE' }
    );
    expect(updated.eventType).toBe('PARENT_EVENT');
    expect(updated.previousRuleId).toBe('507f1f77bcf86cd799439011');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([]);
    await expect(notificationRuleService.getActiveRuleForEventType(db, 'TEMP')).resolves.toBeNull();

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([{ _id: 'active' }]);
    await expect(notificationRuleService.getActiveRuleForEventType(db, 'TEMP'))
      .resolves.toEqual({ _id: 'active' });

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    await expect(notificationRuleService.getRuleById(db, 'bad'))
      .rejects.toThrow('ID da regra de notificação inválido');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce({ _id: 'rule' });
    await expect(notificationRuleService.getRuleById(db, '507f1f77bcf86cd799439011'))
      .resolves.toEqual({ _id: 'rule' });

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([{ _id: 'r1' }]);
    await notificationRuleService.getAllRules(db);
    expect(fixture.collection.find).toHaveBeenLastCalledWith({});

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([{ _id: 'r2' }]);
    await notificationRuleService.getAllRules(db, { eventType: 'TEMP' });
    expect(fixture.collection.find).toHaveBeenLastCalledWith({ eventType: 'TEMP' });
  });

  it('covers retention version parsing/generation, validation and create previous/active branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    expect(retentionPolicyService.parseVersionNumber('V7')).toBe(7);
    expect(retentionPolicyService.parseVersionNumber('bad')).toBe(0);
    expect(retentionPolicyService.parseVersionNumber(null)).toBe(0);

    let fixture = makeCollection(['v1', 'v9', 'oops']);
    let db = dbFor(fixture.collection);
    await expect(retentionPolicyService.generateNextVersion(db)).resolves.toBe('v10');

    expect(() => retentionPolicyService.validateEntityTypes(['AuditEvent', 'Unknown']))
      .toThrow('valores não suportados');
    expect(() => retentionPolicyService.validateEntityTypes())
      .not.toThrow();
    expect(() => retentionPolicyService.validateAuditEventRetentionAction(['AuditEvent'], 'destroy'))
      .toThrow('apenas "archive"');
    expect(() => retentionPolicyService.validateAuditEventRetentionAction(['Log'], 'destroy'))
      .not.toThrow();

    const base = {
      applicableEntityTypes: ['AuditEvent'],
      triggerEvent: 'creation',
      postRetentionAction: 'archive',
      retentionPeriod: 'P365D',
    };

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    const active = await retentionPolicyService.createPolicy(db, base);
    expect(active).toEqual(expect.objectContaining({
      version: 'v1',
      active: true,
      previousPolicyId: null,
    }));
    expect(active.effectivePeriod.start).toBeTruthy();
    expect(active.effectivePeriod.end).toBeNull();
    expect(fixture.collection.updateMany).toHaveBeenCalled();

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    const inactive = await retentionPolicyService.createPolicy(db, {
      ...base,
      active: false,
      effectivePeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2027-01-01T00:00:00.000Z',
      },
    });
    expect(inactive.active).toBe(false);
    expect(fixture.collection.updateMany).not.toHaveBeenCalled();

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    await expect(retentionPolicyService.createPolicy(
      db,
      base,
      { previousPolicyId: 'bad-id' }
    )).rejects.toThrow('ID da política de retenção anterior é inválido');

    const previousId = '507f1f77bcf86cd799439011';
    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce(null);
    await expect(retentionPolicyService.createPolicy(
      db,
      base,
      { previousPolicyId: previousId }
    )).rejects.toThrow('Política de retenção anterior não encontrada');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce({ _id: previousId });
    const versioned = await retentionPolicyService.createPolicy(
      db,
      base,
      { previousPolicyId: ` ${previousId} ` }
    );
    expect(versioned.previousPolicyId).toBe(previousId);
  });

  it('covers retention update/read invalid-id, no-active/active and list branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const base = {
      applicableEntityTypes: ['AuditEvent'],
      triggerEvent: 'creation',
      postRetentionAction: 'archive',
      retentionPeriod: 'P30D',
    };

    let fixture = makeCollection([]);
    let db = dbFor(fixture.collection);
    await expect(retentionPolicyService.updatePolicy(db, 'bad-id', base))
      .rejects.toThrow('ID da política de retenção anterior é inválido');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([]);
    await expect(retentionPolicyService.getActivePolicy(db)).resolves.toBeNull();

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([{ _id: 'active' }]);
    await expect(retentionPolicyService.getActivePolicy(db)).resolves.toEqual({ _id: 'active' });

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    await expect(retentionPolicyService.getPolicyById(db, 'bad'))
      .rejects.toThrow('ID da política de retenção inválido');

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.collection.findOne.mockResolvedValueOnce({ _id: 'policy' });
    await expect(retentionPolicyService.getPolicyById(db, '507f1f77bcf86cd799439011'))
      .resolves.toEqual({ _id: 'policy' });

    fixture = makeCollection([]);
    db = dbFor(fixture.collection);
    fixture.cursor.toArray.mockResolvedValueOnce([{ _id: 'p1' }]);
    await expect(retentionPolicyService.getAllPolicies(db)).resolves.toEqual([{ _id: 'p1' }]);
    expect(fixture.collection.find).toHaveBeenCalledWith({});
  });
});
