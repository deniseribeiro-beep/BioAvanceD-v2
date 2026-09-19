import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const notificationRuleService = require('../../src/services/notificationRule.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const notificationServiceV2 = require('../../src/services/NotificationService');

// #646 Wave 3, RF015/RNF026. Real query-matching semantics for
// notificationRules/notifications (find/findOne/insertOne honor the actual
// filter), not canned-response stubs -- this is what proves versioning
// (AC#1/#5) and the recorded attempts/delivery/escalation shape (AC#2/#3/#4),
// mirroring retentionPolicy.routes.test.js's statefulRetentionPoliciesMock
// pattern (RF014, #440/#441).
function statefulCollection() {
  const docs = [];
  const matches = (doc, query = {}) =>
    Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$in' in cond) {
        return cond.$in.some((v) => String(v) === String(doc[key]));
      }
      return String(doc[key]) === String(cond);
    });

  return {
    docs,
    mock: createCollectionMock({
      insertOne: vi.fn(async (doc) => {
        const _id = new ObjectId();
        docs.push({ _id, ...doc });
        return { insertedId: _id };
      }),
      updateOne: vi.fn(async (filter, update) => {
        const doc = docs.find((d) => matches(d, filter));
        if (doc && update.$set) Object.assign(doc, update.$set);
        return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
      }),
      updateMany: vi.fn(async (filter, update) => {
        const matched = docs.filter((d) => matches(d, filter));
        matched.forEach((d) => Object.assign(d, update.$set));
        return { matchedCount: matched.length, modifiedCount: matched.length };
      }),
      findOne: vi.fn(async (query = {}) => docs.find((d) => matches(d, query)) || null),
      find: vi.fn((query = {}) => {
        let current = docs.filter((d) => matches(d, query));
        const cursor = {
          sort: vi.fn((criteria = {}) => {
            const [[field, direction = 1]] = Object.entries(criteria);
            current = [...current].sort((a, b) => {
              const left = a?.[field] ?? 0;
              const right = b?.[field] ?? 0;
              if (left === right) return 0;
              return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
            });
            return cursor;
          }),
          limit: vi.fn((n) => {
            if (typeof n === 'number' && n >= 0) current = current.slice(0, n);
            return cursor;
          }),
          toArray: vi.fn(async () => current),
        };
        return cursor;
      }),
    }),
  };
}

const ADMIN_ID = new ObjectId();

function buildDb(overrides = {}) {
  const rbac = buildRbacCollections([{ userAccountId: ADMIN_ID.toString(), accessType: 4 }]);
  const users = createCollectionMock({
    // resolveRecipientEmails uses aggregate()/$toString rather than find()
    // with a constructed ObjectId, to avoid mixing BSON instances across
    // the two db-connection flavors the real dispatch call can run under
    // (see notificationDispatch.service.js's own comment) -- this mock
    // ignores the pipeline and just returns every seeded admin user,
    // which is sufficient since these tests only ever seed one.
    aggregate: vi.fn(() => ({
      toArray: vi.fn(async () => [{ _id: ADMIN_ID, email: 'admin@example.com' }]),
    })),
  });
  return createDbMock({ users, ...rbac, ...overrides });
}

