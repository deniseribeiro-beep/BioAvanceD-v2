const mongoose = require('mongoose');
const { Schema } = mongoose;
const { validateQualityMIABIS } = require('../utils/qualityMIABISValidator');
const {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
} = require('../config/constants/specimen.constants');

// RF006 AC2 (v2.0.0 V2E-0544): specimenStatus holds the operational state
// only. Quantity moved to quantityStatus, and disposition to DispositionAction.
const SPECIMEN_STATUS_VALUES = [
  'available',
  'reserved',
  'checked_out',
  'quarantined',
  'unavailable',
  'closed',
];

// The v1.3.0 values (ELM-0123) that mixed quantity and disposition into the
// status. A stored document may still carry one until
// src/scripts/migrateSpecimenStatusV2.js has run; no write accepts one.
const LEGACY_SPECIMEN_STATUS_VALUES = ['partial', 'depleted', 'destroyed', 'disposed'];

// The v1.3.0 -> v2 mapping (V2E-0544). The five shared values map directly.
// partial and depleted become available: quantityStatus carries the
// depletion, and `unavailable` would block returnSample's un-deplete flow.
// destroyed and disposed read as unavailable: `closed` needs an executed
// disposition the read cannot see, so only the migration, which looks for
// one, maps them to closed.
const LEGACY_SPECIMEN_STATUS_MAP = {
  partial: 'available',
  depleted: 'available',
  destroyed: 'unavailable',
  disposed: 'unavailable',
};

// RF006 AC3 (V2E-0437, dictionary RULE-003..005): derived from
// initialQuantity and currentQuantity, never written by a client.
const QUANTITY_STATUS_VALUES = ['full', 'partial', 'depleted'];

// v2.0.0 ELM-0121 (code 1..1 Core), ENUM-0053..0057. See
// docs/decisions/2026-10-13-specimen-role.md.
const SPECIMEN_ROLE_VALUES = ['primary', 'aliquot', 'derivative', 'pool', 'control'];

// RNF018 AC4: the RCS result, set only by RCS certification, never by a caller.
// That covers the governance outcome (modelVersion, matrixType, governanceStatus,
// governanceFailureReasons, governanceRuleCodes) and the sealed-assessment pin
// (sealedRcsAssessmentId) from the same certification.
const RCS_DERIVED_FIELDS = Object.freeze(['biologicalPenalty', 'rcsScore', 'scoreBasedGrade', 'finalGrade', 'gradeRoute', 'axisPenalties', 'calculationTrace', 'rcsEvaluation', 'modelVersion', 'matrixType', 'governanceStatus', 'governanceFailureReasons', 'governanceRuleCodes', 'sealedRcsAssessmentId']);

// RNF018 AC4: the RCS-derived fields a body names as own keys (null
// included), and the refusal's detail per field; every write path reads these.
function findRcsDerivedFields(source) {
  const bag = source || {};
  return RCS_DERIVED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(bag, field));
}
function rcsDerivedWriteDetails(fields) {
  return fields.map((field) => `${field}: derivado da certificação RCS e não pode ser informado`);
}

// The states that refuse withdrawal and return, and that no quantity change
// moves.
const BLOCKED_SPECIMEN_STATUSES = ['unavailable', 'quarantined', 'closed'];

// RF026 AC7: closed is final; no re-evaluation, consent change or edit
// rewrites it.
const TERMINAL_SPECIMEN_STATUSES = ['closed'];
// The stored values isTerminalSpecimen treats as final, for a query filter:
// closed, plus a not-yet-migrated destroyed/disposed document.
const TERMINAL_STORED_SPECIMEN_STATUSES = Object.freeze([...TERMINAL_SPECIMEN_STATUSES, 'destroyed', 'disposed']);

