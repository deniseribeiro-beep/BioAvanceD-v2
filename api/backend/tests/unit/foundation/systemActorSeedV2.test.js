import { describe, it, expect, vi } from 'vitest';
const { BIOAVANCED_SYSTEM_ACTOR_ID, ensureSystemActor, assertActorReference } = require('../../../src/foundation/systemActorSeedV2');

function makeDb() {
  const docs = [];
  const actors = {
    updateOne: vi.fn(async (filter, update) => {
      if (!docs.some((doc) => doc.actorId === filter.actorId)) docs.push(update.$setOnInsert);
    }),
    findOne: vi.fn(async ({ actorId }) => docs.find((doc) => doc.actorId === actorId) || null),
  };
  return { docs, actors, db: { collection: vi.fn(() => actors) } };
}

describe('Foundation system Actor seed', () => {
  it('persists one stable service Actor across repeated runs', async () => {
    const { docs, actors, db } = makeDb();
    await ensureSystemActor(db);
    await ensureSystemActor(db);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      actorId: BIOAVANCED_SYSTEM_ACTOR_ID,
      actorType: 'service',
      displayName: 'BioAvanceD System',
      actorStatus: 'active',
    });
    expect(actors.updateOne).toHaveBeenCalledWith(
      { actorId: BIOAVANCED_SYSTEM_ACTOR_ID },
      expect.objectContaining({ $setOnInsert: expect.any(Object) }),
      { upsert: true },
    );
  });

  it('rejects a string system alias and unresolved Actor references', async () => {
    const { db } = makeDb();
    await expect(assertActorReference(db, 'system')).rejects.toThrow(/actorId UUID/);
    await expect(assertActorReference(db, BIOAVANCED_SYSTEM_ACTOR_ID)).rejects.toThrow(/não resolvida/);
    await ensureSystemActor(db);
    await expect(assertActorReference(db, BIOAVANCED_SYSTEM_ACTOR_ID)).resolves.toBe(BIOAVANCED_SYSTEM_ACTOR_ID);
  });
});