describe('notificationDispatch.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC#1: no-ops when no active rule exists for the eventType', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'environmental_excursion',
      payload: { sensorId: 'S-1' },
    });

    expect(result).toBeNull();
    expect(notifications.docs).toHaveLength(0);
  });

  describe('with an active in_app rule', () => {
    it('AC#1/#2/#3/#6/#7: creates a notification from the versioned rule, delivers via in_app, links the source event, and measures SLA', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

      const rule = await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['sensorId', 'temperatureValue'],
        maxDeliveryMinutes: 2,
      });
      expect(rule.version).toBe('v1');

      const sourceEventId = new ObjectId();
      const result = await notificationDispatchService.dispatchNotification(db, {
        eventType: 'environmental_excursion',
        sourceEventType: 'TemperatureAlert',
        sourceEventId,
        payload: { sensorId: 'S-1', temperatureValue: -40, internalNotes: 'do not include this' },
      });

      expect(result.status).toBe('delivered');
      expect(result.ruleVersion).toBe('v1');
      expect(result.attempts).toEqual([
        expect.objectContaining({ channel: 'in_app', result: 'success', escalation: false }),
      ]);
      // AC#6 - linked to the originating event.
      expect(result.sourceEventType).toBe('TemperatureAlert');
      expect(result.sourceEventId).toBe(sourceEventId.toString());
      // AC#7 - measurable against the rule's own SLA.
      expect(result.deliveredAt).toBeTruthy();
      expect(result.withinSla).toBe(true);
      expect(result.deliveryDurationMs).toBeLessThanOrEqual(2 * 60000);
    });

    it('AC#5: strips payload fields the rule does not allowlist', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['sensorId'],
        maxDeliveryMinutes: 2,
      });

      const result = await notificationDispatchService.dispatchNotification(db, {
        eventType: 'environmental_excursion',
        payload: { sensorId: 'S-1', temperatureValue: -40, participantId: '12345678' },
      });

      expect(result.payload).toEqual({ sensorId: 'S-1' });
    });

    it('AC#2/#3/#4: escalates to the fallback channel when the primary channel fails, recording both attempts', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

      // recipientRoleCodes references a role nobody is assigned, so the
      // email channel deterministically fails with 'no_recipients' -- a
      // real failure path, not a mocked one.
      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['coordinator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 2,
        escalation: { enabled: true, afterFailures: 1, channel: 'in_app' },
      });

      const result = await notificationDispatchService.dispatchNotification(db, {
        eventType: 'environmental_excursion',
        payload: {},
      });

      expect(result.status).toBe('delivered');
      expect(result.escalated).toBe(true);
      expect(result.deliveredChannel).toBe('in_app');
      expect(result.attempts).toEqual([
        expect.objectContaining({ channel: 'email', result: 'failure', reason: 'no_recipients', escalation: false }),
        expect.objectContaining({ channel: 'in_app', result: 'success', escalation: true }),
      ]);
    });

    it('does not escalate when escalation is disabled and every channel fails', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['coordinator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 2,
      });

      const result = await notificationDispatchService.dispatchNotification(db, {
        eventType: 'environmental_excursion',
        payload: {},
      });

      expect(result.status).toBe('failed');
      expect(result.escalated).toBe(false);
      expect(result.deliveredAt).toBeNull();
      expect(result.withinSla).toBeNull();
    });
  });

  describe('confirmNotification (AC#3 confirmation)', () => {
    it('stamps confirmedAt on the notification', async () => {
      const notifications = statefulCollection();
      const db = createDbMock({ notifications: notifications.mock });
      const inserted = await notifications.mock.insertOne({ status: 'delivered', confirmedAt: null });

      const confirmed = await notificationDispatchService.confirmNotification(db, inserted.insertedId.toString());

      expect(confirmed.confirmedAt).toBeTruthy();
    });
  });

  describe('email channel (real NotificationService.sendEmail call path)', () => {
    it('records a failure attempt when sendEmail rejects, without throwing', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 2,
      });

      vi.spyOn(notificationServiceV2, 'sendEmail').mockRejectedValue(new Error('Resend indisponível'));

      const result = await notificationDispatchService.dispatchNotification(db, {
        eventType: 'environmental_excursion',
        payload: {},
      });

      expect(result.status).toBe('failed');
      expect(result.attempts[0]).toMatchObject({ channel: 'email', result: 'failure', reason: 'Resend indisponível' });
    });
  });
});

