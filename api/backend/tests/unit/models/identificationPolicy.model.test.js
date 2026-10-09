import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const IdentifierNamespaceRegistryModel = require('../../../src/models/IdentifierNamespaceRegistry');
const IdentificationPolicyModel = require('../../../src/models/IdentificationPolicy');

// #1314 (RF016 AC4/AC5, RULE-036).
const namespace = {
  namespaceKey: 'tube-vendor',
  systemUri: 'https://id.bioadvanced.dev/ns/tube-vendor',
  authorityDomain: 'bioadvanced.dev',
  targetTypes: ['container'],
  semanticVersion: '1.0.0',
  effectivePeriod: { start: '2026-10-01T00:00:00.000Z' },
  configurationReleaseId: 'cfg-2026-10',
};
const policy = {
  semanticVersion: '1.0.0',
  allowedSymbologies: ['data_matrix', 'code_128'],
  targetRules: [{ targetType: 'container', symbology: 'data_matrix' }],
  privacyRules: ['no_civil_or_clinical_data'],
  checksumRules: { algorithm: 'none' },
  fallbackMode: 'manual_accession',
  configurationReleaseId: 'cfg-2026-10',
};

describe('IdentifierNamespaceRegistry model (RULE-036)', () => {
  it('accepts an HTTPS namespace under bioadvanced.dev, active, with an open [start, end) period', () => {
    expect(IdentifierNamespaceRegistryModel.create(namespace)).toMatchObject({ status: 'active', effectivePeriod: { end: null } });
  });

  it('refuses a non-HTTPS URI, and a host outside bioadvanced.dev unless it is an approved authority', () => {
    expect(() => IdentifierNamespaceRegistryModel.create({ ...namespace, systemUri: 'http://id.bioadvanced.dev/ns/x' })).toThrow(/HTTPS/);
    expect(() => IdentifierNamespaceRegistryModel.create({ ...namespace, systemUri: 'https://bioadvanced.dev.evil.org/ns/x' })).toThrow(/RULE-036/);
    const external = { ...namespace, systemUri: 'https://gs1.org/ns/x' };
    expect(() => IdentifierNamespaceRegistryModel.create(external)).toThrow(/RULE-036/);
    expect(IdentifierNamespaceRegistryModel.create(external, { approvedAuthorities: ['gs1.org'] }).systemUri).toBe('https://gs1.org/ns/x');
  });

  it('keeps the URI stable across versions', () => {
    const v1 = IdentifierNamespaceRegistryModel.create(namespace);
    const v2 = IdentifierNamespaceRegistryModel.create({ ...namespace, semanticVersion: '1.1.0' });
    expect(() => IdentifierNamespaceRegistryModel.assertStableUri(v1, v2)).not.toThrow();
    const moved = IdentifierNamespaceRegistryModel.create({ ...namespace, systemUri: 'https://id.bioadvanced.dev/ns/other', semanticVersion: '2.0.0' });
    expect(() => IdentifierNamespaceRegistryModel.assertStableUri(v1, moved)).toThrow(/RULE-036/);
  });

  it('requires a SemVer version, a target type and a period whose end follows its start', () => {
    expect(() => IdentifierNamespaceRegistryModel.create({ ...namespace, semanticVersion: 'v1' })).toThrow(/SemVer/);
    expect(() => IdentifierNamespaceRegistryModel.create({ ...namespace, targetTypes: [] })).toThrow(/targetTypes/);
    expect(() => IdentifierNamespaceRegistryModel.create({
      ...namespace, effectivePeriod: { start: '2026-10-02T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
    })).toThrow(/\[start, end\)/);
  });
});

describe('IdentificationPolicy model (RF016 AC5)', () => {
  it('accepts a policy over the AC5 symbologies and answers which it allows', () => {
    const created = IdentificationPolicyModel.create(policy);
    expect(IdentificationPolicyModel.allows(created, 'DATA_MATRIX')).toBe(true);
    expect(IdentificationPolicyModel.allows(created, 'qr_code')).toBe(false);
  });

  it('refuses a symbology outside AC5, an empty rule list, a fallback other than manual accession, and no checksum rules', () => {
    expect(() => IdentificationPolicyModel.create({ ...policy, allowedSymbologies: ['ean_13'] })).toThrow('allowedSymbologies inválido: ean_13');
    expect(() => IdentificationPolicyModel.create({ ...policy, privacyRules: [] })).toThrow(/privacyRules/);
    expect(() => IdentificationPolicyModel.create({ ...policy, fallbackMode: 'skip' })).toThrow('fallbackMode inválido: skip');
    expect(() => IdentificationPolicyModel.create({ ...policy, checksumRules: null })).toThrow(/checksumRules/);
  });
});
