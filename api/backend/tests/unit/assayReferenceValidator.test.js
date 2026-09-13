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
