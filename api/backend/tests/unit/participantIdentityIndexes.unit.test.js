/**
 * #1102: the blind indexes #574 added are not INDEXED.
 *
 * `identityDocumentHash`/`birthDateHash` exist so the three identity-matching
 * sites can stop querying plaintext, and `participantIdentities` carries no
 * declared index of any kind -- it is absent from `scripts/create-db.js`, it
 * has no model file (it is reached through the raw driver via
 * `getCollection(db, 'participantIdentities')`), and nothing anywhere calls
 * `createIndex` on it. A deterministic blind index whose entire purpose is to
 * be queryable, and which is not indexed, is not yet doing the job it was
 * built for.
 *
 * The wiring is as much the subject as the indexes, exactly as in
 * `sampleIndexes.unit.test.js` (#936) -- which is the precedent this copies,
 * for the same reason it gives: `autoIndex: false` plus no `syncIndexes()`
 * call anywhere means a schema-level declaration would be a no-op that reads
 * as a fix. There is not even a schema here to declare it in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function makeCollection(createIndexImpl) {
  return { createIndex: vi.fn(createIndexImpl || (async () => 'ok')) };
}

const { ensureParticipantIdentityIndexes } = require('../../src/utils/participantIdentityIndexes');
const logger = require('../../src/utils/logger');

describe('#1102 ensureParticipantIdentityIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates exactly the two blind-index siblings plus participantId', async () => {
    const collection = makeCollection();

    await ensureParticipantIdentityIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
    const byName = Object.fromEntries(
      collection.createIndex.mock.calls.map(([keys, options]) => [options.name, keys])
    );
    expect(byName).toEqual({
      participant_identities_identity_document_hash_idx_v1: { identityDocumentHash: 1 },
      participant_identities_birth_date_hash_idx_v1: { birthDateHash: 1 },
      participant_identities_participant_id_idx_v1: { participantId: 1 }
    });
  });

  // The shape is the design decision, so it is pinned by value rather than
  // by "is an index". Unique is #971/#941 question about the dedup race, not
  // this one -- a unique index here would change failure behaviour and not
  // just query cost. And unlike the unique precedents (samples.barcode,
  // storageContainers.containerID) there is no collision for a partial
  // filter to avoid, so one would only risk the planner declining the index
  // and leaving the very scans this removes.
  it('creates them NON-unique and with no partial filter', async () => {
    const collection = makeCollection();

    await ensureParticipantIdentityIndexes(collection);

    for (const [, options] of collection.createIndex.mock.calls) {
      expect(options.unique).toBeUndefined();
      expect(options.sparse).toBeUndefined();
      expect(options.partialFilterExpression).toBeUndefined();
    }
  });

  // The resolver calls this UN-AWAITED, so every createIndex has to be
  // issued before the first await yields. A sequential loop leaves indexes
  // two and three unissued if nothing drives the microtask queue -- which is
  // what the first version of this helper did, and what the wiring case
  // below caught (1 call instead of 3).
  it('issues every createIndex synchronously, before the first await yields', () => {
    const collection = makeCollection();

    ensureParticipantIdentityIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
  });

  // One catch PER index, per create-db.js:99 (#1027): a single failure must
  // not take the rest of the build down with it. There is no E11000 case
  // here since nothing is unique, so the failure that matters is the quiet
  // one -- the build not happening, leaving the query a scan.
  it('logs a failed index, does not throw, and still creates the others', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection(async (keys) => {
      if (keys.birthDateHash) throw new Error("connection timed out");
      return 'ok';
    });

    await expect(ensureParticipantIdentityIndexes(collection)).resolves.toBeUndefined();

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('participant_identities_birth_date_hash_idx_v1');
    expect(warn.mock.calls[0][0]).toContain('#1102');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    await expect(ensureParticipantIdentityIndexes(null)).resolves.toBeUndefined();
    await expect(ensureParticipantIdentityIndexes({})).resolves.toBeUndefined();
  });
});

describe('#1102 collectionResolver wiring', () => {
  const resolverPath = require.resolve('../../src/utils/collectionResolver');

  function freshResolver() {
    delete require.cache[resolverPath];
    return require(resolverPath);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Stage 2E: getCollection resolves participantIdentities but does not auto-ensure
  // indexes (ensureParticipantIdentityIndexes is an explicit helper). Callers that
  // need indexes must invoke the helper themselves.
  it('resolves participantIdentities without auto-creating indexes', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    getCollection(db, 'participantIdentities');
    getCollection(db, 'participantIdentities');
    getCollection(db, 'participantIdentities');

    expect(db.collection).toHaveBeenCalledWith('participantIdentities');
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  // CONTROL (#695): same expectation before and after the fix, so a red here
  // is the setup rather than the bug. `import.service.js:319` and
  // `import-lgpd.service.js:847` both do `const c = getCollection(db,
  // 'participantIdentities')` with NO await and then call `c.findOne(...)`,
  // so returning a thenable would break them outright -- the same reason
  // `samples` stays synchronous (#306, #936).
  it('still returns the participantIdentities collection synchronously, not a promise', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    const resolved = getCollection(db, 'participantIdentities');

    expect(resolved).toBe(collection);
    expect(typeof resolved.then).not.toBe('function');
  });

  // CONTROL (#695): unchanged by this fix in either direction.
  it('does not build the participantIdentities indexes when some other collection is resolved', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    getCollection(db, 'consents');

    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});
