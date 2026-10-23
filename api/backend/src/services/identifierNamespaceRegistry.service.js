const IdentifierNamespaceRegistryModel = require('../models/IdentifierNamespaceRegistry');
const { PROFILE_COLLECTION } = require('./interoperabilityMappingRelease.service');
const logger = require('../utils/logger');

// RF011 AC2/AC3, RNF024 C1/C2, RULE-036 (#1322): the stored
// IdentifierNamespaceRegistry rows (/api/identifier-namespaces) and the
// registry the FHIR validator's identifier.system and meta.profile checks
// read at import validation.
const COLLECTION = 'identifierNamespaceRegistries';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// One collection's stored rows, or null when the read throws or answers a
// non-array.
async function readRows(db, collectionName, label) {
  let rows;
  try {
    rows = await db.collection(collectionName).find({}).toArray();
  } catch (error) {
    logger.warn(`${label} indisponível; validação FHIR usa o registro base:`, error.message);
    return null;
  }
  if (!Array.isArray(rows)) {
    logger.warn(`${label} indisponível; validação FHIR usa o registro base: a leitura não retornou uma lista`);
    return null;
  }
  return rows;
}

// The base registry plus every stored namespace row and every stored
// FHIRProfileRegistry row (/api/fhir-profiles, RF011 AC2). No filtering here:
// the validator's buildConformanceSets re-runs IdentifierNamespaceRegistry.create
// on each namespace row and keeps a systemUri only while its [start, end)
// holds now, and keeps a profile row only while FHIRProfileRegistry.validate
// accepts it with status approved or active, so a refused, expired or draft
// row stays ignored. Each part fails closed on its own: a part whose store is
// unreadable keeps the base rows for that part, and the empty base refuses
// every profile and every system.
async function loadConformanceRegistry(db, { base = require('../resources/fhir/conformance-registry') } = {}) {
  if (!db || typeof db.collection !== 'function') return base;
  const namespaces = await readRows(db, COLLECTION, 'IdentifierNamespaceRegistry');
  const profiles = await readRows(db, PROFILE_COLLECTION, 'FHIRProfileRegistry');
  if (!namespaces && !profiles) return base;
  return {
    profiles: profiles ? [...base.profiles, ...profiles] : base.profiles,
    namespaces: namespaces ? [...base.namespaces, ...namespaces] : base.namespaces,
    approvedAuthorities: base.approvedAuthorities,
  };
}

// RULE-036: a new version of a namespaceKey keeps its systemUri. Only a
// payload carrying both keys (the POST) is checked; a PUT carries neither,
// since both are immutable there. A key carried as anything but a non-empty
// string is a 422 before the store is read: the model coerces an array URI
// and accepts a numeric key, which would slip past the comparison.
async function validateNamespaceReferences(db, payload = {}) {
  for (const field of ['namespaceKey', 'systemUri']) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && !isNonEmptyString(payload[field])) {
      const error = new Error(`${field} deve ser um texto não vazio para IdentifierNamespaceRegistry (RULE-036)`);
      error.statusCode = 422;
      throw error;
    }
  }
  if (!isNonEmptyString(payload.namespaceKey) || !isNonEmptyString(payload.systemUri)) return;
  const rows = await db.collection(COLLECTION).find({ namespaceKey: payload.namespaceKey }).toArray();
  for (const row of rows) {
    try {
      IdentifierNamespaceRegistryModel.assertStableUri(row, payload);
    } catch (error) {
      error.statusCode = 409;
      throw error;
    }
  }
}

module.exports = { COLLECTION, loadConformanceRegistry, validateNamespaceReferences };