describe('notificationDispatch.service item 8 residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers email successfully and drops user rows without an email address', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const users = createCollectionMock({
      aggregate: vi.fn(() => ({
        toArray: vi.fn(async () => [
          { _id: ADMIN_ID, email: 'admin@example.com' },
          { _id: new ObjectId(), email: '' },
        ]),
      })),
    });
    const rbac = buildRbacCollections([{ userAccountId: ADMIN_ID.toString(), accessType: 4 }]);
    const db = createDbMock({ users, ...rbac, notificationRules: notificationRules.mock, notifications: notifications.mock });

    await notificationRuleService.createRule(db, {
      eventType: 'governed_event',
      channels: ['email'],
      recipientRoleCodes: ['administrator'],
      sensitiveFieldsAllowlist: ['code'],
      maxDeliveryMinutes: 5,
    });
    const sendSpy = vi.spyOn(notificationServiceV2, 'sendEmail').mockResolvedValue({ success: true });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'governed_event',
      payload: { code: 'A1' },
    });

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@example.com',
      notificationType: 'rule_notification',
    }));
    expect(result.status).toBe('delivered');
    expect(result.recipients).toEqual(['admin@example.com']);
    expect(result.sourceEventType).toBe('governed_event');
    expect(result.sourceEventId).toBeNull();
  });

  it('supports a rule with no recipient roles for in-app delivery without querying users', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const users = createCollectionMock({ aggregate: vi.fn() });
    const db = createDbMock({ users, notificationRules: notificationRules.mock, notifications: notifications.mock });

    await notificationRuleService.createRule(db, {
      eventType: 'in_app_only',
      channels: ['in_app'],
      recipientRoleCodes: [],
      sensitiveFieldsAllowlist: [],
      maxDeliveryMinutes: 2,
    });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'in_app_only',
      payload: { privateField: 'discarded' },
    });

    expect(result.status).toBe('delivered');
    expect(result.recipients).toEqual([]);
    expect(users.aggregate).not.toHaveBeenCalled();
  });

  it('records unsupported channels as failures without inventing a delivery', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

    await notificationRuleService.createRule(db, {
      eventType: 'unsupported_channel_event',
      channels: ['fax'],
      recipientRoleCodes: ['administrator'],
      sensitiveFieldsAllowlist: [],
      maxDeliveryMinutes: 2,
    });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'unsupported_channel_event',
    });

    expect(result.status).toBe('failed');
    expect(result.attempts).toEqual([
      expect.objectContaining({
        channel: 'fax',
        result: 'failure',
        reason: 'unsupported_channel:fax',
      }),
    ]);
  });

  it('does not escalate before the configured failure threshold is reached', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

    await notificationRuleService.createRule(db, {
      eventType: 'threshold_event',
      channels: ['email'],
      recipientRoleCodes: ['coordinator'],
      sensitiveFieldsAllowlist: [],
      maxDeliveryMinutes: 2,
      escalation: { enabled: true, afterFailures: 2, channel: 'in_app' },
    });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'threshold_event',
    });

    expect(result.status).toBe('failed');
    expect(result.escalated).toBe(false);
    expect(result.attempts).toHaveLength(1);
  });

  it('records escalated_failed when both primary and escalation channels fail', async () => {
    const notificationRules = statefulCollection();
    const notifications = statefulCollection();
    const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });

    await notificationRuleService.createRule(db, {
      eventType: 'failed_escalation_event',
      channels: ['email'],
      recipientRoleCodes: ['coordinator'],
      sensitiveFieldsAllowlist: [],
      maxDeliveryMinutes: 2,
      escalation: { enabled: true, afterFailures: 1, channel: 'pager' },
    });

    const result = await notificationDispatchService.dispatchNotification(db, {
      eventType: 'failed_escalation_event',
    });

    expect(result.status).toBe('escalated_failed');
    expect(result.escalated).toBe(true);
    expect(result.deliveredChannel).toBeNull();
    expect(result.attempts[1]).toMatchObject({
      channel: 'pager',
      result: 'failure',
      reason: 'unsupported_channel:pager',
      escalation: true,
    });
  });

  it('rejects malformed notification ids before updating confirmation state', async () => {
    const notifications = statefulCollection();
    const db = createDbMock({ notifications: notifications.mock });

    await expect(
      notificationDispatchService.confirmNotification(db, 'not-an-object-id')
    ).rejects.toThrow('ID de notificação inválido');

    expect(notifications.mock.updateOne).not.toHaveBeenCalled();
  });

  it('filters notification listing by eventType/status and honors both default and explicit limits', async () => {
    const notifications = statefulCollection();
    const db = createDbMock({ notifications: notifications.mock });

    await notifications.mock.insertOne({ eventType: 'A', status: 'delivered', createdAt: new Date('2026-01-01') });
    await notifications.mock.insertOne({ eventType: 'A', status: 'failed', createdAt: new Date('2026-01-02') });
    await notifications.mock.insertOne({ eventType: 'B', status: 'delivered', createdAt: new Date('2026-01-03') });

    const filtered = await notificationDispatchService.getNotifications(db, {
      eventType: 'A',
      status: 'delivered',
      limit: 1,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ eventType: 'A', status: 'delivered' });

    const all = await notificationDispatchService.getNotifications(db);
    expect(all).toHaveLength(3);

    const limitCalls = notifications.mock.find.mock.results
      .map((entry) => entry.value?.limit?.mock?.calls?.[0]?.[0])
      .filter((value) => value !== undefined);
    expect(limitCalls).toContain(1);
    expect(limitCalls).toContain(50);
  });
});

