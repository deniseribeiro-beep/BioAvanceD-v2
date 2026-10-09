import { describe, it, expect, beforeEach, vi } from 'vitest';

const consentService = require('../../../src/services/consent.service');
const ConsentPermissionModel = require('../../../src/models/ConsentPermission');
const logger = require('../../../src/utils/logger');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

const { DUO_SYSTEM_URI } = ConsentPermissionModel;

/**
 * #1347 (RF010 AC3, V2E-0116): a term's permission may name the governed
 * purpose it covers, a GA4GH DUO concept the reference data holds as
 * active, and the ConsentPermission rows a consent writes carry it.
 */
describe('governed purpose codes on a term\'s permissions (#1347)', () => {
  let db;

  beforeEach(async () => {
    db = createFakeDb();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const concepts = db.collection(CANONICAL_COLLECTIONS.terminologyConcepts);
    await concepts.insertOne({ systemUri: DUO_SYSTEM_URI, code: 'DUO:0000006', conceptStatus: 'active' });
    await concepts.insertOne({ systemUri: DUO_SYSTEM_URI, code: 'DUO:0000011', conceptStatus: 'obsolete' });
  });

  it('stores the DUO code a permission names', async () => {
    const term = await consentService.createTemplate(db, {
      title: 'TCLE',
      content: 'Texto',
      permissions: [
        { key: 'hmb', label: 'Pesquisa em saúde', required: true, purposeCode: ' DUO:0000006 ' },
        { key: 'contact', label: 'Novo contato' },
      ],
    });

    expect(term.permissions).toEqual([
      { key: 'hmb', label: 'Pesquisa em saúde', required: true, purposeCode: 'DUO:0000006' },
      { key: 'contact', label: 'Novo contato', required: false },
    ]);
  });

  it('refuses with 422, writing nothing, a code that is not an active DUO concept', async () => {
    const attempt = (purposeCode) => consentService.createTemplate(db, {
      title: 'TCLE',
      content: 'Texto',
      permissions: [{ key: 'p', label: 'Pesquisa', purposeCode }],
    });

    await expect(attempt('DUO:9999999')).rejects.toMatchObject({
      statusCode: 422,
      details: ['purposeCode DUO:9999999 não é um conceito DUO ativo'],
    });
    await expect(attempt('DUO:0000011')).rejects.toMatchObject({ statusCode: 422 });
    expect(db.collection(CANONICAL_COLLECTIONS.consentTemplates).docs).toHaveLength(0);
  });

  it('codes a consent\'s permission rows with the term\'s DUO purpose, and keeps the label for one without', () => {
    const rows = ConsentPermissionModel.fromAnswers({
      consentId: 'consent-1',
      responses: { hmb: true, contact: false },
      template: {
        version: 'v1',
        permissions: [
          { key: 'hmb', label: 'Pesquisa em saúde', purposeCode: 'DUO:0000006' },
          { key: 'contact', label: 'Novo contato' },
        ],
      },
      signedAt: new Date('2026-10-09T00:00:00Z'),
    });

    expect(rows.map((row) => [row.permissionCode, row.purpose, row.decision])).toEqual([
      ['hmb', { system: DUO_SYSTEM_URI, code: 'DUO:0000006', display: 'Pesquisa em saúde' }, 'permit'],
      ['contact', { code: 'contact', display: 'Novo contato' }, 'deny'],
    ]);
  });
});
