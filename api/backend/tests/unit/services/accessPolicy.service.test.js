import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const accessPolicyService = require('../../../src/services/accessPolicy.service');

// Exact-match fake, as in accessRequest.service.test.js: the service's own
// queries run against it.
function createFakeCollection(seedDocs = []) {
  const docs = [...seedDocs];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
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

function createFakeDb() {
  const collections = {
    accessPolicies: createFakeCollection(),
    organizations: createFakeCollection([{ organizationId: 'org-1' }]),
  };
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function payload(overrides = {}) {
  return {
    policyName: 'Oncologia',
    policyVersion: '1.0.0',
    applicableEntityTypes: ['AccessRequest'],
    decisionEffect: 'permit',
    ruleExpression: 'all-conditions',
    effectivePeriod: { start: '2020-01-01' },
    roleCodes: ['researcher'],
    organizationScopeIds: ['org-1'],
    resourceScopes: ['Specimen'],
    conditions: [{ consent: 'compatible' }],
    decisionReasonsRequired: true,
    ...overrides,
  };
}

describe('accessPolicy.service', () => {
  it('creates a policy with a server-made id and its creator', async () => {
    const db = createFakeDb();

    const created = await accessPolicyService.createPolicy(db, payload({ accessPolicyId: 'chosen' }), 'admin-1');

    expect(created.accessPolicyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject({ policyVersion: '1.0.0', createdBy: 'admin-1', purposeCodes: [] });
    expect(db.collection('accessPolicies').docs).toHaveLength(1);
  });

  it('answers 422 for an invalid policy, and for an organization that does not resolve', async () => {
    const db = createFakeDb();

    const invalid = await accessPolicyService.createPolicy(db, payload({ decisionEffect: 'allow' })).catch((e) => e);
    expect(invalid.statusCode).toBe(422);

    const unknownOrg = await accessPolicyService.createPolicy(db, payload({ organizationScopeIds: ['org-x'] })).catch((e) => e);
    expect(unknownOrg.statusCode).toBe(422);
    expect(unknownOrg.message).toMatch(/org-x não encontrado/);
    expect(db.collection('accessPolicies').docs).toHaveLength(0);
  });

  it('adds a new version beside the old one, never over it', async () => {
    const db = createFakeDb();
    const first = await accessPolicyService.createPolicy(db, payload());

    const second = await accessPolicyService.createVersion(db, first.accessPolicyId, payload({ policyVersion: '1.1.0', decisionEffect: 'deny' }));

    expect(second.accessPolicyId).toBe(first.accessPolicyId);
    const versions = await accessPolicyService.getVersions(db, first.accessPolicyId);
    expect(versions.map((v) => [v.policyVersion, v.decisionEffect])).toEqual([['1.1.0', 'deny'], ['1.0.0', 'permit']]);
    expect((await accessPolicyService.getInForce(db)).map((p) => p.policyVersion)).toEqual(['1.1.0']);
  });

  it.each(['1.0.0', '0.9.0'])('answers 422 for a version %s not above the latest', async (version) => {
    const db = createFakeDb();
    const first = await accessPolicyService.createPolicy(db, payload());

    const error = await accessPolicyService.createVersion(db, first.accessPolicyId, payload({ policyVersion: version })).catch((e) => e);

    expect(error.statusCode).toBe(422);
    expect(error.message).toMatch(/deve ser maior/);
  });

  it('answers 404 for a version of a policy that does not exist', async () => {
    const error = await accessPolicyService.createVersion(createFakeDb(), 'missing', payload()).catch((e) => e);
    expect(error.statusCode).toBe(404);
  });
});
