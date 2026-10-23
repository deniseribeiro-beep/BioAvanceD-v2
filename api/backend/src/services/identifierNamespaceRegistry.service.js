const IdentifierNamespaceRegistryModel = require('../models/IdentifierNamespaceRegistry');
const logger = require('../utils/logger');

// RF011 AC3, RNF024 C2, RULE-036 (#1322): the stored IdentifierNamespaceRegistry
// rows (/api/identifier-namespaces) and the registry the FHIR validator's
// identifier.system check reads at import validation.
const COLLECTION = 'identifierNamespaceRegistries';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// The base registry plus every stored namespace row. No filtering here: the
// validator's buildConformanceSets re-runs IdentifierNamespaceRegistry.create
// on each row and keeps a systemUri only while its [start, end) holds now, so
// a refused or expired row stays ignored. Fails closed: without a readable
// store the base answers, and the empty base refuses every system.
async function loadConformanceRegistry(db, { base = require('../resources/fhir/conformance-registry') } = {}) {
  if (!db || typeof db.collection !== 'function') return base;
  let rows;
  try {
    rows = await db.collection(COLLECTION).find({}).toArray();
  } catch (error) {
    logger.warn('IdentifierNamespaceRegistry indisponível; validação FHIR usa o registro base:', error.message);
    return base;
  }
  if (!Array.isArray(rows)) return base;
  return {
    profiles: base.profiles,
    namespaces: [...base.namespaces, ...rows],
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
