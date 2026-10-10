import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const dispositionCompatibility = require('../../../src/services/dispositionCompatibility.service');

// #1363 (RF026 AC6): a specimen's destruction or transfer is checked against
// custody, the collection's ethics approval and, for a transfer, consent.

function createFakeCollection(seedDocs = []) {
  const docs = [...seedDocs];
  const matches = (doc, filter) => Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));
  return {
    docs,
    async createIndex() { return 'ok'; },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      const matched = docs.filter((doc) => matches(doc, filter));
      return { sort() { return this; }, async toArray() { return matched; } };
    },
  };
}

const NOW = new Date('2026-10-10T12:00:00Z');
const PERIOD = { start: new Date('2026-01-01T00:00:00Z'), end: null };

function compatibleWorld(overrides = {}) {
  return {
    samples: [{ specimenId: 'SP-1', participantId: 'P-1', collectionId: 'COL-1', consentStatus: 'PENDING' }],
    collections: [{ collectionId: 'COL-1', governanceContext: { ethicsApprovalId: 'APR-1' } }],
    collectionGovernanceApprovals: [{ approvalId: 'APR-1', status: 'active', effectivePeriod: PERIOD }],
    custodianshipAssignments: [{ custodianshipAssignmentId: 'CUS-1', specimenId: 'SP-1', assignmentStatus: 'active', effectivePeriod: PERIOD, authorizationId: 'APR-1' }],
    patientConsents: [{ consentId: 'CON-1', participantId: 'P-1', status: 'ACTIVE' }],
    consentPermissions: [{ consentId: 'CON-1', permissionCode: 'compartilhamento_pesquisadores', decision: 'permit' }],
    ...overrides,
  };
}

function createFakeDb(world) {
  const collections = Object.fromEntries(Object.entries(world).map(([name, docs]) => [name, createFakeCollection(docs)]));
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

const action = (dispositionAction, affectedRecordIds = ['SP-1'], entityType = 'Specimen') => ({ entityType, dispositionAction, affectedRecordIds });
const rulesOf = (rows) => rows.map((row) => `${row.specimenId}:${row.rule}`);

describe('dispositionCompatibility.incompatibilitiesOf (#1363, RF026 AC6)', () => {
  it('finds nothing for a compatible destruction or transfer', async () => {
    const db = createFakeDb(compatibleWorld());
    expect(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy'), NOW)).toEqual([]);
    expect(await dispositionCompatibility.incompatibilitiesOf(db, action('transfer'), NOW)).toEqual([]);
  });

  it('guards only a Specimen or Sample destruction or transfer', async () => {
    const db = createFakeDb(compatibleWorld({ custodianshipAssignments: [] }));
    expect(await dispositionCompatibility.incompatibilitiesOf(db, action('preserve'), NOW)).toEqual([]);
    expect(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy', ['log-1'], 'Log'), NOW)).toEqual([]);
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy', ['SP-1'], 'Sample'), NOW))).toEqual(['SP-1:custody']);
  });

  it('refuses a specimen with no custody holding it now', async () => {
    const ended = [{ ...compatibleWorld().custodianshipAssignments[0], effectivePeriod: { start: PERIOD.start, end: new Date('2026-06-01T00:00:00Z') }, assignmentStatus: 'ended' }];
    const db = createFakeDb(compatibleWorld({ custodianshipAssignments: ended }));
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy'), NOW))).toEqual(['SP-1:custody']);
  });

  it('refuses when the collection\'s ethics approval is suspended, which also voids the custody it authorizes', async () => {
    const db = createFakeDb(compatibleWorld({ collectionGovernanceApprovals: [{ approvalId: 'APR-1', status: 'suspended', effectivePeriod: PERIOD }] }));
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy'), NOW))).toEqual(['SP-1:custody', 'SP-1:ethics']);
  });

  it('refuses on the collection\'s ethics approval alone when custody rests on another approval in force', async () => {
    const world = compatibleWorld({
      collectionGovernanceApprovals: [
        { approvalId: 'APR-1', status: 'revoked', effectivePeriod: PERIOD },
        { approvalId: 'APR-2', status: 'active', effectivePeriod: PERIOD },
      ],
    });
    world.custodianshipAssignments[0].authorizationId = 'APR-2';
    const db = createFakeDb(world);
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy'), NOW))).toEqual(['SP-1:ethics']);
  });

  it('refuses a transfer whose consent denies sharing, and lets a destruction through on the same consent', async () => {
    const db = createFakeDb(compatibleWorld({ consentPermissions: [{ consentId: 'CON-1', permissionCode: 'compartilhamento_pesquisadores', decision: 'deny' }] }));
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('transfer'), NOW))).toEqual(['SP-1:consent']);
    expect(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy'), NOW)).toEqual([]);
  });

  it('refuses a transfer with no active consent, unless the specimen\'s consent was signed on paper', async () => {
    const revoked = [{ consentId: 'CON-1', participantId: 'P-1', status: 'REVOKED' }];
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(createFakeDb(compatibleWorld({ patientConsents: revoked })), action('transfer'), NOW))).toEqual(['SP-1:consent']);
    const paper = compatibleWorld({ patientConsents: revoked });
    paper.samples[0].consentStatus = 'SIGNED';
    expect(await dispositionCompatibility.incompatibilitiesOf(createFakeDb(paper), action('transfer'), NOW)).toEqual([]);
  });

  it('names an affected id that resolves to no specimen', async () => {
    const db = createFakeDb(compatibleWorld());
    expect(rulesOf(await dispositionCompatibility.incompatibilitiesOf(db, action('destroy', ['SP-1', 'SP-404']), NOW))).toEqual(['SP-404:specimen_not_found']);
  });
});
