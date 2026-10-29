/**
 * #1304, plano §4 F1.2 ("Registrar release canônica, catálogo de
 * invariantes, perfis e releases de configuração"): the Foundation job
 * registers the CanonicalModelRelease this build follows and the
 * GovernanceInvariantCatalog bound to it.
 *
 * Registration is idempotent: a re-run finds both and writes nothing. A
 * registered release or catalog is never rewritten, so one whose checksum no
 * longer matches what this build computes is reported as a conflict, and the
 * `governance-registry` readiness gate fails on it (plano §9 "Versão":
 * paridade de canonicalModelReleaseId e checksums).
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const CanonicalModelReleaseModel = require('../models/CanonicalModelRelease');
const GovernanceInvariantCatalogModel = require('../models/GovernanceInvariantCatalog');
const canonicalDictionary = require('../reference-data/canonical-dictionary/v2');
const releaseManifest = require('../reference-data/canonical-dictionary/release-manifest.2.0.0.json');
const { CANONICAL_MODEL_RELEASE_ID } = require('../foundation/readiness');
const { INVARIANT_CATALOG_VERSION, INVARIANTS } = require('./invariants');
const {
  ensureCanonicalModelReleaseIndexes,
  ensureGovernanceInvariantCatalogIndexes,
} = require('../utils/governanceRegistryIndexes');

// The release manifest records the approval date and scope, and names no
// person (docs/RELEASE_MANIFEST.json, approvalScope documentary_release).
// The approver is therefore the manifest itself.
const MANIFEST_APPROVER = `release-manifest:${releaseManifest.approvalScope}`;

/**
 * V2E-0009: the approved release's documentary artifacts with their
 * SHA-256, plus the generated catalog this build validates against, so the
 * release checksum moves if either does.
 */
function artifactManifest() {
  return [
    ...releaseManifest.artifacts.map(({ file, sha256 }) => ({ artifact: file, checksum: `sha256:${sha256}` })),
    { artifact: `catalog.${canonicalDictionary.DICTIONARY_VERSION}.json`, checksum: `sha256:${canonicalDictionary.dictionaryChecksum()}` },
  ];
}

/** What this build expects to find registered. */
function expectedRegistry() {
  const manifest = artifactManifest();
  const invariants = INVARIANTS.map(GovernanceInvariantCatalogModel.invariantFieldsOf);
  return {
    canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    semanticVersion: canonicalDictionary.DICTIONARY_VERSION,
    releaseChecksum: CanonicalModelReleaseModel.manifestChecksum(manifest),
    artifactManifest: manifest,
    catalogVersion: INVARIANT_CATALOG_VERSION,
    catalogChecksum: GovernanceInvariantCatalogModel.invariantsChecksum(invariants),
    invariants,
  };
}

function collections(db) {
  return {
    releases: db.collection(CANONICAL_COLLECTIONS.canonicalModelReleases),
    catalogs: db.collection(CANONICAL_COLLECTIONS.governanceInvariantCatalogs),
  };
}

/**
 * Registers the release and the catalog where absent. Returns what was
 * registered (`inserted`), and any registered record whose checksum differs
 * from this build's (`conflicts`), which it leaves untouched.
 */
async function registerGovernance(db, { now = new Date() } = {}) {
  const { releases, catalogs } = collections(db);
  const expected = expectedRegistry();
  const inserted = [];
  const conflicts = [];

  await ensureCanonicalModelReleaseIndexes(releases);
  await ensureGovernanceInvariantCatalogIndexes(catalogs);

  const release = await releases.findOne({ canonicalModelReleaseId: expected.canonicalModelReleaseId });
  if (!release) {
    await releases.insertOne(CanonicalModelReleaseModel.createActive({
      canonicalModelReleaseId: expected.canonicalModelReleaseId,
      semanticVersion: expected.semanticVersion,
      artifactManifest: expected.artifactManifest,
      approvedBy: MANIFEST_APPROVER,
      approvedAt: new Date(`${releaseManifest.approvedOn}T00:00:00Z`),
      now,
    }));
    inserted.push('canonicalModelRelease');
  } else if (release.checksum !== expected.releaseChecksum) {
    conflicts.push({ record: 'canonicalModelRelease', registered: release.checksum, expected: expected.releaseChecksum });
  }

  const filter = { canonicalModelReleaseId: expected.canonicalModelReleaseId, semanticVersion: expected.catalogVersion };
  const catalog = await catalogs.findOne(filter);
  if (!catalog) {
    await catalogs.insertOne(GovernanceInvariantCatalogModel.createActive({
      semanticVersion: expected.catalogVersion,
      canonicalModelReleaseId: expected.canonicalModelReleaseId,
      invariants: INVARIANTS,
      now,
    }));
    inserted.push('governanceInvariantCatalog');
  } else if (catalog.checksum !== expected.catalogChecksum) {
    conflicts.push({ record: 'governanceInvariantCatalog', registered: catalog.checksum, expected: expected.catalogChecksum });
  }

  return { inserted, conflicts };
}

/**
 * The readiness gate's evidence: both records exist, are active, and carry
 * the checksums this build computes.
 */
async function verifyGovernance(db) {
  const { releases, catalogs } = collections(db);
  const expected = expectedRegistry();
  const release = await releases.findOne({ canonicalModelReleaseId: expected.canonicalModelReleaseId });
  const catalog = await catalogs.findOne({ canonicalModelReleaseId: expected.canonicalModelReleaseId, semanticVersion: expected.catalogVersion });
  const failures = [];
  if (!release) failures.push('canonicalModelRelease ausente');
  else {
    if (release.releaseStatus !== 'active') failures.push(`canonicalModelRelease está ${release.releaseStatus}`);
    if (release.checksum !== expected.releaseChecksum) failures.push('checksum da canonicalModelRelease diverge');
  }
  if (!catalog) failures.push('governanceInvariantCatalog ausente');
  else {
    if (catalog.status !== 'active') failures.push(`governanceInvariantCatalog está ${catalog.status}`);
    if (catalog.checksum !== expected.catalogChecksum) failures.push('checksum do governanceInvariantCatalog diverge');
  }
  return {
    passed: failures.length === 0,
    evidence: {
      canonicalModelReleaseId: expected.canonicalModelReleaseId,
      releaseChecksum: expected.releaseChecksum,
      catalogVersion: expected.catalogVersion,
      catalogChecksum: expected.catalogChecksum,
      invariants: expected.invariants.length,
      failures,
    },
  };
}

module.exports = {
  MANIFEST_APPROVER,
  artifactManifest,
  expectedRegistry,
  registerGovernance,
  verifyGovernance,
};
