import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rcsService = require('../../../src/services/rcs-certification.service');
const referenceData = require('../../../src/services/rcs-reference-data');
const RcsRulePackageModel = require('../../../src/models/RcsRulePackage');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { runningRulePackageFields, recordRulePackage } = require('../../../src/services/rcs-rule-package.service');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RF018 AC10, CFG-006 (#1320): the RCSRulePackage of the running rules is
 * written only when it validates, keyed by checksum, and nothing edits a
 * stored package. The running rules do not validate today: their version is
 * RCS-GOV-1.0, not a SemVer, and no validation evidence exists.
 */
const packagesOf = (db) => db.collection(CANONICAL_COLLECTIONS.rcsRulePackages).docs;
const running = () => runningRulePackageFields(undefined, { status: 'active' });
// Test-only data: a SemVer and a validation evidence id the running rules lack.
const validFields = () => ({ ...running(), semanticVersion: '1.0.0', validationEvidenceIds: ['rcs-validation-study-1'] });

describe('runningRulePackageFields (RF018 AC10, #1320)', () => {
  it('builds the package fields from the running rule package, SPREC mapping release and gate', () => {
    expect(running()).toEqual({
      semanticVersion: rcsService.rulePackage().version,
      sprecMappingReleaseId: rcsService.sprecMappingRelease().sprecMappingReleaseId,
      checksum: rcsService.rulePackage().checksum,
      governanceGateVersion: rcsService.governanceRuleSet().version,
      status: 'active',
      validationEvidenceIds: [],
    });
  });

  it('is null with no running rule package', () => {
    const { matrixMapping, ...withoutMatrixMapping } = referenceData;
    const service = new rcsService.RcsCertificationService(withoutMatrixMapping);
    expect(runningRulePackageFields(service, { status: 'active' })).toBeNull();
  });
});

describe('recordRulePackage (RF018 AC10, CFG-006, #1320)', () => {
  it('writes nothing for the running rules and returns the two errors', async () => {
    const db = createFakeDb();
    const result = await recordRulePackage(db, running());

    expect(result).toMatchObject({ written: false, rcsRulePackageId: null });
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((error) => error.includes('semanticVersion'))).toBe(true);
    expect(result.errors.some((error) => error.includes('validationEvidenceIds'))).toBe(true);
    expect(result.errors).toContain('semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH) para RCSRulePackage (1..1): RCS-GOV-1.0');
    expect(result.errors).toContain('validationEvidenceIds é obrigatório para RCSRulePackage (1..*, Reference)');
    expect(packagesOf(db)).toHaveLength(0);
  });

  it('writes a valid package with exactly the model fields and returns its id', async () => {
    const db = createFakeDb();
    const result = await recordRulePackage(db, validFields());

    expect(packagesOf(db)).toHaveLength(1);
    const [stored] = packagesOf(db);
    const { _id, rcsRulePackageId, ...fields } = stored;
    expect({ ...fields, rcsRulePackageId }).toEqual(RcsRulePackageModel.fieldsOf({ ...validFields(), rcsRulePackageId }));
    expect(typeof rcsRulePackageId).toBe('string');
    expect(result).toEqual({ written: true, rcsRulePackageId, errors: [] });
  });

  it('a second package with the same checksum inserts nothing, returns the first id and leaves the stored package unchanged', async () => {
    const db = createFakeDb();
    const first = await recordRulePackage(db, validFields());
    const second = await recordRulePackage(db, { ...validFields(), semanticVersion: '2.0.0' });

    expect(second).toEqual({ written: false, rcsRulePackageId: first.rcsRulePackageId, errors: [] });
    expect(packagesOf(db)).toHaveLength(1);
    expect(packagesOf(db)[0]).toMatchObject({ rcsRulePackageId: first.rcsRulePackageId, semanticVersion: '1.0.0' });
  });

  it('writes nothing with no running rule package', async () => {
    const db = createFakeDb();
    expect(await recordRulePackage(db, null)).toEqual({ written: false, rcsRulePackageId: null, errors: ['no running rule package'] });
    expect(packagesOf(db)).toHaveLength(0);
  });
});
