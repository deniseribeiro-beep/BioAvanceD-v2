/**
 * RF029 AC 6 ("Encaminhar registros inválidos para staging ou quarentena,
 * sem correção silenciosa", #669). This repo already has two per-record/
 * per-job staging shapes — reference-imports' ReferenceImportIssue+
 * referenceImportStaging (RF028) and the FHIR-import StagingImport
 * (mongoose, job/row-oriented: jobId/fileName/totalRows/rawData). Neither
 * fits RF029's need directly: ReferenceImportIssue's schema is reference-
 * import-run vocabulary (referenceImportRunId/referenceDatasetReleaseId are
 * required), and StagingImport models a *batch file job*, not a single
 * real-time record rejection. Decision: keep both of those unchanged for
 * their own domains, and model this new per-record ingestion quarantine on
 * ReferenceImportIssue's *shape* (plain collection, resolution lifecycle,
 * "never overwrite an existing resolution") without reusing its schema —
 * see models/IngestionQuarantineRecord.js. Every future entity slice
 * (#670-673) quarantines through this module, not a new one of its own.
 */
const IngestionQuarantineRecordModel = require('../models/IngestionQuarantineRecord');
const QUARANTINE_COLLECTION = 'ingestionQuarantineRecords';

const { RESOLUTION_STATUSES } = IngestionQuarantineRecordModel;
const TERMINAL_STATUSES = RESOLUTION_STATUSES.filter((status) => status !== 'open');

/** Persists a rejected record with the violations that caused the rejection — never corrects or drops it silently. */
async function quarantineRecord(db, data = {}) {
  const record = IngestionQuarantineRecordModel.create(data);
  const { isValid, errors } = IngestionQuarantineRecordModel.validate(record);
  if (!isValid) {
    throw new Error(`IngestionQuarantineRecord inválido: ${errors.join('; ')}`);
  }

  const collection = db.collection(QUARANTINE_COLLECTION);
  await collection.insertOne(record);
  return record;
}

/**
 * Transitions a quarantined record (`resolutionStatus: 'open'`) to a
 * terminal resolution, recording who/when/why. Never overwrites an existing
 * resolution — same "resolve once per issue" discipline
 * reference-imports/quarantine.js's resolveImportIssue already established.
 */
async function resolveQuarantineRecord({ db, ingestionQuarantineRecordId, resolutionStatus, resolvedBy, resolutionNotes = null, resolvedAt = new Date() }) {
  if (!ingestionQuarantineRecordId) {
    throw new Error('ingestionQuarantineRecordId é obrigatório');
  }
  if (!TERMINAL_STATUSES.includes(resolutionStatus)) {
    throw new Error(`resolutionStatus deve ser um de: ${TERMINAL_STATUSES.join('|')}`);
  }
  if (!resolvedBy) {
    throw new Error('resolvedBy é obrigatório');
  }

  const records = db.collection(QUARANTINE_COLLECTION);
  const existing = await records.findOne({ ingestionQuarantineRecordId });
  if (!existing) {
    throw new Error(`IngestionQuarantineRecord não encontrado: ${ingestionQuarantineRecordId}`);
  }
  if (existing.resolutionStatus !== 'open') {
    throw new Error(`IngestionQuarantineRecord ${ingestionQuarantineRecordId} já foi resolvido (resolutionStatus=${existing.resolutionStatus})`);
  }

  await records.updateOne(
    { ingestionQuarantineRecordId },
    { $set: { resolutionStatus, resolvedAt, resolvedBy, resolutionNotes } },
  );

  return { ...existing, resolutionStatus, resolvedAt, resolvedBy, resolutionNotes };
}

module.exports = {
  quarantineRecord,
  resolveQuarantineRecord,
};
