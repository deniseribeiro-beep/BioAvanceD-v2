import { describe, it, expect, vi } from 'vitest';
const { validateAssayReferences } = require('../../src/services/assayReferenceValidator');

function makeDb(collectionResults = {}) {
  return {
    collection: vi.fn((name) => ({
      findOne: vi.fn().mockResolvedValue(
        Object.prototype.hasOwnProperty.call(collectionResults, name) ? collectionResults[name] : null
      )
    }))
  };
}

const VALID_PAYLOAD = {
  specimenIds: ['507f1f77bcf86cd799439011'],
  protocolId: 'protocol-1',
  operatorId: '507f1f77bcf86cd799439012',
  laboratoryId: 'org-1',
  reagentLotIds: ['reagent-1'],
  equipmentIds: ['42']
};

describe('assayReferenceValidator.validateAssayReferences (#664)', () => {
  it('resolves without throwing when every reference exists', async () => {
    const db = makeDb({
      samples: { _id: 'sample-doc' },
      protocols: { protocolId: 'protocol-1' },
      users: { _id: 'user-doc' },
      organizations: { organizationId: 'org-1' },
      reagentLots: { reagentId: 'reagent-1' },
      equipment: { equipmentID: 42 }
    });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).resolves.toBeUndefined();
  });

  it('rejects when a specimenId does not resolve to a real sample', async () => {
    const db = makeDb({ protocols: {}, users: {}, organizations: {}, reagentLots: {}, equipment: {} });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/specimenIds/);
  });

  it('refuses a quarantined specimen with 409, and accepts it once available (RF019 AC3, #1315)', async () => {
    const others = { protocols: { protocolId: 'protocol-1' }, users: { _id: 'user-doc' }, organizations: { organizationId: 'org-1' }, reagentLots: { reagentId: 'reagent-1' }, equipment: { equipmentID: 42 } };
    const quarantined = makeDb({ samples: { _id: 'sample-doc', specimenStatus: 'quarantined' }, ...others });
    await expect(validateAssayReferences(quarantined, { ...VALID_PAYLOAD })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/quarentena/) });

    const available = makeDb({ samples: { _id: 'sample-doc', specimenStatus: 'available' }, ...others });
    await expect(validateAssayReferences(available, { ...VALID_PAYLOAD })).resolves.toBeUndefined();
  });

  it('rejects when protocolId does not resolve to a real Protocol', async () => {
    const db = makeDb({ samples: { _id: 'sample-doc' }, users: {}, organizations: {}, reagentLots: {}, equipment: {} });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/protocolId/);
  });

  it('rejects when operatorId does not resolve to a real user', async () => {
    const db = makeDb({ samples: { _id: 'sample-doc' }, protocols: { protocolId: 'protocol-1' }, organizations: {}, reagentLots: {}, equipment: {} });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/operatorId/);
  });

  it('rejects when laboratoryId does not resolve to a real Organization', async () => {
    const db = makeDb({ samples: { _id: 'sample-doc' }, protocols: { protocolId: 'protocol-1' }, users: { _id: 'user-doc' }, reagentLots: {}, equipment: {} });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/laboratoryId/);
  });

  it('rejects when a reagentLotId does not resolve to a real ReagentLot', async () => {
    const db = makeDb({ samples: { _id: 'sample-doc' }, protocols: { protocolId: 'protocol-1' }, users: { _id: 'user-doc' }, organizations: { organizationId: 'org-1' }, equipment: {} });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/reagentLotIds/);
  });

  it('rejects when an equipmentId does not resolve to a real Equipment (numeric equipmentID)', async () => {
    const db = makeDb({ samples: { _id: 'sample-doc' }, protocols: { protocolId: 'protocol-1' }, users: { _id: 'user-doc' }, organizations: { organizationId: 'org-1' }, reagentLots: { reagentId: 'reagent-1' } });

    await expect(validateAssayReferences(db, VALID_PAYLOAD)).rejects.toThrow(/equipmentIds/);
  });

  it('skips every check for a payload with no reference fields at all', async () => {
    const db = makeDb({});

    await expect(validateAssayReferences(db, {})).resolves.toBeUndefined();
  });

  it('every thrown reference error carries statusCode 404', async () => {
    const db = makeDb({ protocols: {}, users: {}, organizations: {}, reagentLots: {}, equipment: {} });

    try {
      await validateAssayReferences(db, VALID_PAYLOAD);
      throw new Error('expected validateAssayReferences to throw');
    } catch (error) {
      expect(error.statusCode).toBe(404);
    }
  });
});

// #1219: an assay's specimenIds resolved by _id only, so a caller holding
// the canonical specimenId, the id the create response names, was refused.
// The samples double honours its filter, so a lookup on one form only
// misses the other.
describe('assayReferenceValidator: specimenIds by either form, stored canonical (#1219)', () => {
  const sample = { _id: '507f1f77bcf86cd799439011', specimenId: '3116768' };
  function dbWithSample() {
    return {
      collection: vi.fn((name) => ({
        findOne: vi.fn(async (filter = {}) => {
          if (name !== 'samples') return {};
          if (filter.specimenId === sample.specimenId) return sample;
          if (filter._id && String(filter._id) === sample._id) return sample;
          return null;
        })
      }))
    };
  }

  it('accepts a canonical specimenId and keeps it', async () => {
    const payload = { ...VALID_PAYLOAD, specimenIds: ['3116768'] };
    await validateAssayReferences(dbWithSample(), payload);
    expect(payload.specimenIds).toEqual(['3116768']);
  });

  it('accepts a Mongo _id and stores the canonical specimenId instead', async () => {
    const payload = { ...VALID_PAYLOAD, specimenIds: [sample._id] };
    await validateAssayReferences(dbWithSample(), payload);
    expect(payload.specimenIds).toEqual(['3116768']);
  });

  it('still refuses an id that names no sample', async () => {
    const payload = { ...VALID_PAYLOAD, specimenIds: ['does-not-exist'] };
    await expect(validateAssayReferences(dbWithSample(), payload)).rejects.toThrow(/specimenIds: does-not-exist/);
  });
});
