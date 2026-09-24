const { randomUUID } = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_REFERENCES = Object.freeze([
  { collection: 'userRoleAssignments', field: 'userAccountId' },
  { collection: 'accessGrants', field: 'userAccountId' },
  { collection: 'sessions', field: 'userAccountId', historicalField: 'userID' },
  { collection: 'recoveryCodeSets', field: 'userAccountId' },
]);
const ACTOR_REFERENCES = Object.freeze([
  { collection: 'userRoleAssignments', fields: ['grantedBy', 'revokedBy'] },
  { collection: 'accessGrants', fields: ['grantedBy'] },
  { collection: 'sessions', fields: ['revokedBy'] },
]);

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function legacyKey(value) {
  return value == null ? null : String(value);
}

async function discoverAccountIdentity(db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const accountCollection = names.has('users') ? 'users' : names.has('userAccounts') ? 'userAccounts' : null;
  const accounts = accountCollection
    ? await db.collection(accountCollection).find({}, { projection: { _id: 1, userAccountId: 1, actorId: 1 } }).toArray()
    : [];
  const actors = names.has('actors')
    ? await db.collection('actors').find({}, { projection: { actorId: 1 } }).toArray()
    : [];
  const references = {};
  for (const { collection } of USER_REFERENCES) {
    references[collection] = names.has(collection)
      ? await db.collection(collection).find({}, { projection: { _id: 1, userAccountId: 1, userID: 1, grantedBy: 1, revokedBy: 1, isRevoked: 1 } }).toArray()
      : [];
  }
  return { names, accountCollection, accounts, actors, references };
}

function planAccountIdentity(snapshot) {
  const issues = [];
  const byLegacy = new Map();
  const byUuid = new Map();
  const actorIds = new Set(snapshot.actors.map(({ actorId }) => actorId).filter(isUuid));
  let missingUuid = 0;
  let invalidUuid = 0;
  let duplicateUuid = 0;
  for (const account of snapshot.accounts) {
    const key = legacyKey(account._id);
    if (byLegacy.has(key)) issues.push({ code: 'DUPLICATE_PHYSICAL_ACCOUNT_ID' });
    byLegacy.set(key, account);
    if (account.userAccountId == null) {
      missingUuid += 1;
    } else if (!isUuid(account.userAccountId)) {
      invalidUuid += 1;
      issues.push({ code: 'INVALID_ACCOUNT_UUID' });
    } else {
      if (byUuid.has(account.userAccountId)) {
        duplicateUuid += 1;
        issues.push({ code: 'DUPLICATE_ACCOUNT_UUID' });
      }
      byUuid.set(account.userAccountId, account);
    }
    if (!isUuid(account.actorId) || !actorIds.has(account.actorId)) {
      issues.push({ code: 'ACCOUNT_ACTOR_UNRESOLVED' });
    }
  }

  const updates = [];
  let legacyReferences = 0;
  let orphanReferences = 0;
  let actorConflicts = 0;
  for (const { collection, field, historicalField } of USER_REFERENCES) {
    for (const doc of snapshot.references[collection] || []) {
      const value = doc[field] ?? (historicalField ? doc[historicalField] : null);
      const key = legacyKey(value);
      if (isUuid(value) && byUuid.has(value)) {
        if (doc[field] == null) updates.push({ collection, id: doc._id, field, accountKey: legacyKey(byUuid.get(value)._id) });
      } else if (byLegacy.has(key)) {
        legacyReferences += 1;
        updates.push({ collection, id: doc._id, field, accountKey: key });
      } else {
        orphanReferences += 1;
        issues.push({ code: 'ORPHAN_USER_ACCOUNT_REFERENCE', collection, field });
      }
    }
  }

  for (const { collection, fields } of ACTOR_REFERENCES) {
    for (const doc of snapshot.references[collection] || []) {
      for (const field of fields) {
        const value = doc[field];
        if (value == null) continue;
        if (isUuid(value) && actorIds.has(value)) continue;
        const account = byLegacy.get(legacyKey(value)) || byUuid.get(value);
        if (account && actorIds.has(account.actorId)) {
          updates.push({ collection, id: doc._id, field, actorId: account.actorId });
        } else {
          actorConflicts += 1;
          issues.push({ code: 'ACTOR_REFERENCE_UNRESOLVED', collection, field });
        }
      }
    }
  }

  return {
    accountCollection: snapshot.accountCollection,
    totalAccounts: snapshot.accounts.length,
    missingUuid, invalidUuid, duplicateUuid,
    referenceFields: USER_REFERENCES.map(({ collection, field }) => ({ collection, field })),
    legacyReferences, orphanReferences, actorConflicts,
    updates, issues,
    migrationRequired: missingUuid > 0 || updates.length > 0,
    wouldBlock: issues.length > 0,
  };
}

