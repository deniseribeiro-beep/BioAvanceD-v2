// RNF018 AC5, RF018 AC7 (#1524): the rule the resolver applies and the
// governance rule set checksums, for the traceability (V2E-0528),
// monitoring (V2E-0529) and documentation (V2E-0530) evidence references a
// certification request presents. It requires nothing, so the certification
// service can read it without loading the resolver's database helpers (see
// docs/decisions/2026-11-12-rcs-governance-evidence-rule-set.md).

const EVIDENCE_HASH = /^sha256:[0-9a-f]{64}$/;
const EVIDENCE_URI = /^urn:bioavanced:([a-z-]+):([A-Za-z0-9._-]+)$/;
const MAX_REFERENCES_PER_CATEGORY = 20;

const RESOLUTION_STATUSES = Object.freeze({
  RESOLVED: 'resolved',
  MISSING_HASH: 'missing_hash',
  UNRESOLVABLE_URI: 'unresolvable_uri',
  HASH_MISMATCH: 'hash_mismatch',
});

// The one URI kind each category accepts.
const EVIDENCE_KINDS = Object.freeze({
  traceability: 'custody-event',
  monitoring: 'telemetry-exposure-summary',
  documentation: 'collection-governance-approval',
});

const EVIDENCE_CATEGORY_KEYS = Object.freeze(Object.keys(EVIDENCE_KINDS));

module.exports = {
  EVIDENCE_HASH,
  EVIDENCE_URI,
  MAX_REFERENCES_PER_CATEGORY,
  RESOLUTION_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_CATEGORY_KEYS,
};
