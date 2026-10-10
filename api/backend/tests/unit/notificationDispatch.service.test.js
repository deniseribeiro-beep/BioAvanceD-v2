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

    it('#903 (RF015 AC3/AC1): stores the notification and its attempt before the channel is called, naming the ConfigurationRelease in force', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const securityConfig = createCollectionMock({
        findOne: vi.fn(async (query) => (query?._id === 'main' ? { _id: 'main', configurationReleaseId: 'rel-7' } : null)),
      });
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock, security_config: securityConfig });
      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 2,
      });
      let atSend = null;
      vi.spyOn(notificationServiceV2, 'sendEmail').mockImplementation(async () => {
        atSend = JSON.parse(JSON.stringify(notifications.docs));
        throw new Error('transport down');
      });

      const result = await notificationDispatchService.dispatchNotification(db, { eventType: 'environmental_excursion', payload: {} });

      expect(atSend).toHaveLength(1);
      expect(atSend[0]).toMatchObject({ status: 'dispatching', configurationReleaseId: 'rel-7' });
      expect(atSend[0].attempts).toEqual([expect.objectContaining({ channel: 'email', result: 'attempted' })]);
      expect(notifications.docs).toHaveLength(1);
      expect(notifications.docs[0]).toMatchObject({ status: 'failed', configurationReleaseId: 'rel-7' });
      expect(notifications.docs[0].attempts).toEqual([expect.objectContaining({ channel: 'email', result: 'failure', reason: 'transport down' })]);
      expect(result).toMatchObject({ status: 'failed', configurationReleaseId: 'rel-7', ruleVersion: 'v1' });
    });

    it('#903 (RNF026 AC2): retries a failing channel as the rule configures, recording each attempt', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });
      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 2,
        retry: { maxAttempts: 3, backoffSeconds: 0 },
      });
      let calls = 0;
      vi.spyOn(notificationServiceV2, 'sendEmail').mockImplementation(async () => {
        calls += 1;
        if (calls < 3) throw new Error(`transient ${calls}`);
      });

      const result = await notificationDispatchService.dispatchNotification(db, { eventType: 'environmental_excursion', payload: {} });

      expect(result).toMatchObject({ status: 'delivered', deliveredChannel: 'email', escalated: false, slaBreached: false });
      expect(result.attempts.map((a) => a.result)).toEqual(['failure', 'failure', 'success']);
    });

    it('#903 (RF015 AC6): once the delivery window closes undelivered, retrying stops and the escalation runs at once', async () => {
      const notificationRules = statefulCollection();
      const notifications = statefulCollection();
      const db = buildDb({ notificationRules: notificationRules.mock, notifications: notifications.mock });
      await notificationRuleService.createRule(db, {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: [],
        maxDeliveryMinutes: 0.0005, // 30 ms
        retry: { maxAttempts: 10, backoffSeconds: 0 },
        escalation: { enabled: true, afterFailures: 10, channel: 'in_app' },
      });
      vi.spyOn(notificationServiceV2, 'sendEmail').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('transport down');
      });

      const result = await notificationDispatchService.dispatchNotification(db, { eventType: 'environmental_excursion', payload: {} });

      const emailTries = result.attempts.filter((a) => a.channel === 'email');
      expect(emailTries.length).toBeGreaterThan(0);
      expect(emailTries.length).toBeLessThan(10);
      expect(result).toMatchObject({ slaBreached: true, escalated: true, deliveredChannel: 'in_app', status: 'delivered', withinSla: false });
      expect(result.attempts.at(-1)).toMatchObject({ channel: 'in_app', escalation: true, result: 'success' });
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
