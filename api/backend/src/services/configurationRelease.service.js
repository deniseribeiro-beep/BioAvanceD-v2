/**
 * RF014 AC2/AC4/AC7, CFG-004, CFG-008: governed configuration releases.
 *
 * A change never edits the configuration in force. It activates a new
 * ConfigurationRelease carrying the whole settings snapshot, supersedes the
 * previous one and appends a ConfigurationChangeEvent. A rollback is the
 * same act with an older release's settings: a new release whose
 * rollbackTargetId names the release it restores, never a reactivation of
 * the old row (plano §10: "Nenhuma evidência ou registro histórico é
 * sobrescrito").
 *
 * Each candidate passes a ConfigurationValidationRun first
 * (configurationValidation.service.js); a refused one is kept as a draft.
 * The administrator who activates a change is recorded as its approver
 * (V2E-0037/0038, "obrigatório para ativação"): no source of the v2.0.0
 * release asks for a second approver (docs/decisions/2026-10-07-security-setting-catalog-and-approval.md).
 */
const { isDeepStrictEqual } = require('util');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const ConfigurationProfileModel = require('../models/ConfigurationProfile');
const ConfigurationReleaseModel = require('../models/ConfigurationRelease');
const ConfigurationChangeEventModel = require('../models/ConfigurationChangeEvent');
const { ensureConfigurationReleaseIndexes } = require('../utils/configurationReleaseIndexes');

class ConfigurationReleaseError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ConfigurationReleaseError';
    this.statusCode = statusCode;
  }
}

function collections(db) {
  return {
    profiles: db.collection(CANONICAL_COLLECTIONS.configurationProfiles),
    releases: db.collection(CANONICAL_COLLECTIONS.configurationReleases),
    events: db.collection(CANONICAL_COLLECTIONS.configurationChangeEvents),
  };
}

function isDuplicateKey(error) {
  return error && (error.code === 11000 || /E11000/.test(String(error.message)));
}

// The profile fields `describe` supplies, which follow the setting catalog.
const DESCRIBED_FIELDS = ['settings', 'allowedValues', 'defaults', 'dependencies', 'ownerId'];

/**
 * The profile `profileName` scoped to `environment`, created on first use.
 * `describe` returns the fields a new profile is built from. An existing
 * profile whose described fields differ (the setting catalog changed, RF014
 * AC1) takes the new ones; its profileId, which the releases name, stays.
 */
async function ensureEnvironmentProfile(db, { profileName, environment, describe }) {
  const { profiles } = collections(db);
  const filter = { profileName, scopeType: 'environment', scopeId: environment };
  const described = describe();
  const existing = await profiles.findOne(filter);
  if (existing) {
    const stale = DESCRIBED_FIELDS.filter((field) => !isDeepStrictEqual(existing[field], described[field]));
    if (stale.length === 0) return existing;
    const changes = Object.fromEntries(stale.map((field) => [field, described[field]]));
    const { isValid, errors } = ConfigurationProfileModel.validate({ ...existing, ...changes });
    if (!isValid) throw new Error(`ConfigurationProfile inválido: ${errors.join('; ')}`);
    await profiles.updateOne(filter, { $set: { ...changes, updatedAt: new Date() } });
    return profiles.findOne(filter);
  }
  const profile = ConfigurationProfileModel.create({ profileName, scopeType: 'environment', scopeId: environment, ...described });
  await profiles.updateOne(filter, { $setOnInsert: profile }, { upsert: true });
  return profiles.findOne(filter);
}

async function activeRelease(db, profileId) {
  return collections(db).releases.findOne({ profileId, status: 'active' });
}

async function getRelease(db, configurationReleaseId) {
  return collections(db).releases.findOne({ configurationReleaseId });
}

async function listReleases(db, profileId, { limit = 50 } = {}) {
  // A baseline and the change after it can share a millisecond; the
  // ObjectId breaks the tie in insertion order.
  return collections(db).releases.find({ profileId }).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
}

async function activationEventOf(db, releaseId) {
  const { events } = collections(db);
  return events.find({ releaseId, changeType: { $in: ['activated', 'rolled_back'] } })
    .sort({ occurredAt: -1 }).limit(1).next();
}

/**
 * Activates a release of `settings` for `profileId` and returns it.
 *
 * - The previous active release is superseded first, by a conditional
 *   update on its `active` status, so a concurrent activation that got
 *   there first makes this one fail with 409 instead of leaving two.
 * - The partial unique index on active releases is the backstop for the
 *   window between that update and the insert.
 * - `baseline` records the configuration already in force before the
 *   first release exists, so the first change has something to roll back
 *   to. It is skipped once the profile has any release.
 */
