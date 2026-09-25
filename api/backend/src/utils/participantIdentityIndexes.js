const logger = require('./logger');

/**
 * #1102: indexes for `participantIdentities`, which had none of any kind.
 *
 * The collection is absent from the foundation pipeline index list (historical
 * `create-db.js` is retired — #1055) and has no model file -- it is reached
 * through the raw driver via
 * `getCollection(db, 'participantIdentities')` -- so unlike #936/#941 there
 * was not even an inert `Schema.index(...)` declaration to build. Every
 * query against it is a collection scan today.
 *
 * ## Why a native `createIndex`, wired at the resolver
 *
 * The same reason `utils/sampleIndexes.js` gives, which this copies:
 * `infrastructure/database/mongodb/connection.js:26` connects with
 * `autoIndex: false` and nothing in `api/` calls `syncIndexes()` or
 * `createIndexes()`, so a schema-level declaration never reaches Mongo. It is
 * latched in `collectionResolver.js` rather than here (the shape
 * `utils/storageIndexes.js` uses) because this collection *does* pass through
 * that resolver, on all three query sites and on the write path -- which is
 * exactly what `samples` does.
 *
 * ## The three fields
 *
 * - `identityDocumentHash` and `birthDateHash` are the blind-index siblings
 *   #574 added so the identity-matching sites could stop querying plaintext.
 *   A deterministic blind index whose entire purpose is to be queryable, and
 *   which is not indexed, is only half the construct.
 * - `participantId` is what every *other* reader of this collection matches
 *   on -- `eConsent.js:131`, `consent.service.js:552`, `patient.service.js:588`,
 *   `intakeWizard.js:1008` and `getIdentityByParticipantId`.
 *
 * ## What this buys today, stated plainly
 *
 * `participantId` is an immediate win: those are bare `findOne({ participantId })`
 * lookups and they scan the collection today.
 *
 * `birth_date_hash` IS now an immediate win too, as of #1104: birthDate is
 * ciphertext-only, its plaintext arm has been removed from all four matching
 * sites, and those queries are now a single indexed condition.
 *
 * `identity_document_hash` is **not** yet, and it would be wrong to imply
 * otherwise. identityDocument is still dual-written, so its matching sites
 * query `{ $or: [{ identityDocumentHash: { $in: [...] } }, { <plaintext arm> }] }`,
 * and Mongo can only serve an `$or` from indexes when EVERY arm is indexed.
 * Until that plaintext column is dropped (#1104) that union still scans.
 *
 * The plaintext arms are deliberately left unindexed rather than indexed to
 * close that gap: they are the columns being removed, so indexing them buys
 * write amplification on a field with a scheduled deletion date. This is the
 * cost half of the sequencing argument #1099 makes about correctness -- the
 * index has to exist *before* the plaintext arm goes, or the day it goes is
 * the day every import-path dedup becomes an unindexed scan per row.
 *
 * #1102 originally cited "#574/#1072" for that removal. Both are CLOSED and
 * #1072 is about mfaSecret, not identity -- #574 shipped only its own
 * precondition (repointing consumers) and closed, leaving the drop its title
 * describes untracked. #1104 is the issue that actually carries it.
 *
 * ## Why non-unique, and why no partial filter
 *
 * Non-unique: whether `participantId` should additionally be UNIQUE is
 * #971/#941's question about the dedup race, not this one's. This is only
 * about the fields being indexed at all, and a unique index here would
 * change failure behaviour rather than just query cost.
 *
 * No `partialFilterExpression`: the unique precedents (`samples.barcode`,
 * `storageContainers.containerID`) need one to stop barcodeless rows
 * colliding with each other. There is no collision to avoid on a non-unique
 * index, so a filter would only trade a little index size for the risk that
 * the planner declines to use it -- which would leave exactly the collection
 * scans this exists to remove.
 *
 * ## Failure posture
 *
 * Best-effort and logged, like the two precedents: a failed index build must
 * not take identity reads down. There is no E11000 case here (nothing is
 * unique), so the failure that matters is the quiet one -- the build not
 * happening at all, leaving every query a scan. A silent catch would make
 * that invisible, which is the whole defect this closes.
 *
 * One catch PER index, not one around the batch: the historical
 * `create-db.js` (#1027 / #1055) recorded that lesson after a single failure
 * took the rest of a
 * build down with it. `Promise.all` over per-index `try`/`catch` gives that
 * and one other thing the resolver depends on -- every `createIndex` is
 * ISSUED synchronously, before the first `await` yields. The resolver calls
 * this un-awaited, so a sequential `for await` loop would leave indexes two
 * and three unissued if nothing ever drove the microtask queue.
 */
const PARTICIPANT_IDENTITY_INDEXES = [
  [{ identityDocumentHash: 1 }, { name: 'participant_identities_identity_document_hash_idx_v1' }],
  [{ birthDateHash: 1 }, { name: 'participant_identities_birth_date_hash_idx_v1' }],
  [{ participantId: 1 }, { name: 'participant_identities_participant_id_idx_v1' }]
];

async function ensureParticipantIdentityIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  await Promise.all(PARTICIPANT_IDENTITY_INDEXES.map(async ([keys, options]) => {
    try {
      await collection.createIndex(keys, options);
    } catch (error) {
      logger.warn(
        `[PARTICIPANT_IDENTITY][INDEX] Não foi possível criar ${options.name} (#1102). `
          + 'As consultas de identidade seguem como varredura de coleção até que seja criado: '
          + (error?.message || error)
      );
    }
  }));
}

module.exports = { ensureParticipantIdentityIndexes, PARTICIPANT_IDENTITY_INDEXES };
