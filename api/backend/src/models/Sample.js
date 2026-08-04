const mongoose = require('mongoose');
const { Schema } = mongoose;
const { validateQualityMIABIS } = require('../utils/qualityMIABISValidator');
const {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
} = require('../config/constants/specimen.constants');

// dict-02 ELM-0123 enum plus the documented local extension `disposed`
// (RF006 AC#4 requires it distinct from `destroyed` — see
// canonical-data-contract-v1.md's Specimen section, point 1).
const SPECIMEN_STATUS_VALUES = [
  'available',
  'reserved',
  'checked_out',
  'partial',
  'depleted',
  'quarantined',
  'destroyed',
  'unavailable',
  'disposed',
];

// specimenStatus's sticky/blocked values — quantity changes must not
// override these, and write sites treat them as non-movable.
const BLOCKED_SPECIMEN_STATUSES = ['unavailable', 'destroyed', 'disposed', 'quarantined'];

const SampleSchema = new Schema({
  specimenId: { type: String, required: true, index: true },
  participantId: { type: String, required: true, index: true },
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
  sprec: { type: Schema.Types.Mixed, default: null },
  merkleRoot: { type: String, default: null },
  consentTemplateId: { type: String, default: null },
  clinicalData: { type: Schema.Types.Mixed, default: null },
  pharmacologyData: { type: Schema.Types.Mixed, default: null },
  releaseStatus: { type: String, default: 'QUARANTINE' },
  consentStatus: { type: String, default: null },
  quarantineStatus: { type: String, default: 'QUARANTINED' },
  quarantineReason: { type: String, default: null },
  availabilityStatus: { type: String, default: 'BLOCKED' },
  importBatchId: { type: String, default: null },
  importedAt: { type: Date, default: null },
  importedBy: { type: String, default: null },
  lifecycleStatus: {
    type: String,
    enum: ['REGISTERED', 'AVAILABLE', 'PARTIAL', 'DEPLETED', 'UNAVAILABLE', 'DESTROYED', 'DISPOSED', 'QUARANTINED'],
    default: 'REGISTERED'
  },
  specimenStatus: {
    type: String,
    enum: SPECIMEN_STATUS_VALUES,
    default: 'available'
  },
  availableQuantity: { type: Number, default: null },
  originalQuantity: { type: Number, default: null },
  totalWithdrawn: { type: Number, default: 0 },
  totalReturned: { type: Number, default: 0 },
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
  static validateLifecycleStatus(status) {
    return ['REGISTERED', 'AVAILABLE', 'PARTIAL', 'DEPLETED', 'UNAVAILABLE', 'DESTROYED', 'DISPOSED', 'QUARANTINED'].includes(status);
  }

  static validateSpecimenStatus(status) {
    return SPECIMEN_STATUS_VALUES.includes(String(status || '').toLowerCase());
  }

  // Pure 1:1 derivation from specimenStatus — every write site that sets
  // specimenStatus also derives these from it, never independently, so
  // every current reader of lifecycleStatus/availabilityStatus keeps
  // working unchanged (canonical-data-contract-v1.md, Specimen section).
  static deriveLegacyStatuses(specimenStatus) {
    const status = String(specimenStatus || '').toLowerCase();
    return {
      lifecycleStatus: status.toUpperCase(),
      availabilityStatus: BLOCKED_SPECIMEN_STATUSES.includes(status) ? 'BLOCKED' : 'AVAILABLE'
    };
  }

  // Legacy sample documents written before this field existed have no
  // specimenStatus — fall back to their (uppercase) lifecycleStatus,
  // case-folded, until they're next written through the dual-write bridge.
  static resolveSpecimenStatus(sample) {
    if (sample && sample.specimenStatus) return String(sample.specimenStatus).toLowerCase();
    return String((sample && sample.lifecycleStatus) || 'available').toLowerCase();
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
    if (data.lifecycleStatus && !this.validateLifecycleStatus(data.lifecycleStatus)) {
      errors.push('lifecycleStatus inválido');
    }
    if (data.specimenStatus && !this.validateSpecimenStatus(data.specimenStatus)) {
      errors.push('specimenStatus inválido');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const registeredAt = data.registeredAt ? new Date(data.registeredAt) : new Date();
    const availableQuantity = data.availableQuantity !== undefined ? data.availableQuantity : data.quantity;
    const originalQuantity = data.originalQuantity !== undefined ? data.originalQuantity : data.quantity;

    // REGISTERED has no dict-02 equivalent and was never a distinct
    // blockable state — fold it into `available` (canonical-data-contract-v1.md
    // Specimen section, point 1). Dual-write: lifecycleStatus/availabilityStatus
    // are derived from specimenStatus unless the caller explicitly overrides them.
    const specimenStatus = data.specimenStatus
      ? String(data.specimenStatus).toLowerCase()
      : 'available';
    const derivedLegacy = this.deriveLegacyStatuses(specimenStatus);

    return {
      specimenId: String(data.specimenId),
      participantId: String(data.participantId),
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
      sprec: data.sprec ?? null,
      merkleRoot: data.merkleRoot || null,
      consentTemplateId: data.consentTemplateId || null,
      clinicalData: data.clinicalData ?? null,
      pharmacologyData: data.pharmacologyData ?? null,
      releaseStatus: data.releaseStatus || 'QUARANTINE',
      consentStatus: data.consentStatus || null,
      quarantineStatus: data.quarantineStatus || 'QUARANTINED',
      quarantineReason: data.quarantineReason || null,
      importBatchId: data.importBatchId || null,
      importedAt: data.importedAt || null,
      importedBy: data.importedBy || null,
      specimenStatus,
      lifecycleStatus: data.lifecycleStatus || derivedLegacy.lifecycleStatus,
      availabilityStatus: data.availabilityStatus || derivedLegacy.availabilityStatus,
      availableQuantity,
      originalQuantity,
      totalWithdrawn: data.totalWithdrawn || 0,
      totalReturned: data.totalReturned || 0,
      accessionNumber: data.accessionNumber || null,
      orderNumber: data.orderNumber || null,
      processingStatus: data.processingStatus || null,
      protocolApplied: data.protocolApplied || null,
      specimenCollection: data.specimenCollection || null,
      studyId: data.studyId || null,
      protocolId: data.protocolId || null,
      collectionId: data.collectionId || null,
      linkedFiles: Array.isArray(data.linkedFiles) ? data.linkedFiles : [],
      qrCode: data.qrCode || null,
      storageLocation: data.storageLocation || null,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      updatedAt: new Date()
    };
  }

  // Computes specimenStatus (case-folded per canonical-data-contract-v1.md).
  // Algorithm shape unchanged from the pre-#405 lifecycleStatus version —
  // only the value vocabulary changed. Sticky/blocked statuses stop
  // quantity from overriding them; only outside that set does quantity
  // drive depleted/partial/available.
  static computeStatus(initialVolume, currentVolume, currentStatus) {
    const init = Number(initialVolume ?? 0);
    const curr = Number(currentVolume ?? 0);
    const current = String(currentStatus || '').toLowerCase();

    if (BLOCKED_SPECIMEN_STATUSES.includes(current)) return current;
    if (curr <= 0) return 'depleted';
    if (init > 0 && curr < init) return 'partial';
    return 'available';
  }

  static validateWithdrawalType(withdrawalType) {
    return ['Parcial', 'Total'].includes(withdrawalType);
  }
}

module.exports = Sample;
module.exports.SampleModel = SampleModel;
module.exports.SPECIMEN_STATUS_VALUES = SPECIMEN_STATUS_VALUES;
module.exports.BLOCKED_SPECIMEN_STATUSES = BLOCKED_SPECIMEN_STATUSES;