async function activate(db, { configurationReleaseId, profileId, settings, actorId, impactSummary, rollbackTargetId = null, baseline = null, now = new Date() }) {
  const { releases, events } = collections(db);
  await ensureConfigurationReleaseIndexes(releases);

  let current = await activeRelease(db, profileId);
  // Drafts never activated (RF014 AC4) take no version number.
  let count = await releases.countDocuments({ profileId, status: { $ne: 'draft' } });
  if (!current && count === 0 && baseline) {
    const first = ConfigurationReleaseModel.createActive({
      profileId, settings: baseline.settings, version: 1, approvedBy: baseline.approvedBy, now: baseline.since || now,
    });
    try {
      await releases.insertOne(first);
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConfigurationReleaseError('Outra alteração de configuração foi ativada ao mesmo tempo; recarregue e tente de novo.', 409);
      throw error;
    }
    await events.insertOne(ConfigurationChangeEventModel.create({
      releaseId: first.configurationReleaseId,
      changeType: 'activated',
      actorId: baseline.approvedBy,
      impactSummary: 'Configuração em vigor registrada como release de base.',
      occurredAt: now,
    }));
    current = first;
    count = 1;
  }

  // V2E-0059: a rollback points at the event that activated what it undoes.
  const undone = rollbackTargetId && current ? await activationEventOf(db, current.configurationReleaseId) : null;
  if (rollbackTargetId && !undone) {
    throw new ConfigurationReleaseError('Não há ativação registrada para reverter.', 409);
  }

  const release = ConfigurationReleaseModel.createActive({
    configurationReleaseId,
    profileId,
    settings,
    version: count + 1,
    approvedBy: actorId,
    supersedesId: current ? current.configurationReleaseId : null,
    rollbackTargetId,
    now,
  });

  const previousPeriod = current ? { ...current.effectivePeriod } : null;
  if (current) {
    const superseded = await releases.updateOne(
      { configurationReleaseId: current.configurationReleaseId, status: 'active' },
      { $set: { status: 'superseded', effectivePeriod: { start: previousPeriod.start, end: now } } }
    );
    if (superseded.matchedCount === 0) {
      throw new ConfigurationReleaseError('Outra alteração de configuração foi ativada ao mesmo tempo; recarregue e tente de novo.', 409);
    }
  }
  try {
    await releases.insertOne(release);
  } catch (error) {
    if (current) {
      await releases.updateOne(
        { configurationReleaseId: current.configurationReleaseId, status: 'superseded' },
        { $set: { status: 'active', effectivePeriod: previousPeriod } }
      );
    }
    if (isDuplicateKey(error)) throw new ConfigurationReleaseError('Outra alteração de configuração foi ativada ao mesmo tempo; recarregue e tente de novo.', 409);
    throw error;
  }

  await events.insertOne(ConfigurationChangeEventModel.create({
    releaseId: release.configurationReleaseId,
    changeType: rollbackTargetId ? 'rolled_back' : 'activated',
    actorId,
    impactSummary,
    rollbackOf: undone ? undone.configurationChangeEventId : null,
    occurredAt: now,
  }));
  return release;
}

/**
 * RF014 AC4: records a candidate its ConfigurationValidationRun refused, as
 * a draft that was never active, so the run's releaseId names a release.
 */
async function recordDraft(db, { configurationReleaseId, profileId, settings, now = new Date() }) {
  const { releases } = collections(db);
  const version = (await releases.countDocuments({ profileId, status: { $ne: 'draft' } })) + 1;
  const ordinal = (await releases.countDocuments({ profileId, status: 'draft' })) + 1;
  const draft = ConfigurationReleaseModel.createDraft({ configurationReleaseId, profileId, settings, version, ordinal, now });
  await releases.insertOne(draft);
  return draft;
}

/**
 * The release a rollback may restore: one of this profile's, and not the
 * one already in force. Throws 404 or 409 otherwise.
 */
async function rollbackTarget(db, profileId, configurationReleaseId) {
  const target = configurationReleaseId ? await getRelease(db, configurationReleaseId) : null;
  if (!target || target.profileId !== profileId) {
    throw new ConfigurationReleaseError(`ConfigurationRelease ${configurationReleaseId} não encontrada para este perfil.`, 404);
  }
  if (target.status === 'draft') {
    throw new ConfigurationReleaseError(`ConfigurationRelease ${configurationReleaseId} nunca foi ativada e não pode ser restaurada.`, 409);
  }
  if (target.status === 'active') {
    throw new ConfigurationReleaseError(`ConfigurationRelease ${configurationReleaseId} já está ativa.`, 409);
  }
  return target;
}

module.exports = {
  ConfigurationReleaseError,
  ensureEnvironmentProfile,
  activeRelease,
  getRelease,
  listReleases,
  activationEventOf,
  activate,
  recordDraft,
  rollbackTarget,
};
