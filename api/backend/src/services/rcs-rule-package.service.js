const RcsRulePackageModel = require('../models/RcsRulePackage');
const rcsCertificationService = require('./rcs-certification.service');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { upsertDocs } = require('../foundation/essential-references');

// RF018 AC10 and CFG-006 (#1320): the RCSRulePackage (V2E-0354..0360) of the
// rules certify() runs, and its one writer. The Phase 2 essential-reference
// load is the only caller, after the rcs-gov-1.0 release is active (plano
// §7: Phase 2 populates approved releases, an assessment only references
// the package). See
// docs/decisions/2026-10-25-rcs-rule-package-collection-and-writer.md.

// The package fields of the running rules, or null with no running package.
// semanticVersion is the running version as the service names it, so the
// model refuses it until the rules name a SemVer. validationEvidenceIds is
// empty because no RCSValidationStudy (V2E-0361..0368) exists.
function runningRulePackageFields(service = rcsCertificationService, { status } = {}) {
  const pkg = service.rulePackage();
  if (!pkg) return null;
  return {
    semanticVersion: pkg.version,
    sprecMappingReleaseId: service.sprecMappingRelease()?.sprecMappingReleaseId ?? null,
    checksum: pkg.checksum,
    governanceGateVersion: service.governanceRuleSet().version,
    status,
    validationEvidenceIds: [],
  };
}

// Writes the package only when it validates, keyed by checksum with
// $setOnInsert: the same rules re-loaded insert nothing and answer the first
// package's id, and nothing edits a stored package.
async function recordRulePackage(db, fields) {
  if (!fields) return { written: false, rcsRulePackageId: null, errors: ['no running rule package'] };
  const { isValid, errors } = RcsRulePackageModel.validate(fields);
  if (!isValid) return { written: false, rcsRulePackageId: null, errors };
  const doc = RcsRulePackageModel.create(fields);
  const collectionName = CANONICAL_COLLECTIONS.rcsRulePackages;
  const insertedIds = await upsertDocs(db, collectionName, [doc], ['checksum']);
  const stored = await db.collection(collectionName).findOne({ checksum: doc.checksum });
  return { written: insertedIds.length === 1, rcsRulePackageId: stored ? stored.rcsRulePackageId : null, errors: [] };
}

module.exports = { runningRulePackageFields, recordRulePackage };
