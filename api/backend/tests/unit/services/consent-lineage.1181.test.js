import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ObjectId } = require('mongodb');
const consentService = require('../../../src/services/consent.service');
const logger = require('../../../src/utils/logger');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * #1181: one active consent term per lineage (dict-02 P1X-0365
 * versionGroupId; each term carries its own CAAE, P1X-0367), one write path
 * for the policy route and the builder, and a participant's term resolved
 * from the lineage they were enrolled under.
 */

const templatesOf = (db) => db.collection(CANONICAL_COLLECTIONS.consentTemplates);
const patientsOf = (db) => db.collection(CANONICAL_COLLECTIONS.patients);

async function seedTerm(db, { lineage, version, active, createdAt, title }) {
  const _id = new ObjectId();
  await templatesOf(db).insertOne({
    _id,
    title: title || `${lineage} ${version}`,
    content: `Texto ${lineage} ${version}`,
    htmlContent: `Texto ${lineage} ${version}`,
    versionGroupId: lineage,
    version,
    active,
    permissions: [{ key: 'research', label: 'Pesquisa', required: true }],
    createdAt,
  });
  return _id;
}

const activeTitles = async (db) => (await templatesOf(db).find({ active: true }).toArray())
  .map((term) => term.title)
  .sort();

const policyPayload = (title) => ({
  title,
  htmlContent: `<p>${title}</p>`,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  granularPermissions: [{ key: 'research', label: 'Pesquisa', required: true }],
});

describe('consent lineages (#1181)', () => {
  let db;

  beforeEach(() => {
    db = createFakeDb();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('a builder create leaves another lineage\'s active term active', async () => {
    await seedTerm(db, { lineage: 'lineage-a', version: 'v1', active: true, createdAt: new Date('2026-01-01'), title: 'A v1' });

    const created = await consentService.createTemplate(db, { title: 'B', content: 'Texto B' });

    expect(created.version).toBe('v1');
    expect(await activeTitles(db)).toEqual(['A v1', 'B']);
  });

  it('the policy route creates through the builder\'s path: its own lineage at v1, others untouched', async () => {
    await seedTerm(db, { lineage: 'lineage-a', version: 'v3', active: true, createdAt: new Date('2026-01-01'), title: 'A v3' });

    const policy = await consentService.createPolicy(db, policyPayload('Politica B'));

    expect(policy.version).toBe('v1');
    expect(policy.revisionType).toBe('create');
    expect(policy.permissions).toEqual([{ key: 'research', label: 'Pesquisa', required: true }]);
    expect(policy.granularPermissions).toEqual(policy.permissions);
    expect(await activeTitles(db)).toEqual(['A v3', 'Politica B']);
  });

  it('a policy revision continues its lineage: next number, predecessor retired, other lineage untouched', async () => {
    const aV2 = await seedTerm(db, { lineage: 'lineage-a', version: 'v2', active: true, createdAt: new Date('2026-01-01'), title: 'A v2' });
    await seedTerm(db, { lineage: 'lineage-b', version: 'v9', active: true, createdAt: new Date('2026-02-01'), title: 'B v9' });

    const revised = await consentService.updatePolicy(db, String(aV2), policyPayload('A v3'));

    expect(revised.version).toBe('v3');
    expect(revised.versionGroupId).toBe('lineage-a');
    expect(revised.previousPolicyId).toBe(String(aV2));
    expect(revised.revisionType).toBe('update');
    expect(await activeTitles(db)).toEqual(['A v3', 'B v9']);
  });

  it('a policy revision of a term that does not exist is refused before anything is written', async () => {
    await expect(consentService.updatePolicy(db, String(new ObjectId()), policyPayload('X')))
      .rejects.toThrow('TCLE anterior não encontrado para atualização');
    expect(templatesOf(db).docs).toHaveLength(0);
  });

  describe('getActiveTemplateForParticipant', () => {
    it('serves the active term of the participant\'s own lineage, not a newer term of another', async () => {
      const aV1 = await seedTerm(db, { lineage: 'lineage-a', version: 'v1', active: false, createdAt: new Date('2026-01-01'), title: 'A v1' });
      await seedTerm(db, { lineage: 'lineage-a', version: 'v2', active: true, createdAt: new Date('2026-02-01'), title: 'A v2' });
      await seedTerm(db, { lineage: 'lineage-b', version: 'v1', active: true, createdAt: new Date('2026-03-01'), title: 'B v1' });
      await patientsOf(db).insertOne({ participantId: '80000001', consentTemplateId: String(aV1) });

      const term = await consentService.getActiveTemplateForParticipant(db, '80000001');

      expect(term.title).toBe('A v2');
      // Control: the global pick is the other lineage's newer term.
      expect((await consentService.getActiveTemplate(db)).title).toBe('B v1');
    });

    it('falls back to the newest active term for a participant with no enrolment term', async () => {
      await seedTerm(db, { lineage: 'lineage-a', version: 'v1', active: true, createdAt: new Date('2026-01-01'), title: 'A v1' });
      await seedTerm(db, { lineage: 'lineage-b', version: 'v1', active: true, createdAt: new Date('2026-03-01'), title: 'B v1' });
      await patientsOf(db).insertOne({ participantId: '80000002' });

      expect((await consentService.getActiveTemplateForParticipant(db, '80000002')).title).toBe('B v1');
      expect((await consentService.getActiveTemplateForParticipant(db, '89999999')).title).toBe('B v1');
    });

    it('falls back for an enrolment term that predates lineages, or a lineage with no active term', async () => {
      const legacy = new ObjectId();
      await templatesOf(db).insertOne({ _id: legacy, title: 'legacy', active: false, createdAt: new Date('2025-01-01') });
      const retired = await seedTerm(db, { lineage: 'lineage-a', version: 'v1', active: false, createdAt: new Date('2026-01-01'), title: 'A v1' });
      await seedTerm(db, { lineage: 'lineage-b', version: 'v1', active: true, createdAt: new Date('2026-03-01'), title: 'B v1' });
      await patientsOf(db).insertOne({ participantId: '80000003', consentTemplateId: String(legacy) });
      await patientsOf(db).insertOne({ participantId: '80000004', consentTemplateId: String(retired) });
      await patientsOf(db).insertOne({ participantId: '80000005', consentTemplateId: 'not-an-object-id' });

      expect((await consentService.getActiveTemplateForParticipant(db, '80000003')).title).toBe('B v1');
      expect((await consentService.getActiveTemplateForParticipant(db, '80000004')).title).toBe('B v1');
      expect((await consentService.getActiveTemplateForParticipant(db, '80000005')).title).toBe('B v1');
    });
  });
});
