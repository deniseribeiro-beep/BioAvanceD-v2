/**
 * RF029 AC 5 ("Suportar ingestão idempotente e rastreável...", #669): no
 * idempotency-key mechanism exists today outside the reference-import
 * pipeline (reference-imports/pipeline.js's own `idempotencyKey`+
 * `importMode` findOne against referenceImportRuns) — per-entity routes
 * (patients, samples, e-consent, assays, datasets) have none. This
 * generalizes that same "claim once, replay after" shape into its own
 * collection (ingestionIdempotencyKeys) and a two-function contract any
 * entity slice can call, keyed by an idempotencyKey plus a `scope` (the
 * entity type string) so the same key value can't collide across unrelated
 * entity kinds.
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');

/**
 * Atomically claims (idempotencyKey, scope) via an upsert — the
 * `$setOnInsert`+`upsert:true` shape avoids the TOCTOU gap a separate
 * find-then-insert pair would have under concurrent identical requests.
 * `result.upsertedCount` (not just checking `existing` afterward) is what
 * tells this call apart from a losing concurrent racer, which is why a
 * hand-rolled collection mock must replicate this.
 *
 * Returns `{ idempotent: false }` when this call won the claim (caller
 * should proceed and eventually call recordIdempotentResult), or
 * `{ idempotent: true, existing }` when a prior claim already exists
 * (caller should short-circuit and reuse `existing.resultRef`).
 */
async function claimIdempotencyKey(db, { idempotencyKey, scope }) {
  if (!idempotencyKey || !scope) {
    throw new Error('claimIdempotencyKey: idempotencyKey e scope são obrigatórios');
  }

  const keys = db.collection(CANONICAL_COLLECTIONS.ingestionIdempotencyKeys);
  const now = new Date();
  const result = await keys.updateOne(
    { idempotencyKey, scope },
    {
      $setOnInsert: {
        idempotencyKey,
        scope,
        status: 'claimed',
        resultRef: null,
        claimedAt: now,
        completedAt: null,
      },
    },
    { upsert: true },
  );

  if (result.upsertedCount) {
    return { idempotent: false, existing: null };
  }

  const existing = await keys.findOne({ idempotencyKey, scope });
  return { idempotent: true, existing };
}

/** Marks a claimed key completed, recording a reference to what it produced (an entity id, a quarantine record id, etc.) so a replay can report the same outcome. */
async function recordIdempotentResult(db, { idempotencyKey, scope, resultRef = null }) {
  if (!idempotencyKey || !scope) {
    throw new Error('recordIdempotentResult: idempotencyKey e scope são obrigatórios');
  }

  const keys = db.collection(CANONICAL_COLLECTIONS.ingestionIdempotencyKeys);
  await keys.updateOne(
    { idempotencyKey, scope },
    { $set: { status: 'completed', resultRef, completedAt: new Date() } },
  );
}

/**
 * RF009 AC7 (#1317): the resultRef of a completed (idempotencyKey, scope), or
 * null. For a caller that records a key only once its result exists, so a
 * failed attempt leaves no claim behind and its retry runs in full.
 */
async function findCompletedIdempotentResult(db, { idempotencyKey, scope }) {
  if (!idempotencyKey || !scope) {
    throw new Error('findCompletedIdempotentResult: idempotencyKey e scope são obrigatórios');
  }

  const keys = db.collection(CANONICAL_COLLECTIONS.ingestionIdempotencyKeys);
  const existing = await keys.findOne({ idempotencyKey, scope, status: 'completed' });
  return existing ? existing.resultRef : null;
}

/** Records (idempotencyKey, scope) completed with its resultRef in one upsert; the first record wins and is never overwritten. */
async function recordCompletedIdempotentResult(db, { idempotencyKey, scope, resultRef = null }) {
  if (!idempotencyKey || !scope) {
    throw new Error('recordCompletedIdempotentResult: idempotencyKey e scope são obrigatórios');
  }

  const keys = db.collection(CANONICAL_COLLECTIONS.ingestionIdempotencyKeys);
  const now = new Date();
  await keys.updateOne(
    { idempotencyKey, scope },
    {
      $setOnInsert: {
        idempotencyKey,
        scope,
        status: 'completed',
        resultRef,
        claimedAt: now,
        completedAt: now,
      },
    },
    { upsert: true },
  );
}

module.exports = {
  claimIdempotencyKey,
  recordIdempotentResult,
  findCompletedIdempotentResult,
  recordCompletedIdempotentResult,
};
