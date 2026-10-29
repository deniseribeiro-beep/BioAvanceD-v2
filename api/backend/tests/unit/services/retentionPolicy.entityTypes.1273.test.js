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
  jurisdiction: 'BR',
  retentionBasis: ['Resolução CNS nº 441/2011, item 11, I'],
  legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
  reviewRequired: true,
});

beforeEach(() => { vi.spyOn(logger, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('#1273 a RetentionPolicy may name only the entity types something acts on', () => {
  it.each([[['Patient']], [['Consent']], [['Log', 'Patient']], [['Specimen', 'Collection']]])('createPolicy refuses %j and writes nothing', async (types) => {
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

// #1365 (RF026 AC1): specimens are bound to a policy too; their disposition
// runs through a DispositionAction, so the types are accepted. Each family
// keeps its own active policy.
describe('#1365 a RetentionPolicy may govern specimens', () => {
  it.each([[['Specimen']], [['Sample']], [['Specimen', 'Sample']]])('createPolicy accepts %j', async (types) => {
    const db = makeDb();
    const created = await retentionPolicyService.createPolicy(db, { ...payload(types), postRetentionAction: 'destroy' });
    expect(created.applicableEntityTypes).toEqual(types);
    expect(db._c.insertOne).toHaveBeenCalledTimes(1);
  });

  it('activating a specimen policy deactivates only active policies naming a specimen type', async () => {
    const db = makeDb();
    await retentionPolicyService.createPolicy(db, payload(['Specimen']));
    expect(db._c.updateMany).toHaveBeenCalledWith(
      { active: true, applicableEntityTypes: { $in: ['Specimen', 'Sample'] } },
      expect.anything()
    );
  });

  it('control: activating an audit-trail policy deactivates only the audit-trail family', async () => {
    const db = makeDb();
    await retentionPolicyService.createPolicy(db, payload(['Log']));
    expect(db._c.updateMany).toHaveBeenCalledWith(
      { active: true, applicableEntityTypes: { $in: ['AuditEvent', 'Log'] } },
      expect.anything()
    );
  });

  it('a policy naming both families deactivates both', async () => {
    const db = makeDb();
    await retentionPolicyService.createPolicy(db, payload(['Log', 'Specimen']));
    expect(db._c.updateMany).toHaveBeenCalledWith(
      { active: true, applicableEntityTypes: { $in: ['AuditEvent', 'Log', 'Specimen', 'Sample'] } },
      expect.anything()
    );
  });

  it('getActivePolicy reads the audit-trail family unless another is named', async () => {
    const db = makeDb();
    await retentionPolicyService.getActivePolicy(db);
    expect(db._c.find).toHaveBeenLastCalledWith({ active: true, applicableEntityTypes: { $in: ['AuditEvent', 'Log'] } });
    await retentionPolicyService.getActivePolicy(db, 'specimen');
    expect(db._c.find).toHaveBeenLastCalledWith({ active: true, applicableEntityTypes: { $in: ['Specimen', 'Sample'] } });
  });
});

// #1321 (RF007 AC3, V2E-0475): a DataFile records its family's active policy,
// and its disposition runs through a DispositionAction with entityType
// 'DataFile', so the type is accepted. The family keeps its own active policy.
describe('#1321 a RetentionPolicy may govern data files', () => {
  it('createPolicy accepts ["DataFile"]', async () => {
    const db = makeDb();
    const created = await retentionPolicyService.createPolicy(db, { ...payload(['DataFile']), postRetentionAction: 'destroy' });
    expect(created.applicableEntityTypes).toEqual(['DataFile']);
    expect(db._c.insertOne).toHaveBeenCalledTimes(1);
  });

  it('activating a DataFile policy deactivates only active policies naming DataFile', async () => {
    const db = makeDb();
    await retentionPolicyService.createPolicy(db, payload(['DataFile']));
    expect(db._c.updateMany).toHaveBeenCalledWith(
      { active: true, applicableEntityTypes: { $in: ['DataFile'] } },
      expect.anything()
    );
  });

  it('getActivePolicyId reads the DataFile family only and returns the policy _id as a string, or null', async () => {
    const db = makeDb();
    db._c.findOne.mockResolvedValueOnce({ _id: { toString: () => '64b7f0c2a1b2c3d4e5f60718' } });
    await expect(retentionPolicyService.getActivePolicyId(db, 'dataFile')).resolves.toBe('64b7f0c2a1b2c3d4e5f60718');
    expect(db._c.findOne).toHaveBeenLastCalledWith(
      { active: true, applicableEntityTypes: { $in: ['DataFile'] } },
      { sort: { createdAt: -1 } }
    );
    db._c.findOne.mockResolvedValueOnce(null);
    await expect(retentionPolicyService.getActivePolicyId(db, 'dataFile')).resolves.toBeNull();
  });

  it('getActivePolicyId throws on an unknown family and reads nothing', async () => {
    const db = makeDb();
    await expect(retentionPolicyService.getActivePolicyId(db, 'patient')).rejects.toThrow('família de política de retenção desconhecida: patient');
    expect(db._c.findOne).not.toHaveBeenCalled();
  });

  it.each(['toString', 'constructor', '__proto__'])('getActivePolicyId throws on %j, a name the table inherits, and reads nothing', async (family) => {
    const db = makeDb();
    await expect(retentionPolicyService.getActivePolicyId(db, family)).rejects.toThrow(`família de política de retenção desconhecida: ${family}`);
    expect(db._c.findOne).not.toHaveBeenCalled();
  });
});
