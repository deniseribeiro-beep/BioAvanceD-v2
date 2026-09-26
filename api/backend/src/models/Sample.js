const { validateQualityMIABIS } = require('../utils/qualityMIABISValidator');
const {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
} = require('../config/constants/specimen.constants');

// #830 follow-up: this module is a plain helper (SampleModel), not a Mongoose
// model. Persistence goes through the native driver (collection `specimens`).
// The former mongoose.model('Sample') registration was unused by writers and
// left a silent buffer risk for any process that required this file.

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

class SampleModel {
  static validateSpecimenStatus(status) {
    return SPECIMEN_STATUS_VALUES.includes(String(status || '').toLowerCase());
  }

  static resolveSpecimenStatus(sample) {
    if (sample && sample.specimenStatus) return String(sample.specimenStatus).toLowerCase();
    return 'available';
  }

  // External representations (import CSVs, FHIR) still speak the legacy
  // lifecycleStatus vocabulary — map onto specimenStatus per the case-fold
  // rules in canonical-data-contract-v1.md's Specimen section, point 1:
  // REGISTERED has no dict-02 equivalent and folds into available; any
  // other unrecognized/blank value also defaults to available rather than
  // failing the import.
  static mapLegacyLifecycleStatusToSpecimenStatus(lifecycleStatus) {
    const normalized = String(lifecycleStatus || '').trim().toLowerCase();
    if (!normalized || normalized === 'registered') return 'available';
    return this.validateSpecimenStatus(normalized) ? normalized : 'available';
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
    // #1092: collectionSite (Reference(Organization)) is required on create.
    if (!data.collectionSite || typeof data.collectionSite !== 'string' || data.collectionSite.trim() === '') {
      errors.push('collectionSite é obrigatório');
    }
    if (
      data.barcode !== undefined &&
      data.barcode !== null &&
      typeof data.barcode !== 'string'
    ) {
      errors.push('barcode deve ser uma string canônica para identificação Data Matrix');
    }
    if (!(Number(data.quantity) > 0)) errors.push('quantity deve ser maior que zero');
    if (data.quality !== undefined && data.quality !== null && !validateQualityMIABIS(data.quality)) {
      errors.push('quality deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN');
    }
    if (data.specimenStatus && !this.validateSpecimenStatus(data.specimenStatus)) {
      errors.push('specimenStatus inválido');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const registeredAt = data.registeredAt ? new Date(data.registeredAt) : new Date();
    const currentQuantity = data.currentQuantity !== undefined ? data.currentQuantity : data.quantity;
    const initialQuantity = data.initialQuantity !== undefined ? data.initialQuantity : data.quantity;

    // REGISTERED has no dict-02 equivalent and was never a distinct
    // blockable state — fold it into `available` (canonical-data-contract-v1.md
    // Specimen section, point 1).
    const specimenStatus = data.specimenStatus
      ? String(data.specimenStatus).toLowerCase()
      : 'available';

    return {
      specimenId: String(data.specimenId),
      participantId: String(data.participantId),
      sampleType: data.sampleType,
      sampleOrigin: data.sampleOrigin,
      extractionProtocol: data.extractionProtocol,
      barcode: data.barcode || null,
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
      // #1092: no null happy-path default — callers must supply a real org.
      collectionSite: data.collectionSite,
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
      currentQuantity,
      initialQuantity,
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

module.exports = SampleModel;
module.exports.SampleModel = SampleModel;
module.exports.SPECIMEN_STATUS_VALUES = SPECIMEN_STATUS_VALUES;
module.exports.BLOCKED_SPECIMEN_STATUSES = BLOCKED_SPECIMEN_STATUSES;
