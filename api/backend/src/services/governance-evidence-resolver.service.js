const { getCollection } = require('../utils/collectionResolver');
const { COLLECTION_NAME: OUTBOX_COLLECTION_NAME } = require('./neo4jOutbox.service');

// RNF018 AC5, RF018 AC7 (#1524): resolves the traceability (V2E-0528),
// monitoring (V2E-0529) and documentation (V2E-0530) evidence references a
// certification request presents against the stored records, before
// certify() runs. The result is frozen in the RCS input
// (governanceEvidenceResolution), so a recalculation reproduces it; a
// client never sends it (see
// docs/decisions/2026-11-09-rcs-governance-evidence-readers.md). A custody
// event or telemetry summary resolves only for the specimen named, and a
// documentation reference, an SOP's included, only to a governance approval
// of the collection named (see
// docs/decisions/2026-11-12-rcs-sop-documentation-evidence.md).

const {
  EVIDENCE_HASH,
  EVIDENCE_URI,
  MAX_REFERENCES_PER_CATEGORY,
  RESOLUTION_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_SCOPES,
  EVIDENCE_CATEGORY_KEYS,
} = require('./governance-evidence-rule');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

// A bare or sha256:-prefixed SHA-256 hex, as sha256: plus lower-case hex.
function normalizeChecksum(value) {
  const match = /^(?:sha256:)?([0-9a-fA-F]{64})$/i.exec(typeof value === 'string' ? value.trim() : '');
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

async function findCustodyEvent(db, context, id) {
  const sample = await context.sample();
  if (!sample) return null;
  const event = await db.collection(OUTBOX_COLLECTION_NAME).findOne({
    eventId: id,
    eventType: 'CUSTODY_EVENT_RECORDED',
    aggregateType: 'Sample',
    aggregateId: String(sample._id),
  });
  return event ? { hash: typeof event.payloadHash === 'string' ? `sha256:${event.payloadHash}` : null } : null;
}

async function findTelemetrySummary(db, context, id) {
  if (!context.specimenId) return null;
  const summary = await (await getCollection(db, 'telemetryExposureSummaries'))
    .findOne({ telemetryExposureSummaryId: id, specimenId: context.specimenId });
  return summary ? { hash: stringOrNull(summary.sourceReadingSetHash) } : null;
}

async function findGovernanceApproval(db, context, id) {
  const approval = await (await getCollection(db, 'collectionGovernanceApprovals')).findOne({ approvalId: id });
  if (!approval || !context.collectionId || approval.collectionId !== context.collectionId) return null;
  return { hash: normalizeChecksum(approval.documentChecksum) };
}

const FINDERS = Object.freeze({
  'custody-event': findCustodyEvent,
  'telemetry-exposure-summary': findTelemetrySummary,
  'collection-governance-approval': findGovernanceApproval,
});

async function resolveReference(db, context, category, reference) {
  if (!isPlainObject(reference)) {
    return { uri: null, hash: null, status: RESOLUTION_STATUSES.UNRESOLVABLE_URI };
  }
  const uri = stringOrNull(reference.uri);
  const hash = stringOrNull(reference.hash);
  const entry = (status) => ({ uri, hash, status });
  if (!hash || !EVIDENCE_HASH.test(hash)) return entry(RESOLUTION_STATUSES.MISSING_HASH);
  const match = uri ? EVIDENCE_URI.exec(uri) : null;
  if (!match || match[1] !== EVIDENCE_KINDS[category]) return entry(RESOLUTION_STATUSES.UNRESOLVABLE_URI);
  const record = await FINDERS[match[1]](db, context, match[2]);
  if (!record) return entry(RESOLUTION_STATUSES.UNRESOLVABLE_URI);
  if (record.hash !== hash) return entry(RESOLUTION_STATUSES.HASH_MISMATCH);
  return entry(RESOLUTION_STATUSES.RESOLVED);
}

// { traceability?, monitoring?, documentation? } of [{ uri, hash, status }],
// only for the categories presented as a non-empty array (or as a value
// that is not an array, which fails closed); null when none was presented.
// collectionId names the specimen's collection: a documentation reference
// resolves only to an approval of it, and with no collectionId it reads
// unresolvable_uri.
async function resolveGovernanceEvidence(db, { governanceEvidence, specimenId, collectionId } = {}) {
  if (!isPlainObject(governanceEvidence)) return null;
  const presented = EVIDENCE_CATEGORY_KEYS.filter((category) => {
    const value = governanceEvidence[category];
    if (value === undefined) return false;
    return !(Array.isArray(value) && value.length === 0);
  });
  if (!presented.length) return null;

  const specimen = typeof specimenId === 'string' && specimenId.trim() !== '' ? specimenId : null;
  let samplePromise = null;
  const context = {
    specimenId: specimen,
    collectionId: typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId : null,
    // The sample, looked up once per call and only when a reference needs it.
    sample() {
      if (!samplePromise) {
        samplePromise = specimen
          ? Promise.resolve(getCollection(db, 'samples')).then((samples) => samples.findOne({ specimenId: specimen }))
          : Promise.resolve(null);
      }
      return samplePromise;
    },
  };

  const resolution = {};
  for (const category of presented) {
    const references = governanceEvidence[category];
    if (!Array.isArray(references) || references.length > MAX_REFERENCES_PER_CATEGORY) {
      resolution[category] = [{ uri: null, hash: null, status: RESOLUTION_STATUSES.UNRESOLVABLE_URI }];
      continue;
    }
    const entries = [];
    for (const reference of references) {
      entries.push(await resolveReference(db, context, category, reference));
    }
    resolution[category] = entries;
  }
  return resolution;
}

module.exports = {
  resolveGovernanceEvidence,
  normalizeChecksum,
  EVIDENCE_HASH,
  EVIDENCE_URI,
  EVIDENCE_KINDS,
  EVIDENCE_SCOPES,
  EVIDENCE_CATEGORY_KEYS,
  MAX_REFERENCES_PER_CATEGORY,
  RESOLUTION_STATUSES,
};
