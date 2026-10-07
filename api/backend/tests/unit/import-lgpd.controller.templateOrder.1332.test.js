import { describe, it, expect, vi } from 'vitest';

const controller = require('../../src/controllers/import-lgpd.controller');
const { CANONICAL_COLLECTIONS } = require('../../src/config/collections');
const { createFakeDb } = require('./foundation/helpers/fake-db');

/**
 * #1332: the patients smart-import metadata offers the 20 newest consent
 * templates. They are stored out of order in a store that sorts, so a
 * wrong key or direction in the read changes which 20 are offered.
 */
describe('importLGPDController.getPatientsSmartImportMetadata', () => {
  it('offers the 20 newest consent templates, newest first', async () => {
    const db = createFakeDb();
    const templates = db.collection(CANONICAL_COLLECTIONS.consentTemplates);
    // t1 oldest to t21 newest, stored in a shuffled order.
    const order = Array.from({ length: 21 }, (_, i) => i + 1).sort((a, b) => ((a * 13) % 21) - ((b * 13) % 21));
    for (const n of order) {
      // eslint-disable-next-line no-await-in-loop
      await templates.insertOne({ _id: `t${n}`, title: `t${n}`, version: `v${n}`, active: true, createdAt: new Date(Date.UTC(2026, 0, n)) });
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await controller.getPatientsSmartImportMetadata({ app: { locals: { db } } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { consentTemplates } = res.json.mock.calls[0][0].data;
    expect(consentTemplates.count).toBe(21);
    expect(consentTemplates.items.map((item) => item.title)).toEqual(
      Array.from({ length: 20 }, (_, i) => `t${21 - i}`)
    );
  });
});
