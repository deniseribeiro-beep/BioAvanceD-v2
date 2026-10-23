const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { getCollection } = require('../utils/collectionResolver');
const DiagnosticReportModel = require('../models/DiagnosticReport');
const { assertReferencesExist } = require('../ingestion/canonicalGateway');

const TYPED_PREFIX = 'DiagnosticReport/';

/**
 * Persists one DiagnosticReport (dict-02 P1X-0168..0174, #695) referenced
 * by participantId. Each `resultIds` entry must resolve to a real
 * ClinicalObservation, the same hard check #691 gave specimenId/deviceId.
 * participantId and encounterId stay unenforced, as no service in this
 * domain checks either (docs/decisions/2026-10-23-diagnostic-report-
 * entity.md).
 */
async function createDiagnosticReport(db, data) {
  // Both refusals are 422 with a `details` list (RNF018, #1299), so the
  // route answers them as validation errors rather than 500.
  let report;
  try {
    report = DiagnosticReportModel.create(data);
  } catch (error) {
    error.statusCode = 422;
    error.details = error.message.split(', ');
    throw error;
  }

  const referenceCheck = await assertReferencesExist(
    db,
    report.resultIds.map((value, index) => ({
      collection: CANONICAL_COLLECTIONS.clinicalObservations,
      field: 'observationId',
      value,
      label: `resultIds[${index}]`,
    }))
  );
  if (!referenceCheck.valid) {
    const error = new Error(referenceCheck.violations.map((v) => v.message).join(', '));
    error.statusCode = 422;
    error.details = referenceCheck.violations.map((v) => v.message);
    throw error;
  }

  const collection = await getCollection(db, 'diagnosticReports');
  await collection.insertOne(report);
  return report;
}

/** All diagnostic reports for a participant. */
async function getDiagnosticReportsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'diagnosticReports');
  return collection.find({ participantId: String(participantId) }).toArray();
}

/** One diagnostic report by its own diagnosticReportId (not Mongo's _id). */
async function getDiagnosticReportById(db, diagnosticReportId) {
  if (!diagnosticReportId) return null;
  const collection = await getCollection(db, 'diagnosticReports');
  return collection.findOne({ diagnosticReportId: String(diagnosticReportId) });
}

/**
 * Builds the `assertReferencesExist` entries for references to a
 * DiagnosticReport (#695). `values` is one value (labelled `label`) or an
 * array (each labelled `label[i]`). A value that, trimmed, begins with
 * exactly `DiagnosticReport/` resolves to the id after the prefix. Any other value
 * is the id itself, unless `typedOnly` is set: the evidence arrays
 * (ELM-0209, ELM-0218) also admit criteria, professionals, images and notes,
 * so there only a typed entry is a report reference. An id that comes out
 * empty is returned in `malformed`, since assertReferencesExist skips ''.
 */
function diagnosticReportReferenceChecks(values, label, { typedOnly = false } = {}) {
  const references = [];
  const malformed = [];
  const isArray = Array.isArray(values);
  const list = isArray ? values : [values];

  list.forEach((value, index) => {
    if (value === undefined || value === null) return;
    const entryLabel = isArray ? `${label}[${index}]` : label;
    const raw = String(value);
    // The prefix is tested on the trimmed value, so a typed entry with
    // surrounding whitespace is still checked rather than passed as untyped.
    const trimmed = raw.trim();

    let id;
    if (trimmed.startsWith(TYPED_PREFIX)) {
      id = trimmed.slice(TYPED_PREFIX.length).trim();
    } else if (typedOnly) {
      return;
    } else {
      id = trimmed;
    }

    if (!id) {
      malformed.push(`Referência malformada: ${entryLabel}="${raw}"`);
      return;
    }
    references.push({
      collection: CANONICAL_COLLECTIONS.diagnosticReports,
      field: 'diagnosticReportId',
      value: id,
      label: entryLabel,
    });
  });

  return { references, malformed };
}

module.exports = {
  createDiagnosticReport,
  getDiagnosticReportsForParticipant,
  getDiagnosticReportById,
  diagnosticReportReferenceChecks,
};