const SampleSchema = new Schema({
  // #941: `index: true` on specimenId/participantId is INERT on its own --
  // mongoose connects with autoIndex:false and nothing calls syncIndexes().
  // Both are BUILT natively by utils/sampleIndexes.js, reached through
  // collectionResolver.getCollection('samples'). Kept because they are
  // accurate; what they are not is self-executing.
  specimenId: { type: String, required: true, index: true },
  participantId: { type: String, required: true, index: true },
  // v2.0.0 ELM-0011: the id the sample carried in the system it was
  // imported from, kept for reconciliation. Never the specimenId.
  sourceRecordId: { type: String, default: null },
  sampleType: { type: String, required: true },
  sampleOrigin: { type: String, required: true },
  extractionProtocol: { type: String, required: true },
  barcode: { type: String, index: true },
  barcodeSymbologies: { type: Schema.Types.Mixed, default: null },
  barcodeIndustrial: { type: Schema.Types.Mixed, default: null },
  registeredAt: { type: Date, required: true },
  withdrawnAt: { type: Date, default: null },
  receivedAt: { type: Date, default: null },
  quantity: { type: Number, required: true },
  unit: { type: String, default: 'µL' },
  quality: { type: String },
  modelVersion: { type: String, default: null },
  matrixType: { type: String, default: null },
  governanceStatus: { type: Number, enum: [0, 1], default: null },
  governanceFailureReasons: { type: [String], default: [] },
  governanceRuleCodes: { type: [String], default: [] },
  biologicalPenalty: { type: Number, default: null },
  rcsScore: { type: Number, default: null },
  scoreBasedGrade: { type: String, default: '' },
  finalGrade: { type: String, default: '' },
  gradeRoute: { type: String, default: null },
  axisPenalties: { type: [Schema.Types.Mixed], default: [] },
  calculationTrace: { type: Schema.Types.Mixed, default: null },
  rcsEvaluation: { type: Schema.Types.Mixed, default: null },
  externalQualityAssessment: { type: Schema.Types.Mixed, default: null },
  locationId: { type: Number, default: null },
  location: { type: Object, default: null },
  linkedProject: { type: String, required: true },
  collectionSite: { type: String, default: null },
  // #1192: the tenancy key, separate from the collection site (ELM-0128).
  // A local extension; see docs/decisions/2026-10-11-sample-tenancy.md.
  organizationId: { type: String, default: null },
  sprec: { type: Schema.Types.Mixed, default: null },
  merkleRoot: { type: String, default: null },
  // #502: pins integrity verification to the RcsAssessment/SpecimenPreanalytics
  // snapshot (if any) that existed at seal time, so a later re-assessment
  // snapshot for the same specimenId can't cause a false tamper report.
  // No dict-02 entity covers this — it's an implementation detail of
  // MerkleService's per-sample hash, not part of the dict-02 P1X-0162..0167
  // MerkleRoot stub entity.
  sealedRcsAssessmentId: { type: Schema.Types.Mixed, default: null },
  sealedSpecimenPreanalyticsId: { type: Schema.Types.Mixed, default: null },
  consentTemplateId: { type: String, default: null },
  clinicalData: { type: Schema.Types.Mixed, default: null },
  pharmacologyData: { type: Schema.Types.Mixed, default: null },
  consentStatus: { type: String, default: null },
  // quarantineReason has no specimenStatus equivalent — it's the only
  // free-text field in the legacy trio, kept deliberately (#407/#415/#408).
  quarantineReason: { type: String, default: null },
  importBatchId: { type: String, default: null },
  importedAt: { type: Date, default: null },
  importedBy: { type: String, default: null },
  specimenStatus: {
    type: String,
    enum: SPECIMEN_STATUS_VALUES,
    default: 'available'
  },
  // ELM-0121: set at creation. Null only on a document written before the
  // field, until the backfill has run; readers use resolveSpecimenRole.
  specimenRole: { type: String, enum: SPECIMEN_ROLE_VALUES, default: null },
  // RF006 AC3: derived from initialQuantity/currentQuantity on every write
  // that moves either; clients cannot set it.
  quantityStatus: { type: String, enum: QUANTITY_STATUS_VALUES, default: null },
  // V2E-0544 "preserve original provenance": the v1.3.0 value a migrated
  // document held, and when the migration replaced it.
  legacySpecimenStatus: { type: String, default: null },
  specimenStatusMigratedAt: { type: Date, default: null },
  // dict-02 ELM-0138 (initialQuantity)/ELM-0139 (currentQuantity, "Derivada de
  // eventos; preservar ledger"). Confirmed (#401): sample.service.js's
  // withdrawSample/returnSample already write currentQuantity/totalWithdrawn/
  // totalReturned atomically alongside the hash-chained SampleMovement ledger inside
  // a single Mongo transaction (RF006 AC#6) — this is not naive duplicated state.
  // totalWithdrawn/totalReturned have no direct dict-02 counterpart; #449 decided
  // to keep them as Sample-level running totals (cheap to keep in sync with the
  // ledger, per #401) rather than compute on read from SampleMovement.
  currentQuantity: { type: Number, default: null },
  initialQuantity: { type: Number, default: null },
  totalWithdrawn: { type: Number, default: 0 },
  totalReturned: { type: Number, default: 0 },
  // V2E-0438 / RF006 AC4: server-owned version of the quantity ledger, raised
  // by one on every ledgered quantity change (withdrawal, return).
  quantityLedgerVersion: { type: Number, default: 0 },
  accessionNumber: { type: String, default: null },
  orderNumber: { type: String, default: null },
  processingStatus: { type: String, default: null },
  protocolApplied: { type: String, default: null },
  specimenCollection: { type: Schema.Types.Mixed, default: null },
  studyId: { type: String, default: null },
  protocolId: { type: String, default: null },
  collectionId: { type: String, default: null },
  linkedFiles: { type: [Schema.Types.Mixed], default: [] },
  qrCode: { type: String, default: null },
  storageLocation: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'samples' });

