import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ProtocolModel = require('../../../src/models/PhysicalIdentificationValidationProtocol');

// #1314 (RF016 AC7, RULE-037).
const approved = {
  protocolVersion: '1.0.0',
  scope: 'ex_ante_synthetic',
  evidenceUri: 'https://evidence.bioadvanced.dev/protocols/datamatrix-1.0.0',
  evidenceHash: 'a'.repeat(64),
  approvedSymbologies: ['data_matrix'],
  fixtureCatalogRefs: ['rack-96-001'],
  realSpecimenUse: false,
  approvalStatus: 'approved_for_execution',
  approvedAt: '2026-10-09T12:00:00.000Z',
};

describe('PhysicalIdentificationValidationProtocol model (RF016 AC7)', () => {
  it('lets an approved ex ante synthetic protocol run, and nothing in it records a passed run', () => {
    const protocol = ProtocolModel.create(approved);
    expect(() => ProtocolModel.assertExecutable(protocol)).not.toThrow();
    expect(Object.keys(protocol).some((key) => /result|passed|outcome/i.test(key))).toBe(false);
  });

  it('blocks execution of a draft or retired protocol (RULE-037)', () => {
    for (const approvalStatus of ['draft', 'retired']) {
      const protocol = ProtocolModel.create({ ...approved, approvalStatus, approvedAt: null });
      expect(() => ProtocolModel.assertExecutable(protocol)).toThrow(/RULE-037/);
    }
  });

  it('blocks an ex ante synthetic protocol that uses a real specimen (RULE-037)', () => {
    const protocol = ProtocolModel.create({ ...approved, realSpecimenUse: true });
    expect(() => ProtocolModel.assertExecutable(protocol)).toThrow('Protocolo ex ante sintético não pode usar espécime real (RULE-037)');
  });

  it('requires approvedAt once approved, a SHA-256 evidence hash, and AC5 symbologies', () => {
    expect(() => ProtocolModel.create({ ...approved, approvedAt: null })).toThrow(/V2E-0709/);
    expect(() => ProtocolModel.create({ ...approved, evidenceHash: 'abc' })).toThrow(/SHA-256/);
    expect(() => ProtocolModel.create({ ...approved, approvedSymbologies: ['ean_13'] })).toThrow(/approvedSymbologies/);
  });
});
