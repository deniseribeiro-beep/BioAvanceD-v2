const {
  ENTITY_LOCATIONS,
  getCanonicalCollectionName,
} = require('../config/canonicalEntityCollections.v2');
const { preflightAccountIdentity, runAccountIdentityMigration } = require('./userAccountIdentityMigrationV2');

// Sources only. Normal application code must never resolve these names.
const LEGACY_RENAMES = Object.freeze([
  { source: 'patients', target: getCanonicalCollectionName('Participant') },
  { source: 'amostras', target: getCanonicalCollectionName('Specimen') },
  { source: 'samples', target: getCanonicalCollectionName('Specimen') },
  { source: 'users', target: getCanonicalCollectionName('UserAccount') },
  { source: 'consent_templates', target: getCanonicalCollectionName('ConsentTemplate') },
  { source: 'patientConsents', target: getCanonicalCollectionName('Consent') },
  { source: 'patient_consents', target: getCanonicalCollectionName('Consent') },
  { source: 'sample_movements', target: 'sampleMovements' },
  { source: 'clinical_units', target: 'clinicalUnits' },
  { source: 'biomarker_observations', target: 'biomarkerObservations' },
  { source: 'disease_dictionary', target: 'diseaseDictionary' },
  { source: 'medication_dictionary', target: 'medicationDictionary' },
]);

const REQUIRED_COLLECTIONS = Object.freeze([...new Set(Object.values(ENTITY_LOCATIONS)
  .filter((entry) => entry.storageMode === 'COLLECTION'
    && !entry.populationPhase.includes('conditional future project'))
  .map((entry) => entry.collection))].sort());
const ENTITY_BY_COLLECTION = new Map(Object.entries(ENTITY_LOCATIONS)
  .filter(([, entry]) => entry.storageMode === 'COLLECTION')
  .map(([entity, entry]) => [entry.collection, { entity, ...entry }]));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function discoverTopology(db) {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(rows.map((row) => row.name));
}

function planTopology(existingNames) {
  const existing = new Set(existingNames);
  const byTarget = new Map();
  for (const rename of LEGACY_RENAMES) {
    if (!byTarget.has(rename.target)) byTarget.set(rename.target, []);
    byTarget.get(rename.target).push(rename.source);
  }

  const renames = [];
  const conflicts = [];
  const alreadyMigrated = [];
  const toCreate = [];
  const plannedTargets = new Set();
  for (const [target, sources] of byTarget) {
    const presentSources = sources.filter((source) => existing.has(source));
    if (presentSources.length > 1 || (presentSources.length && existing.has(target))) {
      conflicts.push({ target, sources: presentSources, reason: 'SOURCE_AND_TARGET_PRESENT' });
    } else if (presentSources.length === 1) {
      renames.push({ source: presentSources[0], target });
      plannedTargets.add(target);
    } else if (existing.has(target)) {
      alreadyMigrated.push(target);
    }
  }

  for (const target of REQUIRED_COLLECTIONS) {
    if (!existing.has(target) && !plannedTargets.has(target)) toCreate.push(target);
  }
  return {
    renames,
    toCreate,
    alreadyMigrated,
    conflicts,
    wouldBlock: conflicts.length > 0,
    migrationRequired: conflicts.length > 0,
  };
}

async function preflightTopology(db, plan, { skipAccount = false } = {}) {
  const invalidIdentifiers = [];
  const checks = [
    ...plan.renames.map(({ source, target }) => ({ name: source, target })),
    ...plan.alreadyMigrated.map((target) => ({ name: target, target })),
  ];
  for (const { name, target } of checks) {
    const location = ENTITY_BY_COLLECTION.get(target);
    if (!location) continue;
    if (skipAccount && location.entity === 'UserAccount') continue;
    const field = location.primaryIdentifier;
    const invalid = location.primaryType === 'uuid'
      ? { [field]: { $not: UUID_PATTERN } }
      : { $or: [{ [field]: { $exists: false } }, { [field]: null }] };
    const invalidIdCount = await db.collection(name).countDocuments(invalid);
    if (invalidIdCount) invalidIdentifiers.push({ collection: name, target, entity: location.entity, invalidIdCount });
  }
  return { valid: invalidIdentifiers.length === 0, invalidIdentifiers };
}

async function verifyTopology(db) {
  const existing = await discoverTopology(db);
  const missing = REQUIRED_COLLECTIONS.filter((name) => !existing.has(name));
  const remainingLegacy = LEGACY_RENAMES.filter(({ source }) => existing.has(source)).map(({ source }) => source);
  return {
    verified: Object.keys(ENTITY_LOCATIONS).length === 140 && missing.length === 0 && remainingLegacy.length === 0,
    resolvedEntities: Object.keys(ENTITY_LOCATIONS).length,
    missing,
    remainingLegacy,
  };
}

async function runTopology(db, { mode = 'apply' } = {}) {
  if (!['apply', 'dry-run'].includes(mode)) throw new Error('Invalid topology mode');
  const plan = planTopology(await discoverTopology(db));
  if (mode === 'dry-run') {
    const structuralPreflight = await preflightTopology(db, plan, { skipAccount: true });
    const accountPreflight = await preflightAccountIdentity(db);
    return {
      mode, plan,
      preflight: { structural: structuralPreflight, accountIdentity: { ...accountPreflight.plan, updates: undefined } },
      wouldBlock: plan.wouldBlock || !structuralPreflight.valid || accountPreflight.plan.wouldBlock,
      applied: false,
    };
  }
  if (plan.wouldBlock) {
    const error = new Error('Canonical MongoDB topology migration conflict');
    error.code = 'COLLECTION_MIGRATION_CONFLICT';
    error.plan = plan;
    throw error;
  }
  const structuralPreflight = await preflightTopology(db, plan, { skipAccount: true });
  if (!structuralPreflight.valid) {
    const error = new Error('Canonical identifier migration requires an explicit data plan');
    error.code = 'STRUCTURAL_MIGRATION_REQUIRED';
    error.preflight = structuralPreflight;
    throw error;
  }
  const accountState = await preflightAccountIdentity(db);
  if (accountState.plan.wouldBlock) {
    const error = new Error('Account identity migration has unresolved data');
    error.code = 'DATA_MIGRATION_CONFLICT';
    error.plan = { ...accountState.plan, updates: undefined };
    throw error;
  }
  const accountMigration = await runAccountIdentityMigration(db);
  const preflight = await preflightTopology(db, plan);
  if (!preflight.valid) {
    const error = new Error('Canonical identifier migration requires an explicit data plan');
    error.code = 'STRUCTURAL_MIGRATION_REQUIRED';
    error.preflight = preflight;
    throw error;
  }
  const renamedCollections = [];
  const createdCollections = [];
  for (const { source, target } of plan.renames) {
    await db.collection(source).rename(target, { dropTarget: false });
    renamedCollections.push({ source, target });
  }
  for (const name of plan.toCreate) {
    await db.createCollection(name);
    createdCollections.push(name);
  }
  const verification = await verifyTopology(db);
  if (!verification.verified) {
    const error = new Error('Canonical MongoDB topology verification failed');
    error.code = 'TOPOLOGY_VERIFY_FAILED';
    error.verification = verification;
    throw error;
  }
  return { mode, plan, preflight, accountMigration, renamedCollections, createdCollections, verification, applied: true };
}

module.exports = { LEGACY_RENAMES, REQUIRED_COLLECTIONS, discoverTopology, planTopology, preflightTopology, verifyTopology, runTopology };
