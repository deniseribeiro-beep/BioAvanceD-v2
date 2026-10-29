const { registerLabel } = require('./labelResolver.service');
const { ensureSpecimenContainer } = require('./legacyPlacementChain.service');

// #1378: a specimen's generated code is issued as a LabelIdentifier
// (V2E-0168..0179) on the specimen's one Container, replacing
// Sample.barcode (ELM-0116, deprecated, "Replaced by LabelIdentifier
// records"). The decisions are recorded in
// docs/decisions/2026-10-13-specimen-label-issuance.md.
//
// Every read and write takes the caller's session and builds no index.

// Generated and printed by the biobank: RULE-034 is the maker's case. The
// print job's ZPL is `^BC`, Code 128.
const SPECIMEN_LABEL_ORIGIN = 'institution_applied';
const SPECIMEN_LABEL_SYMBOLOGY = 'code_128';
const SPECIMEN_LABEL_CARRIER_PLACEMENT = 'container_side';
// Fixed local references: no IdentifierNamespaceRegistry or LabelTemplate
// store exists yet.
const SPECIMEN_LABEL_NAMESPACE_ID = 'legacy-sample-barcode';
const SPECIMEN_LABEL_TEMPLATE_VERSION_ID = 'legacy-sample-barcode-label@1.0.0';
const ISSUANCE_EVENT_PREFIX = 'specimen-label-issuance:';

// V2E-0176 is "Actor ou Organization": the acting user, else the sample's
// organization, else the system.
function issuerOf(sample, actorId) {
  return String(actorId || sample?.organizationId || 'system');
}

// Returns { label, containerId }. `code` defaults to the sample's barcode.
// A label issued at create or import is unprinted (`printed: false`) and has
// no print batch (V2E-0178). `provenance`, for a migrated label, is stored
// as its `migratedFrom`.
async function issueSpecimenLabel(db, sample, { code, actorId, at, session, printed = false, provenance } = {}) {
  const encodedValue = String(code ?? sample?.barcode ?? '');
  if (!encodedValue.trim()) throw new Error('Código da etiqueta é obrigatório para emitir o LabelIdentifier do espécime');
  const issuedAt = at ? new Date(at) : new Date();

  const loaded = await ensureSpecimenContainer(db, sample, {
    at: issuedAt,
    sourceEventId: `${ISSUANCE_EVENT_PREFIX}${String(sample._id)}:${issuedAt.toISOString()}`,
  }, session);

  const label = await registerLabel(db, {
    encodedValue,
    symbology: SPECIMEN_LABEL_SYMBOLOGY,
    targetType: 'container',
    targetId: loaded.containerId,
    identifierOrigin: SPECIMEN_LABEL_ORIGIN,
    namespaceRegistryId: SPECIMEN_LABEL_NAMESPACE_ID,
    carrierPlacement: SPECIMEN_LABEL_CARRIER_PLACEMENT,
    immutableAtSource: false,
    issuedAt,
    issuedBy: issuerOf(sample, actorId),
    templateVersionId: SPECIMEN_LABEL_TEMPLATE_VERSION_ID,
  }, { session, printed, provenance });
  return { label, containerId: loaded.containerId };
}

module.exports = {
  SPECIMEN_LABEL_ORIGIN,
  SPECIMEN_LABEL_SYMBOLOGY,
  SPECIMEN_LABEL_CARRIER_PLACEMENT,
  SPECIMEN_LABEL_NAMESPACE_ID,
  SPECIMEN_LABEL_TEMPLATE_VERSION_ID,
  issueSpecimenLabel,
};
