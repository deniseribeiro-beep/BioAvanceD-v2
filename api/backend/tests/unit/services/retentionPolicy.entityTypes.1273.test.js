import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const retentionPolicyService = require('../../../src/services/retentionPolicy.service');
const logger = require('../../../src/utils/logger');

// #1273: the sweep acts only on Log and AuditEvent, so a policy naming any
// other entity type would be accepted and silently do nothing. Both write
// paths (POST creates, PUT revises through createPolicy) refuse such a policy
// before anything is written. A handler for a new type must widen the
// allowlist and this test together.

function makeDb() {
  const collection = {
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
    findOne: vi.fn().mockResolvedValue({ _id: 'prev' }),
    updateMany: vi.fn().mockResolvedValue({}),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' }),
  };
  return { collection: vi.fn(() => collection), _c: collection };
}

const payload = (applicableEntityTypes) => ({
  applicableEntityTypes,
  triggerEvent: 'record-created',
  postRetentionAction: 'archive',
  retentionPeriod: 'P365D',
});

beforeEach(() => { vi.spyOn(logger, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('#1273 a RetentionPolicy may name only the entity types the sweep acts on', () => {
  it.each([[['Sample']], [['Patient']], [['Log', 'Sample']]])('createPolicy refuses %j and writes nothing', async (types) => {
    const db = makeDb();
    await expect(retentionPolicyService.createPolicy(db, payload(types))).rejects.toThrow(/não suportados/);
    expect(db._c.updateMany).not.toHaveBeenCalled();
    expect(db._c.insertOne).not.toHaveBeenCalled();
  });

  it('updatePolicy refuses an unsupported type the same way', async () => {
    const db = makeDb();
    const prevId = '64b7f0c2a1b2c3d4e5f60718';
    await expect(retentionPolicyService.updatePolicy(db, prevId, payload(['Patient']))).rejects.toThrow(/não suportados/);
    expect(db._c.insertOne).not.toHaveBeenCalled();
  });

  it.each([[['Log']], [['AuditEvent']], [['Log', 'AuditEvent']]])('control: %j is accepted', async (types) => {
    const db = makeDb();
    const created = await retentionPolicyService.createPolicy(db, payload(types));
    expect(created.applicableEntityTypes).toEqual(types);
    expect(db._c.insertOne).toHaveBeenCalledTimes(1);
  });
});
