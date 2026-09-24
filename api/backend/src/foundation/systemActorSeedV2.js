const { getCanonicalCollection } = require('../config/canonicalEntityCollections.v2');
const { isUuid } = require('./userAccountIdentityMigrationV2');

// Release seed identity: generated once, then kept stable across Foundation runs.
const BIOAVANCED_SYSTEM_ACTOR_ID = '6671bce9-1cb2-4819-9086-e3db522b783e';

async function ensureSystemActor(db) {
  const actors = getCanonicalCollection(db, 'Actor');
  await actors.updateOne(
    { actorId: BIOAVANCED_SYSTEM_ACTOR_ID },
    { $setOnInsert: {
      actorId: BIOAVANCED_SYSTEM_ACTOR_ID,
      actorType: 'service',
      displayName: 'BioAvanceD System',
      actorStatus: 'active',
      createdAt: new Date(),
    } },
    { upsert: true },
  );
  const actor = await actors.findOne({ actorId: BIOAVANCED_SYSTEM_ACTOR_ID });
  if (actor?.actorType !== 'service' || actor.displayName !== 'BioAvanceD System' || actor.actorStatus !== 'active') {
    throw new Error('Canonical system Actor seed conflict');
  }
  return actor;
}

async function assertActorReference(db, actorId) {
  if (!isUuid(actorId)) throw new Error('Reference(Actor) exige actorId UUID canônico');
  const actor = await getCanonicalCollection(db, 'Actor').findOne({ actorId });
  if (!actor) throw new Error(`Reference(Actor) não resolvida: ${actorId}`);
  return actorId;
}

module.exports = { BIOAVANCED_SYSTEM_ACTOR_ID, ensureSystemActor, assertActorReference };
