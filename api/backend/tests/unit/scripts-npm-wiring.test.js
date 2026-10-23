import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

// #1125: a script under src/scripts/ that is neither an npm script nor invoked
// by a boot path or compose service never runs on any stack (#933). Each entry
// below is a one-shot migration, a backfill or a manual seed whose logic is
// already unit-tested -- either in the script's own test file or in the
// service the script wraps -- so the only thing missing was a way to run it.
//
// Deliberately NOT every file in src/scripts/: seedRbacCatalog.js stays
// hand-run on the reason its own header gives (server.js re-seeds the RBAC
// catalog on every boot). Whether ALL scripts must be wired is a separate
// guard question, not this list's.
const WIRED = [
  // Control cases: wired before #1125's direction 1 (#1070, 4d9c220d).
  ['migrate:location-storage', 'backfillLocationStorage.js'],
  ['migrate:user-role-assignments', 'backfillUserRoleAssignments.js'],

  // Tested scripts.
  ['migrate:clinical-unit-organizations', 'migrateClinicalUnitOrganizations.js'],
  ['migrate:role-assignment-scopes', 'migrateRoleAssignmentScopes.js'],
  ['migrate:user-anon-ids', 'migrateUserAnonIds.js'],
  ['migrate:user-organizations', 'migrateUserOrganizations.js'],
  ['migrate:consent-token-hash', 'migrateConsentTokenHash.js'],
  ['migrate:specimen-status-v2', 'migrateSpecimenStatusV2.js'],
  ['migrate:sample-organization', 'migrateSampleOrganization.js'],
  ['migrate:storage-assignments-to-chain', 'migrateStorageAssignmentsToChain.js'],
  ['migrate:specimen-role', 'migrateSpecimenRole.js'],
  ['migrate:facilities-rooms-to-locations', 'migrateFacilitiesRoomsToLocations.js'],
  ['migrate:sample-barcode-labels', 'migrateSampleBarcodeLabels.js'],
  ['migrate:auth-canonical-names', 'migrateAuthCanonicalNames.js'],
  ['migrate:sensor-metadata-to-datastreams', 'migrateSensorMetadataToDatastreams.js'],
  ['encryption:rewrite', 'rewriteEncryptedFields.js'],

  // CLI wrappers over tested services.
  ['migrate:participant-identities', 'backfillParticipantIdentities.js'],
  ['migrate:result-specimen-ids', 'backfillResultSpecimenIds.js'],
  ['migrate:sealed-snapshot-pins', 'backfillSealedSnapshotPins.js'],
  ['migrate:drop-legacy-locations', 'dropLegacyLocationsCollection.js'],
];

describe('src/scripts npm wiring (#1125)', () => {
  it.each(WIRED)('%s runs src/scripts/%s', (name, file) => {
    expect(pkg.scripts[name]).toBe(`node src/scripts/${file}`);
  });
});