const Sample = mongoose.models.Sample || mongoose.model('Sample', SampleSchema);

class SampleModel {
  static validateSpecimenStatus(status) {
    return SPECIMEN_STATUS_VALUES.includes(String(status || '').toLowerCase());
  }

  static isLegacySpecimenStatus(status) {
    return LEGACY_SPECIMEN_STATUS_VALUES.includes(String(status || '').trim().toLowerCase());
  }

  // A v1.3.0 value folded onto the v2 set by LEGACY_SPECIMEN_STATUS_MAP; any
  // other value is only case-folded.
  static foldLegacySpecimenStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return LEGACY_SPECIMEN_STATUS_MAP[normalized] || normalized;
  }

  // A document not yet migrated reads in the v2 set (legacy-read fallback).
  static resolveSpecimenStatus(sample) {
    if (sample && sample.specimenStatus) return this.foldLegacySpecimenStatus(sample.specimenStatus);
    return 'available';
  }

  // Closed, or a not-yet-migrated destroyed/disposed document: its
  // destruction may be real even though the read cannot prove it, so no
  // automatic rewrite touches it before the migration has decided.
  static isTerminalSpecimen(sample) {
    const raw = String(sample?.specimenStatus || '').trim().toLowerCase();
    return TERMINAL_STORED_SPECIMEN_STATUSES.includes(raw);
  }

  // RF006 AC3, dictionary RULE-003..005: cur=0 -> depleted,
  // 0<cur<init -> partial, cur=init -> full. A current above the initial
  // (a return of more than was recorded) reads full.
  static computeQuantityStatus(initialQuantity, currentQuantity) {
    const init = Number(initialQuantity ?? 0);
    const curr = Number(currentQuantity ?? 0);
    if (!(curr > 0)) return 'depleted';
    if (init > 0 && curr < init) return 'partial';
    return 'full';
  }

  static quantitiesOf(sample = {}) {
    return {
      initial: sample.initialQuantity ?? sample.quantity,
      current: sample.currentQuantity ?? sample.quantity,
    };
  }

  // The stored value, or one derived from the quantities when a document
  // written before the field existed has none.
  static resolveQuantityStatus(sample) {
    const stored = String(sample?.quantityStatus || '').toLowerCase();
    if (QUANTITY_STATUS_VALUES.includes(stored)) return stored;
    const { initial, current } = this.quantitiesOf(sample || {});
    return this.computeQuantityStatus(initial, current);
  }

  // The stored role, or the one a create would have given a document
  // written before the field existed: derivative with parents, else primary.
  static resolveSpecimenRole(sample) {
    const stored = String(sample?.specimenRole || '').trim().toLowerCase();
    if (SPECIMEN_ROLE_VALUES.includes(stored)) return stored;
    const parents = sample?.parentSpecimenIds;
    return Array.isArray(parents) && parents.length > 0 ? 'derivative' : 'primary';
  }

  // External representations (import CSVs, FHIR) still speak the legacy
  // lifecycleStatus vocabulary — map onto specimenStatus per the case-fold
  // rules in canonical-data-contract-v1.md's Specimen section, point 1:
  // REGISTERED has no dict-02 equivalent and folds into available; any
  // other unrecognized/blank value also defaults to available rather than
  // failing the import. v1.3.0 values fold per LEGACY_SPECIMEN_STATUS_MAP.
  // An imported `closed` lands unavailable: RF026 AC7 closes a specimen only
  // after a validated consumption or an executed disposition, which an
  // import row does not carry.
  static mapLegacyLifecycleStatusToSpecimenStatus(lifecycleStatus) {
    const normalized = String(lifecycleStatus || '').trim().toLowerCase();
    if (!normalized || normalized === 'registered') return 'available';
    if (normalized === 'closed') return 'unavailable';
    const folded = this.foldLegacySpecimenStatus(normalized);
    return this.validateSpecimenStatus(folded) ? folded : 'available';
  }

  static validateSampleType(sampleType) {
    return typeof sampleType === 'string' && SPECIMEN_TYPE_IDS.includes(sampleType);
  }

  static validateSampleOrigin(sampleOrigin) {
    return typeof sampleOrigin === 'string' && SAMPLE_ORIGIN_IDS.includes(sampleOrigin);
  }

  static validateExtractionType(extractionProtocol) {
    return typeof extractionProtocol === 'string' && EXTRACTION_PROTOCOL_IDS.includes(extractionProtocol);
  }

  static validateResponsibleName(name) {
    return typeof name === 'string' && name.trim().split(/\s+/).length >= 2;
  }

  static validate(data) {
    const errors = [];
    if (!data.specimenId) errors.push('specimenId é obrigatório');
    if (!data.participantId) errors.push('participantId é obrigatório');
    if (!this.validateSampleType(data.sampleType)) errors.push('sampleType inválido conforme MIABIS');
    if (!this.validateSampleOrigin(data.sampleOrigin)) errors.push('sampleOrigin inválido conforme MIABIS');
    if (!this.validateExtractionType(data.extractionProtocol)) errors.push('extractionProtocol inválido conforme MIABIS');
    if (!data.registeredAt) errors.push('registeredAt é obrigatório');
    if (!(Number(data.quantity) > 0)) errors.push('quantity deve ser maior que zero');
    if (data.quality !== undefined && data.quality !== null && !validateQualityMIABIS(data.quality)) {
      errors.push('quality deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN');
    }
    if (data.specimenStatus && !this.validateSpecimenStatus(data.specimenStatus)) {
      errors.push('specimenStatus inválido');
    } else if (String(data.specimenStatus || '').trim().toLowerCase() === 'closed') {
      // RF026 AC7: a specimen is closed by a validated consumption or an
      // executed disposition, never registered closed.
      errors.push('specimenStatus closed não pode ser atribuído no cadastro');
    }
    if (data.quantityStatus !== undefined && data.quantityStatus !== null) {
      // RF006 AC3: quantityStatus is derived; a manual write is refused.
      errors.push('quantityStatus é derivado das quantidades e não pode ser informado');
    }
    // dict-02 ELM-0120: the specimens this one derives from, by specimenId.
    if (data.parentSpecimenIds !== undefined) {
      if (!Array.isArray(data.parentSpecimenIds)) {
        errors.push('parentSpecimenIds deve ser uma lista');
      } else {
        for (const parentId of data.parentSpecimenIds) {
          if (typeof parentId !== 'string' || parentId.trim() === '') {
            errors.push('parentSpecimenIds deve conter apenas specimenIds não vazios');
          } else if (data.specimenId && parentId.trim() === String(data.specimenId)) {
            errors.push('parentSpecimenIds não pode conter a própria amostra');
          }
        }
      }
    }
    // ELM-0121, REL-0175: a primary or control has no parents; an aliquot
    // or a derivative names at least one. A pool has no parent rule here.
    if (data.specimenRole !== undefined && data.specimenRole !== null) {
      const role = String(data.specimenRole).trim().toLowerCase();
      const hasParents = Array.isArray(data.parentSpecimenIds) && data.parentSpecimenIds.length > 0;
      if (!SPECIMEN_ROLE_VALUES.includes(role)) {
        errors.push('specimenRole inválido');
      } else if ((role === 'primary' || role === 'control') && hasParents) {
        errors.push(`specimenRole ${role} não pode ter parentSpecimenIds`);
      } else if ((role === 'aliquot' || role === 'derivative') && !hasParents) {
        errors.push(`specimenRole ${role} exige parentSpecimenIds`);
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const registeredAt = data.registeredAt ? new Date(data.registeredAt) : new Date();
    const currentQuantity = data.currentQuantity !== undefined ? data.currentQuantity : data.quantity;
    const initialQuantity = data.initialQuantity !== undefined ? data.initialQuantity : data.quantity;

    // REGISTERED has no dict-02 equivalent and was never a distinct
    // blockable state — fold it into `available` (canonical-data-contract-v1.md
    // Specimen section, point 1). A v1.3.0 value folds per
    // LEGACY_SPECIMEN_STATUS_MAP.
    const specimenStatus = data.specimenStatus
      ? this.foldLegacySpecimenStatus(data.specimenStatus)
      : 'available';
    // RF006 AC3: derived, whatever the caller sent.
    const quantityStatus = this.computeQuantityStatus(initialQuantity, currentQuantity);
    const parentSpecimenIds = Array.isArray(data.parentSpecimenIds)
      ? [...new Set(data.parentSpecimenIds
        .filter((parentId) => typeof parentId === 'string' && parentId.trim() !== '')
        .map((parentId) => parentId.trim()))]
      : [];
    // ELM-0121: the given role, else derivative with parents, else primary.
    const specimenRole = data.specimenRole !== undefined && data.specimenRole !== null
      ? String(data.specimenRole).trim().toLowerCase()
      : (parentSpecimenIds.length > 0 ? 'derivative' : 'primary');

    return {
      specimenId: String(data.specimenId),
      participantId: String(data.participantId),
      sourceRecordId: data.sourceRecordId ? String(data.sourceRecordId) : null,
      sampleType: data.sampleType,
      sampleOrigin: data.sampleOrigin,
      extractionProtocol: data.extractionProtocol,
      barcode: data.barcode || null,
      barcodeSymbologies: data.barcodeSymbologies || null,
      barcodeIndustrial: data.barcodeIndustrial || null,
      registeredAt,
      withdrawnAt: data.withdrawnAt ? new Date(data.withdrawnAt) : null,
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
      quantity: Number(data.quantity),
      unit: data.unit || 'µL',
      quality: data.quality || null,
      modelVersion: data.modelVersion || null,
      matrixType: data.matrixType || null,
      governanceStatus: data.governanceStatus ?? null,
      governanceFailureReasons: Array.isArray(data.governanceFailureReasons) ? data.governanceFailureReasons : [],
      governanceRuleCodes: Array.isArray(data.governanceRuleCodes) ? data.governanceRuleCodes : [],
      biologicalPenalty: data.biologicalPenalty ?? null,
      rcsScore: data.rcsScore ?? null,
      scoreBasedGrade: data.scoreBasedGrade || '',
      finalGrade: data.finalGrade || '',
      gradeRoute: data.gradeRoute || null,
      axisPenalties: Array.isArray(data.axisPenalties) ? data.axisPenalties : [],
      calculationTrace: data.calculationTrace ?? null,
      rcsEvaluation: data.rcsEvaluation ?? null,
      externalQualityAssessment: data.externalQualityAssessment ?? null,
      locationID: data.locationID ?? null,
      linkedProject: data.linkedProject,
      collectionSite: data.collectionSite || null,
      // #1192: the tenancy key is never taken from a request or a file. The create
      // paths will stamp it server-side; until then the backfill sets it from
      // collectionSite, and readers fall back to collectionSite.
      organizationId: null,
      sprec: data.sprec ?? null,
      merkleRoot: data.merkleRoot || null,
      sealedRcsAssessmentId: data.sealedRcsAssessmentId ?? null,
      sealedSpecimenPreanalyticsId: data.sealedSpecimenPreanalyticsId ?? null,
      consentTemplateId: data.consentTemplateId || null,
      clinicalData: data.clinicalData ?? null,
      pharmacologyData: data.pharmacologyData ?? null,
      consentStatus: data.consentStatus || null,
      quarantineReason: data.quarantineReason || null,
      importBatchId: data.importBatchId || null,
      importedAt: data.importedAt || null,
      importedBy: data.importedBy || null,
      specimenStatus,
      quantityStatus,
      currentQuantity,
      initialQuantity,
      totalWithdrawn: data.totalWithdrawn || 0,
      totalReturned: data.totalReturned || 0,
      quantityLedgerVersion: 0,
      accessionNumber: data.accessionNumber || null,
      orderNumber: data.orderNumber || null,
      processingStatus: data.processingStatus || null,
      protocolApplied: data.protocolApplied || null,
      specimenCollection: data.specimenCollection || null,
      studyId: data.studyId || null,
      protocolId: data.protocolId || null,
      collectionId: data.collectionId || null,
      parentSpecimenIds,
      specimenRole,
      linkedFiles: Array.isArray(data.linkedFiles) ? data.linkedFiles : [],
      qrCode: data.qrCode || null,
      storageLocation: data.storageLocation || null,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      updatedAt: new Date()
    };
  }

  static validateWithdrawalType(withdrawalType) {
    return ['Parcial', 'Total'].includes(withdrawalType);
  }
}

module.exports = Sample;
module.exports.SampleModel = SampleModel;
module.exports.SPECIMEN_STATUS_VALUES = SPECIMEN_STATUS_VALUES;
module.exports.BLOCKED_SPECIMEN_STATUSES = BLOCKED_SPECIMEN_STATUSES;
module.exports.TERMINAL_SPECIMEN_STATUSES = TERMINAL_SPECIMEN_STATUSES;
module.exports.TERMINAL_STORED_SPECIMEN_STATUSES = TERMINAL_STORED_SPECIMEN_STATUSES;
module.exports.LEGACY_SPECIMEN_STATUS_VALUES = LEGACY_SPECIMEN_STATUS_VALUES;
module.exports.LEGACY_SPECIMEN_STATUS_MAP = LEGACY_SPECIMEN_STATUS_MAP;
module.exports.QUANTITY_STATUS_VALUES = QUANTITY_STATUS_VALUES;
module.exports.SPECIMEN_ROLE_VALUES = SPECIMEN_ROLE_VALUES;
module.exports.RCS_DERIVED_FIELDS = RCS_DERIVED_FIELDS;
module.exports.findRcsDerivedFields = findRcsDerivedFields;
module.exports.rcsDerivedWriteDetails = rcsDerivedWriteDetails;
