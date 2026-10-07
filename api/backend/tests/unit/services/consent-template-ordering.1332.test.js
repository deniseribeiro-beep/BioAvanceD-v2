import { describe, it, expect } from 'vitest';

const consentService = require('../../../src/services/consent.service');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * #1332: consent templates are read newest first. Each test stores its
 * documents out of the order it expects back, in a store that really
 * sorts, so a wrong key or direction in the read fails it.
 */

function templatesOf(db) {
  return db.collection(CANONICAL_COLLECTIONS.consentTemplates);
}

async function storeFour(db) {
  const templates = templatesOf(db);
  await templates.insertOne({ _id: 'a', title: 'old-active', version: 'v2', active: true, createdAt: new Date('2026-01-01') });
  await templates.insertOne({ _id: 'b', title: 'new-inactive', version: 'v4', active: false, createdAt: new Date('2026-03-01') });
  await templates.insertOne({ _id: 'c', title: 'new-active', version: 'v3', active: true, createdAt: new Date('2026-02-01') });
  await templates.insertOne({ _id: 'd', title: 'old-inactive', version: 'v1', active: false, createdAt: new Date('2025-12-01') });
}

describe('consent.service template ordering', () => {
  it('generateNextPolicyVersion reads the newest 200 templates, so the newest version is counted', async () => {
    const db = createFakeDb();
    const templates = templatesOf(db);
    // v1 oldest to v201 newest, stored in a shuffled order.
    const order = Array.from({ length: 201 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 201) - ((b * 7919) % 201));
    for (const n of order) {
      // eslint-disable-next-line no-await-in-loop
      await templates.insertOne({ _id: `id-${String(n).padStart(3, '0')}`, version: `v${n}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)) });
    }

    await expect(consentService.generateNextPolicyVersion(db)).resolves.toBe('v202');
  });

  it('getAllTemplates lists active templates first, newest first within each group', async () => {
    const db = createFakeDb();
    await storeFour(db);

    const listed = await consentService.getAllTemplates(db);

    expect(listed.map((template) => template.title)).toEqual(['new-active', 'old-active', 'new-inactive', 'old-inactive']);
  });

  it('getLatestTemplate returns the newest template, active or not', async () => {
    const db = createFakeDb();
    await storeFour(db);

    const latest = await consentService.getLatestTemplate(db);

    expect(latest.title).toBe('new-inactive');
  });

  it('getPoliciesHistory pages newest first', async () => {
    const db = createFakeDb();
    await storeFour(db);

    const first = await consentService.getPoliciesHistory(db, { page: 1, limit: 3 });
    const second = await consentService.getPoliciesHistory(db, { page: 2, limit: 3 });

    expect(first.items.map((template) => template.title)).toEqual(['new-inactive', 'new-active', 'old-active']);
    expect(second.items.map((template) => template.title)).toEqual(['old-inactive']);
  });
});
