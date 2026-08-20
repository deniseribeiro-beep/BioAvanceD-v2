import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const dispositionActionService = require('../../../src/services/dispositionAction.service');
const legalHoldService = require('../../../src/services/legalHold.service');
const notificationDispatchService = require('../../../src/services/notificationDispatch.service');

afterEach(() => { vi.restoreAllMocks(); });

/** Real query-matching fake, same pattern as accessRequest.service.test.js. */
function createFakeCollection(seedDocs = []) {
  const docs = [...seedDocs];
  const matches = (doc, filter) => Object.keys(filter).every((key) => {
    if (key === '_id') return String(doc._id) === String(filter._id);
    return doc[key] === filter[key];
  });
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find(filter = {}) {
      const matched = docs.filter((doc) => matches(doc, filter));
      return {
        sort() {
          return this;
        },
        async toArray() {
          return matched;
        },
      };
    },
  };
}

function createFakeDb({ retentionPolicies = [], legalHolds = [] } = {}) {
  const collections = {
    dispositionActions: createFakeCollection(),
    retentionPolicies: createFakeCollection(retentionPolicies),
    legalHolds: createFakeCollection(legalHolds),
  };
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function basePayload(retentionPolicyId, overrides = {}) {
  return {
    retentionPolicyId,
    entityType: 'Log',
    affectedRecordIds: ['log-1'],
    dispositionAction: 'destroy',
    performedBy: 'user-1',
    ...overrides,
  };
}

describe('dispositionAction.service', () => {
  describe('recordDisposition (AC#1/#3/#4)', () => {
    it('records a disposition when retentionPolicyId resolves to a real policy', async () => {
      const policyId = new ObjectId();
      const db = createFakeDb({ retentionPolicies: [{ _id: policyId, version: 'v1', active: true }] });

      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId.toString()));

      expect(action.dispositionActionId).toBeTruthy();
      expect(action.retentionPolicyId).toBe(policyId.toString());
      expect(action.legalHold).toBe(false);
    });

    it('refuses a retentionPolicyId that is not a valid ObjectId (AC#1 referential integrity)', async () => {
      const db = createFakeDb();

      await expect(
        dispositionActionService.recordDisposition(db, basePayload('not-an-object-id'))
      ).rejects.toThrow(/política de retenção existente/);
    });

    it('refuses a retentionPolicyId that is well-formed but does not resolve to a real policy', async () => {
      const db = createFakeDb();

      await expect(
        dispositionActionService.recordDisposition(db, basePayload(new ObjectId().toString()))
      ).rejects.toThrow(/política de retenção existente/);
    });
  });

  describe('recordDisposition blocked by an active legal hold (AC#2/#6)', () => {
    async function seedPolicyId(db) {
      const policyId = new ObjectId();
      db.collection('retentionPolicies').docs.push({ _id: policyId, version: 'v1', active: true });
      return policyId.toString();
    }

    it('blocks a destroy action while an active hold covers an affected record', async () => {
      const db = createFakeDb();
      const policyId = await seedPolicyId(db);
      await legalHoldService.imposeHold(db, {
        targetEntityType: 'Log',
        targetEntityIds: ['log-1'],
        reason: 'Investigação em andamento',
        imposedBy: 'user-2',
      });

      await expect(
        dispositionActionService.recordDisposition(db, basePayload(policyId, { dispositionAction: 'destroy' }))
      ).rejects.toThrow(/bloqueio legal ou ético ativo/);
    });

    it('does NOT block a non-destroy action (e.g. preserve) while a hold is active, but still records legalHold: true', async () => {
      const db = createFakeDb();
      const policyId = await seedPolicyId(db);
      await legalHoldService.imposeHold(db, {
        targetEntityType: 'Log',
        targetEntityIds: ['log-1'],
        reason: 'Investigação em andamento',
        imposedBy: 'user-2',
      });

      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId, { dispositionAction: 'preserve' }));

      expect(action.dispositionAction).toBe('preserve');
      expect(action.legalHold).toBe(true);
    });

    it('allows destroy again once the hold has been released', async () => {
      const db = createFakeDb();
      const policyId = await seedPolicyId(db);
      const hold = await legalHoldService.imposeHold(db, {
        targetEntityType: 'Log',
        targetEntityIds: ['log-1'],
        reason: 'Investigação em andamento',
        imposedBy: 'user-2',
      });
      await legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', 'Investigação encerrada');

      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId, { dispositionAction: 'destroy' }));
      expect(action.legalHold).toBe(false);
    });

    it('does not block destroy for a hold on a different entityType', async () => {
      const db = createFakeDb();
      const policyId = await seedPolicyId(db);
      await legalHoldService.imposeHold(db, {
        targetEntityType: 'Patient',
        targetEntityIds: ['log-1'],
        reason: 'Bloqueio em outro tipo de entidade',
        imposedBy: 'user-2',
      });

      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId, { dispositionAction: 'destroy' }));
      expect(action.legalHold).toBe(false);
    });
  });

  describe('#650 (RF015 governança) dispatches a disposition_action_recorded notification', () => {
    it('dispatches when a disposition is recorded', async () => {
      const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
      const policyId = new ObjectId();
      const db = createFakeDb({ retentionPolicies: [{ _id: policyId, version: 'v1', active: true }] });

      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId.toString()));

      expect(dispatchSpy).toHaveBeenCalledWith(db, {
        eventType: 'disposition_action_recorded',
        sourceEventType: 'DispositionAction',
        sourceEventId: action.dispositionActionId,
        payload: {
          entityType: 'Log',
          dispositionAction: 'destroy',
          retentionPolicyId: policyId.toString()
        }
      });
    });

    it('does NOT dispatch when a destroy action is blocked by an active legal hold', async () => {
      const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
      const db = createFakeDb();
      const policyId = new ObjectId();
      db.collection('retentionPolicies').docs.push({ _id: policyId, version: 'v1', active: true });
      await legalHoldService.imposeHold(db, {
        targetEntityType: 'Log',
        targetEntityIds: ['log-1'],
        reason: 'Investigação em andamento',
        imposedBy: 'user-2',
      });

      await expect(
        dispositionActionService.recordDisposition(db, basePayload(policyId.toString(), { dispositionAction: 'destroy' }))
      ).rejects.toThrow(/bloqueio legal ou ético ativo/);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getCertificate (AC#5)', () => {
    it('returns null for an unknown dispositionActionId', async () => {
      const db = createFakeDb();
      expect(await dispositionActionService.getCertificate(db, 'does-not-exist')).toBeNull();
    });

    it('returns a certificate view with the disposition\'s own facts', async () => {
      const db = createFakeDb();
      const policyId = new ObjectId();
      db.collection('retentionPolicies').docs.push({ _id: policyId, version: 'v1', active: true });
      const action = await dispositionActionService.recordDisposition(db, basePayload(policyId.toString(), { dispositionMethod: 'shredding' }));

      const certificate = await dispositionActionService.getCertificate(db, action.dispositionActionId);

      expect(certificate.dispositionActionId).toBe(action.dispositionActionId);
      expect(certificate.dispositionMethod).toBe('shredding');
      expect(certificate.performedBy).toBe('user-1');
      expect(certificate.generatedAt).toBeInstanceOf(Date);
    });
  });
});
