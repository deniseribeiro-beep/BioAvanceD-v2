import { describe, it, expect } from 'vitest';

const notificationRuleService = require('../../../src/services/notificationRule.service');
const retentionPolicyService = require('../../../src/services/retentionPolicy.service');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * #1332: notification rules and retention policies are read newest first.
 * Each test stores its documents out of the order it expects back, in a
 * store that really sorts, so a wrong key or direction in the read fails it.
 */

// 201 documents, v1 oldest to v201 newest, stored in a shuffled order.
async function storeVersions(collection, extra = {}) {
  const order = Array.from({ length: 201 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 201) - ((b * 7919) % 201));
  for (const n of order) {
    // eslint-disable-next-line no-await-in-loop
    await collection.insertOne({ _id: `id-${String(n).padStart(3, '0')}`, version: `v${n}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)), ...extra });
  }
}

describe('notificationRule.service ordering', () => {
  it('generateNextVersion reads the newest 200 rules, so the newest version is counted', async () => {
    const db = createFakeDb();
    await storeVersions(db.collection(CANONICAL_COLLECTIONS.notificationRules), { eventType: 'TEMP_ALERT' });

    await expect(notificationRuleService.generateNextVersion(db, 'TEMP_ALERT')).resolves.toBe('v202');
  });

  it('getAllRules lists active rules first, newest first within each group', async () => {
    const db = createFakeDb();
    const rules = db.collection(CANONICAL_COLLECTIONS.notificationRules);
    await rules.insertOne({ _id: 'a', name: 'old-active', active: true, createdAt: new Date('2026-01-01') });
    await rules.insertOne({ _id: 'b', name: 'new-inactive', active: false, createdAt: new Date('2026-03-01') });
    await rules.insertOne({ _id: 'c', name: 'new-active', active: true, createdAt: new Date('2026-02-01') });
    await rules.insertOne({ _id: 'd', name: 'old-inactive', active: false, createdAt: new Date('2025-12-01') });

    const listed = await notificationRuleService.getAllRules(db);

    expect(listed.map((rule) => rule.name)).toEqual(['new-active', 'old-active', 'new-inactive', 'old-inactive']);
  });
});

describe('retentionPolicy.service ordering', () => {
  it('generateNextVersion reads the newest 200 policies, so the newest version is counted', async () => {
    const db = createFakeDb();
    await storeVersions(db.collection(CANONICAL_COLLECTIONS.retentionPolicies));

    await expect(retentionPolicyService.generateNextVersion(db)).resolves.toBe('v202');
  });

  it('getAllPolicies lists active policies first, newest first within each group', async () => {
    const db = createFakeDb();
    const policies = db.collection(CANONICAL_COLLECTIONS.retentionPolicies);
    await policies.insertOne({ _id: 'a', name: 'old-active', active: true, createdAt: new Date('2026-01-01') });
    await policies.insertOne({ _id: 'b', name: 'new-inactive', active: false, createdAt: new Date('2026-03-01') });
    await policies.insertOne({ _id: 'c', name: 'new-active', active: true, createdAt: new Date('2026-02-01') });
    await policies.insertOne({ _id: 'd', name: 'old-inactive', active: false, createdAt: new Date('2025-12-01') });

    const listed = await retentionPolicyService.getAllPolicies(db);

    expect(listed.map((policy) => policy.name)).toEqual(['new-active', 'old-active', 'new-inactive', 'old-inactive']);
  });
});
