/**
 * Migration: specimenStatus from the v1.3.0 set to the v2 set (ELM-0123 ->
 * V2E-0544, RF006 AC2/AC3, RF026 AC7).
 *
 * v1.3.0 mixed operational state, quantity and disposition in one field.
 * v2 keeps the operational state in specimenStatus (available, reserved,
 * checked_out, quarantined, unavailable, closed) and derives quantity into
 * quantityStatus (full, partial, depleted). Per document:
 *
 * - available, reserved, checked_out, quarantined, unavailable: unchanged.
 * - partial, depleted -> available; quantityStatus carries the quantity.
 * - destroyed, disposed -> closed when an executed destroy or transfer
 *   DispositionAction names the specimen (RF026 AC7: closed only after an
 *   authorised, executed disposition); otherwise -> unavailable, and the
 *   specimen is listed in the summary as needing disposition evidence. An
 *   action stored before actionStatus existed counts as executed, as
 *   dispositionAction.service.js reads it.
 * - every converted document keeps its original value in
 *   legacySpecimenStatus, with specimenStatusMigratedAt (V2E-0544: preserve
 *   original provenance), and appends one OperationalStateDecision
 *   (rulesApplied v1_3_to_v2_migration; the trigger is the closing
 *   DispositionAction when there is one).
 * - every document gets quantityStatus derived from initialQuantity and
 *   currentQuantity (dictionary RULE-003..005).
 *
 * Idempotent: a converted document no longer holds a v1.3.0 value, and a
 * quantityStatus already equal to the derived one is not rewritten, so a
 * second run changes nothing. Specimens converted to unavailable for want of
 * evidence stay in the summary's needsDispositionEvidence on every run until
 * a disposition for them is executed (which closes them itself).
 *
 * One-way: no rollback. legacySpecimenStatus keeps each converted
 * document's v1.3.0 value, but the v2 code accepts no v1.3.0 value on write
 * (models/Sample.js), the OperationalStateDecision each conversion appended
 * is append-only history (operationalStateDecision.service.js has no update
 * or delete), the quantityStatus it derived keeps no earlier value, and a
 * specimen's status may have changed since. Undo it by restoring samples and
 * operationalStateDecisions from a backup taken before the run.
 *
 * Usage (from api/backend):
 *   npm run migrate:specimen-status-v2               applies
 *   npm run migrate:specimen-status-v2 -- --dry-run  counts, writes nothing
 */

const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const { SampleModel, LEGACY_SPECIMEN_STATUS_VALUES } = require('../models/Sample');
const operationalStateDecisionService = require('../services/operationalStateDecision.service');

const MIGRATION_RULE = 'v1_3_to_v2_migration';
const DISPOSAL_VALUES = ['destroyed', 'disposed'];
const SPECIMEN_ENTITY_TYPES = ['Specimen', 'Sample'];
const CLOSING_ACTIONS = ['destroy', 'transfer'];

function isExecutedClosingAction(action) {
  return SPECIMEN_ENTITY_TYPES.includes(action?.entityType)
    && CLOSING_ACTIONS.includes(action?.dispositionAction)
    && (action.actionStatus === undefined || action.actionStatus === null || action.actionStatus === 'executed');
}

// recordId -> the executed closing action naming it.
async function executedClosingActionsByRecord(db) {
  const actions = await (await getCollection(db, 'dispositionActions')).find({}).toArray();
  const byRecord = new Map();
  for (const action of actions.filter(isExecutedClosingAction)) {
    for (const recordId of action.affectedRecordIds || []) {
      if (!byRecord.has(String(recordId))) byRecord.set(String(recordId), action);
    }
  }
  return byRecord;
}

function closingActionFor(byRecord, doc) {
  return byRecord.get(String(doc.specimenId)) || byRecord.get(String(doc._id)) || null;
}

async function migrateSpecimenStatusV2(db, { dryRun = false, now = new Date() } = {}) {
  const samples = await getCollection(db, 'samples');
  const byRecord = await executedClosingActionsByRecord(db);
  const runId = crypto.randomUUID();
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    converted: Object.fromEntries(LEGACY_SPECIMEN_STATUS_VALUES.map((value) => [value, 0])),
    closed: 0,
    quantityStatusBackfilled: 0,
    decisionsRecorded: 0,
    needsDispositionEvidence: [],
  };

  const docs = await samples.find({}).toArray();
  for (const doc of docs) {
    summary.scanned += 1;
    const specimenId = doc.specimenId || String(doc._id);
    const raw = String(doc.specimenStatus || '').trim().toLowerCase();
    const { initial, current } = SampleModel.quantitiesOf(doc);
    const quantityStatus = SampleModel.computeQuantityStatus(initial, current);

    const set = {};
    if (doc.quantityStatus !== quantityStatus) {
      set.quantityStatus = quantityStatus;
      summary.quantityStatusBackfilled += 1;
    }

    let conversion = null;
    if (LEGACY_SPECIMEN_STATUS_VALUES.includes(raw)) {
      const action = DISPOSAL_VALUES.includes(raw) ? closingActionFor(byRecord, doc) : null;
      const newStatus = DISPOSAL_VALUES.includes(raw) ? (action ? 'closed' : 'unavailable') : 'available';
      conversion = { previousStatus: raw, newStatus, action };
      set.specimenStatus = newStatus;
      set.legacySpecimenStatus = doc.specimenStatus;
      set.specimenStatusMigratedAt = now;
      summary.converted[raw] += 1;
      if (newStatus === 'closed') summary.closed += 1;
    }

    // Converted now or by an earlier run, a destroyed/disposed specimen with
    // no executed disposition is reported every time.
    const legacy = String(doc.legacySpecimenStatus || '').toLowerCase();
    const stillUnevidenced = conversion
      ? conversion.newStatus === 'unavailable' && DISPOSAL_VALUES.includes(raw)
      : DISPOSAL_VALUES.includes(legacy) && raw === 'unavailable';
    if (stillUnevidenced) {
      summary.needsDispositionEvidence.push({ specimenId, legacySpecimenStatus: conversion ? raw : legacy });
    }

    if (Object.keys(set).length === 0 || dryRun) {
      if (conversion && dryRun) summary.decisionsRecorded += 1;
      continue;
    }

    await withTransactionWhereSupported(db, async (session) => {
      const options = session ? { session } : undefined;
      // Conditioned on the value read, so a concurrent change is not
      // overwritten; the next run picks the document up again.
      const filter = conversion ? { _id: doc._id, specimenStatus: doc.specimenStatus } : { _id: doc._id };
      const result = await samples.updateOne(filter, { $set: set }, options);
      if (!result || result.matchedCount === 0 || !conversion) return;
      const decision = await operationalStateDecisionService.recordStatusChange(db, {
        specimenId,
        previousStatus: conversion.previousStatus,
        newStatus: conversion.newStatus,
        triggerEventId: conversion.action ? conversion.action.dispositionActionId : `migration:${MIGRATION_RULE}:${runId}`,
        rulesApplied: [MIGRATION_RULE],
        reasonCodes: [`legacy_${conversion.previousStatus}`],
        occurredAt: now,
      }, { session });
      if (decision) summary.decisionsRecorded += 1;
    });
  }

  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateSpecimenStatusV2(db, { dryRun: argv.includes('--dry-run') });
  console.log('specimenStatus v1.3.0 -> v2:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração specimenStatus v1.3.0 -> v2:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateSpecimenStatusV2, run, MIGRATION_RULE };
