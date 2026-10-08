import { describe, it, expect } from 'vitest';

const CanonicalModelReleaseModel = require('../../../src/models/CanonicalModelRelease');
const GovernanceInvariantCatalogModel = require('../../../src/models/GovernanceInvariantCatalog');
const { INVARIANTS, invariantForPath } = require('../../../src/governance/invariants');
const { expectedRegistry, artifactManifest } = require('../../../src/governance/registry');
const releaseManifest = require('../../../src/reference-data/canonical-dictionary/release-manifest.2.0.0.json');

/**
 * #1304 (GOV-001/GOV-002, CFG-003): the CanonicalModelRelease and the
 * GovernanceInvariantCatalog the Foundation job registers. The job-level
 * cases (registered once, conflict blocks readiness) are in
 * tests/unit/scripts/seed-essential-reference-data.test.js.
 */
describe('CanonicalModelReleaseModel', () => {
  const manifest = [{ artifact: 'a.docx', checksum: 'sha256:aa' }];
  const build = () => CanonicalModelReleaseModel.createActive({
    canonicalModelReleaseId: 'release-2.0.0', semanticVersion: '2.0.0', artifactManifest: manifest,
    approvedBy: 'release-manifest:documentary_release', approvedAt: new Date('2026-09-12T00:00:00Z'),
  });

  it('builds an active release whose checksum names its artifact manifest', () => {
    const release = build();
    expect(release).toMatchObject({ releaseStatus: 'active', supersedesId: null });
    expect(release.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(CanonicalModelReleaseModel.validate(release)).toEqual({ isValid: true, errors: [] });
  });

  it('refuses a manifest that no longer matches the checksum, a non-SemVer version and an unapproved active release', () => {
    const release = build();
    expect(CanonicalModelReleaseModel.validate({ ...release, artifactManifest: [{ artifact: 'a.docx', checksum: 'sha256:bb' }] }).errors)
      .toContain('checksum não corresponde a artifactManifest');
    expect(CanonicalModelReleaseModel.validate({ ...release, semanticVersion: 'v2' }).errors).toContain('semanticVersion deve ser SemVer');
    expect(CanonicalModelReleaseModel.validate({ ...release, approvedBy: null }).errors)
      .toContain('approvedBy e approvedAt são obrigatórios para uma release aprovada');
  });
});

describe('GovernanceInvariantCatalogModel', () => {
  it('builds the active catalog from the published invariants', () => {
    const catalog = GovernanceInvariantCatalogModel.createActive({ semanticVersion: '1.0.0', canonicalModelReleaseId: 'release-2.0.0', invariants: INVARIANTS });
    expect(catalog.invariants).toHaveLength(INVARIANTS.length);
    // configurationPaths is the validation run's lookup, not a dictionary field.
    expect(catalog.invariants[0]).not.toHaveProperty('configurationPaths');
    expect(GovernanceInvariantCatalogModel.validate(catalog).isValid).toBe(true);
  });

  it('refuses a duplicate invariantId, an invariant with no test, a non-blocking outcome and a stale checksum', () => {
    const catalog = GovernanceInvariantCatalogModel.createActive({ semanticVersion: '1.0.0', canonicalModelReleaseId: 'release-2.0.0', invariants: INVARIANTS });
    const [first, ...rest] = catalog.invariants;
    expect(GovernanceInvariantCatalogModel.validate({ ...catalog, invariants: [first, first, ...rest] }).errors)
      .toContain(`invariantId duplicado: ${first.invariantId}`);
    expect(GovernanceInvariantCatalogModel.validate({ ...catalog, invariants: [{ ...first, testId: [] }, ...rest] }).errors)
      .toContain(`${first.invariantId}.testId deve listar ao menos um item`);
    expect(GovernanceInvariantCatalogModel.validate({ ...catalog, invariants: [{ ...first, violationOutcome: 'warn' }, ...rest] }).errors)
      .toContain(`${first.invariantId}.violationOutcome deve ser um de: block`);
    expect(GovernanceInvariantCatalogModel.validate({ ...catalog, invariants: rest }).errors).toContain('checksum não corresponde a invariants');
  });
});

describe('the published invariants', () => {
  it('each configuration path belongs to one invariant, and each named test file exists', () => {
    const fs = require('fs');
    const path = require('path');
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const paths = INVARIANTS.flatMap((invariant) => invariant.configurationPaths);
    expect(new Set(paths).size).toBe(paths.length);
    for (const invariant of INVARIANTS) {
      for (const testId of invariant.testId) expect(fs.existsSync(path.join(repoRoot, testId)), testId).toBe(true);
      for (const point of invariant.enforcementPoint) expect(fs.existsSync(path.join(repoRoot, point.split('#')[0])), point).toBe(true);
    }
    expect(invariantForPath('logging.logAllActions').invariantId).toBe('INV-AUDIT-001');
    expect(invariantForPath('session.timeoutMinutes')).toBeNull();
  });

  it('the security service fixes every invariant configuration path', () => {
    const { FIXED_PATHS } = require('../../../src/services/security.service');
    for (const configPath of INVARIANTS.flatMap((invariant) => invariant.configurationPaths)) {
      expect(Object.keys(FIXED_PATHS), configPath).toContain(configPath);
    }
  });
});

describe('the expected registry', () => {
  it('lists every approved artifact with its checksum, plus the generated catalog', () => {
    const manifest = artifactManifest();
    expect(manifest).toHaveLength(releaseManifest.artifacts.length + 1);
    expect(manifest[0]).toEqual({ artifact: releaseManifest.artifacts[0].file, checksum: `sha256:${releaseManifest.artifacts[0].sha256}` });
    expect(manifest.at(-1).artifact).toBe('catalog.2.0.0.json');
    expect(expectedRegistry()).toMatchObject({ canonicalModelReleaseId: 'release-2.0.0', semanticVersion: '2.0.0', catalogVersion: '1.0.0' });
  });
});