async function preflightAccountIdentity(db) {
  const snapshot = await discoverAccountIdentity(db);
  return { snapshot, plan: planAccountIdentity(snapshot) };
}

async function verifyAccountIdentity(db) {
  const { plan } = await preflightAccountIdentity(db);
  return {
    verified: !plan.wouldBlock && !plan.migrationRequired,
    totalAccounts: plan.totalAccounts,
    missingUuid: plan.missingUuid,
    invalidUuid: plan.invalidUuid,
    duplicateUuid: plan.duplicateUuid,
    legacyReferences: plan.legacyReferences,
    orphanReferences: plan.orphanReferences,
    actorConflicts: plan.actorConflicts,
    issues: plan.issues,
  };
}

async function runAccountIdentityMigration(db, { mode = 'apply' } = {}) {
  if (!['apply', 'dry-run'].includes(mode)) throw new Error('Invalid account identity mode');
  const { snapshot, plan } = await preflightAccountIdentity(db);
  if (mode === 'dry-run') return { mode, plan, applied: false };
  if (plan.wouldBlock) {
    const error = new Error('Account identity migration has unresolved data');
    error.code = 'DATA_MIGRATION_CONFLICT';
    error.plan = { ...plan, updates: undefined };
    throw error;
  }

  const accountIds = new Map();
  for (const account of snapshot.accounts) {
    let uuid = account.userAccountId;
    if (uuid == null) {
      uuid = randomUUID();
      const result = await db.collection(snapshot.accountCollection).updateOne(
        { _id: account._id, userAccountId: null },
        { $set: { userAccountId: uuid } },
      );
      if (result.matchedCount !== 1) {
        const error = new Error('Account changed during identity migration; rerun preflight');
        error.code = 'DATA_MIGRATION_CONFLICT';
        throw error;
      }
    }
    accountIds.set(legacyKey(account._id), uuid);
  }

  for (const update of plan.updates) {
    const value = update.actorId ?? accountIds.get(update.accountKey);
    const result = await db.collection(update.collection).updateOne(
      { _id: update.id }, { $set: { [update.field]: value } },
    );
    if (result.matchedCount !== 1) {
      const error = new Error('Reference changed during account identity migration');
      error.code = 'DATA_MIGRATION_CONFLICT';
      throw error;
    }
  }

  // Pre-cutover access/refresh tokens encode the Mongo ObjectId. Preserve the
  // audit record while revoking the credential; middleware rejects old claims.
  const revokedLegacySessions = snapshot.references.sessions.filter((doc) =>
    doc.userID != null && !isUuid(doc.userID) && !doc.isRevoked);
  for (const session of revokedLegacySessions) {
    await db.collection('sessions').updateOne({ _id: session._id }, {
      $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: 'canonical_account_identity_cutover' },
    });
  }

  const verification = await verifyAccountIdentity(db);
  if (!verification.verified) {
    const error = new Error('Account identity verification failed');
    error.code = 'DATA_MIGRATION_VERIFY_FAILED';
    error.verification = verification;
    throw error;
  }
  return { mode, plan: { ...plan, updates: undefined }, verified: true, revokedLegacySessions: revokedLegacySessions.length };
}

module.exports = {
  USER_REFERENCES, ACTOR_REFERENCES, isUuid,
  discoverAccountIdentity, planAccountIdentity, preflightAccountIdentity,
  verifyAccountIdentity, runAccountIdentityMigration,
};
