const logger = require('./logger');

/**
 * #936 item 1: a unique index on `samples.barcode`.
 *
 * Until now uniqueness was enforced only by application-level checks, and
 * #932 is the demonstration of what that costs: while `generateUniqueBarcode`
 * queried the wrong collection, the database accepted every colliding write
 * without complaint. A unique index turns that class of silent corruption
 * into a loud `E11000` on the first duplicate.
 *
 * ## Why this is a native `createIndex` and not `SampleSchema.index(...)`
 *
 * `Sample.js:35` already declares `barcode: { type: String, index: true }`,
 * and that declaration **never reaches the database**:
 * `infrastructure/database/mongodb/connection.js:26` connects with
 * `autoIndex: false`, and nothing anywhere in `api/` calls `syncIndexes()`
 * or `createIndexes()` on a mongoose model. So every `Schema.index(...)` in
 * `src/models/` is inert, and adding `unique: true` there would have been a
 * no-op that read as a fix. This is the wired equivalent, on the same
 * trigger the sibling collection already uses -- see
 * `sampleMovementLedger.ensureSampleMovementIndexes`, reached through
 * `collectionResolver.getCollection('sampleMovements')`.
 *
 * ## Why `$type: 'string'` rather than `$exists: true`
 *
 * The movements indexes filter on `$exists`, which is right for them. It
 * would be wrong here: `SampleModel.create` writes `barcode: data.barcode ||
 * null` -- an **explicit null**, always present. `$exists` would therefore
 * match every barcodeless sample and they would all collide with each
 * other on the first two rows. `sparse: true` fails the same way and for
 * the same reason (sparse excludes *missing*, not null), which is why the
 * `{ unique: true, sparse: true }` shape used on `StorageBox.boxID` and
 * `StorageContainer.containerID` is not the precedent to copy here.
 * `$type: 'string'` indexes exactly the rows that have a real barcode.
 *
 * ## Failure posture
 *
 * Best-effort, like the movements helper -- a failed index build must not
 * take down sample reads. But it **logs** rather than swallowing: the one
 * failure that matters is `E11000` on an existing duplicate, which per #936
 * would mean a deployment that ran the pre-#932 import path holds colliding
 * `BR-YYYY-NNN` rows and needs a repair migration before the constraint can
 * hold. Per #362/#682 there is no deployment yet, which is what makes now
 * the cheapest possible moment to add this -- but a silent catch would make
 * the day that stops being true invisible.
 */
async function ensureSampleIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  try {
    await collection.createIndex(
      { barcode: 1 },
      {
        name: 'samples_barcode_unique_v1',
        unique: true,
        partialFilterExpression: { barcode: { $type: 'string' } }
      }
    );
  } catch (error) {
    logger.warn(
      '[SAMPLES][INDEX] Não foi possível criar samples_barcode_unique_v1 (#936). '
        + 'Um E11000 aqui significa barcodes duplicados já gravados -- '
        + 'a unicidade segue apenas em nível de aplicação até que sejam corrigidos: '
        + (error?.message || error)
    );
  }
}

module.exports = { ensureSampleIndexes };
