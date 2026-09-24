const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const { generateSampleHashFromSample } = require('./MerkleService');
const SampleMovementModel = require('../models/SampleMovement');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const qualityDomain = require('./quality-domain.service');
const quarantineActionService = require('./quarantine-action.service');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableObject(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const sorted = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = stableObject(value[key]);
      });
    return sorted;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function hashSampleIntegrityPayload(sample = {}) {
  const canonical = JSON.stringify(stableObject({
    clinicalData: sample?.clinicalData && typeof sample.clinicalData === 'object' ? sample.clinicalData : {},
    pharmacologyData: sample?.pharmacologyData && typeof sample.pharmacologyData === 'object' ? sample.pharmacologyData : {},
  }));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function normalizeOrpha(value) {
  return normalizeString(value).replace(/^ORPHA:/i, '');
}

function normalizeBiomarkerMap(values = {}) {
  if (!values || typeof values !== 'object') {
    return {};
  }

  return Object.entries(values).reduce((acc, [rawKey, rawValue]) => {
    const key = normalizeKey(rawKey);
    if (!key) {
      return acc;
    }
    acc[key] = rawValue;
    return acc;
  }, {});
}

function defaultRequirements() {
  return {
    miabis: {
      requireTreatmentStatus: true,
    },
    biomarkers: {
      required: [],
      recommended: [],
    },
    pharmacology: {
      required: ['treatmentStatus'],
      recommended: ['medicationName', 'lastDoseDate'],
      treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
    },
  };
}

function resolveSuggestedStatus(graphPath) {
  // pharmacology sits alongside ethics/clinical/integrity here (not just
  // folded into `isReleasable`'s every-node check) — before #532, this
  // function silently ignored it, so a sample could be isReleasable:false
  // (pharmacology invalid, e.g. ATC drug-class incoherent with the ORPHA
  // disease) yet still get suggestedStatus: 'AVAILABLE'. Harmless while
  // suggestedStatus only fed the cosmetic release_status field; load-bearing
  // now that #532 makes it drive specimenStatus directly.
  if (!graphPath.ethics.valid || !graphPath.clinical.valid || !graphPath.pharmacology.valid || !graphPath.integrity.valid) {
    return 'BLOCKED';
  }

  if (!graphPath.quality.valid) {
    return 'QUARANTINE';
  }

  return 'AVAILABLE';
}

// #532: same 3-way collapse reports.routes.js's releaseStatusToSpecimenStatus
// already applies for the physical/consent-quarantine case — BLOCKED is the
// compliance-graph's hard-failure outcome, which maps onto the same
// `unavailable` value QUARANTINE's soft-failure filter collapses BLOCKED to.
const SUGGESTED_STATUS_TO_SPECIMEN_STATUS = {
  AVAILABLE: 'available',
  QUARANTINE: 'quarantined',
  BLOCKED: 'unavailable',
};

// specimenStatus values a compliance-graph re-evaluation must never touch —
// destroyed/disposed are final per Sample.js's BLOCKED_SPECIMEN_STATUSES
// comment ("write sites treat them as non-movable"); this write site is no
// exception.
const TERMINAL_SPECIMEN_STATUSES = ['destroyed', 'disposed'];

// Ordering for the escalate-vs-downgrade decision below — only these three
// values are ever compliance-graph targets (SUGGESTED_STATUS_TO_SPECIMEN_STATUS's
// range), so terminal states are handled separately, above.
const SPECIMEN_STATUS_ORDER = { available: 0, quarantined: 1, unavailable: 2 };

// One reasonCode per failing graph node, prefixed so a later re-evaluation
// can recognize (and safely release) an active QuarantineAction this same
// validator opened, without touching one opened by an unrelated quarantine
// source (cold-chain incident, equipment fault, manual action).
function complianceGraphReasonCodes(graphPath) {
  const codes = [];
  if (!graphPath.ethics.valid) codes.push('COMPLIANCE_GRAPH_ETHICS');
  if (!graphPath.clinical.valid) codes.push('COMPLIANCE_GRAPH_CLINICAL');
  if (!graphPath.pharmacology.valid) codes.push('COMPLIANCE_GRAPH_PHARMACOLOGY');
  if (!graphPath.integrity.valid) codes.push('COMPLIANCE_GRAPH_INTEGRITY');
  if (!graphPath.quality.valid) codes.push('COMPLIANCE_GRAPH_QUALITY');
  return codes;
}

function isComplianceGraphOwnedAction(action) {
  return Boolean(action)
    && Array.isArray(action.reasonCodes)
    && action.reasonCodes.length > 0
    && action.reasonCodes.every((code) => String(code).startsWith('COMPLIANCE_GRAPH_'));
}

// Canonical v2 identifier resolution: internal contracts use specimenId only.
function normalizeSpecimenIdFilter(specimenId) {
  return { specimenId: normalizeString(specimenId) };
}

class SampleGraphValidator {
  constructor(db) {
    this.db = db;
  }

  async _loadDiseaseRequirements(orphaCode) {
    const normalizedOrpha = normalizeOrpha(orphaCode);
    const diseaseCollection = await getCollection(this.db, 'diseaseDictionary');

    if (!normalizedOrpha) {
      return {
        disease: null,
        requirements: defaultRequirements(),
      };
    }

    const disease = await diseaseCollection.findOne({
      orpha_code: normalizedOrpha,
      active: { $ne: false },
    });

    return {
      disease,
      requirements: disease?.validation_requirements || defaultRequirements(),
    };
  }

  async _loadSample(specimenId) {
    const samplesCollection = await getCollection(this.db, 'Specimen');
    const sample = await samplesCollection.findOne(normalizeSpecimenIdFilter(specimenId));
    return { samplesCollection, sample };
  }

  async _validateEthics(sample, consentsCollection) {
    const tcleId = normalizeString(sample?.consentTemplateId);
    const participantId = normalizeString(sample?.participantId);

    if (!tcleId || !participantId) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    const consentQuery = {
      $or: [
        { _id: ObjectId.isValid(tcleId) ? new ObjectId(tcleId) : null },
        { consentTemplateId: tcleId },
      ].filter(Boolean),
    };

    const consent = await consentsCollection.findOne(consentQuery);

    if (!consent) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    const consentStatus = normalizeString(consent.status).toUpperCase();
    const consentParticipant = normalizeString(consent.participantId);

    if (consentStatus !== 'ACTIVE' || (consentParticipant && consentParticipant !== participantId)) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    return {
      valid: true,
      reason: 'Consentimento ativo e compatível com paciente',
    };
  }

  _validateQuality(sample) {
    return qualityDomain.validateQualityForReleaseFromSample(this.db, sample);
  }

  _validateClinical(sample, requirements = defaultRequirements(), disease = null) {
    const clinicalData = sample?.clinicalData && typeof sample.clinicalData === 'object'
      ? sample.clinicalData
      : {};
    const pharmacologyData = sample?.pharmacologyData && typeof sample.pharmacologyData === 'object'
      ? sample.pharmacologyData
      : {};

    const orphaCode = normalizeString(clinicalData.orphaCode);
    const cid = normalizeString(clinicalData.cid);

    if (!orphaCode || !cid) {
      return { valid: false, reason: 'Dataset Clínico Incompleto' };
    }

    const biomarkerValues = normalizeBiomarkerMap(
      clinicalData.biomarkerValues && typeof clinicalData.biomarkerValues === 'object'
        ? clinicalData.biomarkerValues
        : {}
    );

    const requiredBiomarkers = Array.isArray(requirements?.biomarkers?.required)
      ? requirements.biomarkers.required.map((item) => normalizeKey(item)).filter(Boolean)
      : [];

    for (const biomarkerKey of requiredBiomarkers) {
      if (normalizeNumber(biomarkerValues[biomarkerKey]) === null) {
        return {
          valid: false,
          reason: `Dataset Clínico Incompleto: biomarcador obrigatório ausente (${biomarkerKey})`,
        };
      }
    }

    const treatmentStatus = normalizeString(pharmacologyData.treatmentStatus).toUpperCase();

    if (requirements?.miabis?.requireTreatmentStatus && !treatmentStatus) {
      return { valid: false, reason: 'Dataset Clínico Incompleto: treatment_status (MIABIS) obrigatório' };
    }

    const validStatuses = Array.isArray(requirements?.pharmacology?.treatmentStatuses)
      ? requirements.pharmacology.treatmentStatuses.map((status) => normalizeString(status).toUpperCase()).filter(Boolean)
      : ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'];

    if (treatmentStatus && validStatuses.length > 0 && !validStatuses.includes(treatmentStatus)) {
      return { valid: false, reason: `Dataset Clínico Incompleto: treatment_status inválido (${treatmentStatus})` };
    }

    const requiredPharmacologyFields = Array.isArray(requirements?.pharmacology?.required)
      ? requirements.pharmacology.required.map((field) => normalizeString(field)).filter(Boolean)
      : [];

    for (const field of requiredPharmacologyFields) {
      const value = pharmacologyData?.[field];
      if (normalizeString(value).length === 0) {
        return { valid: false, reason: `Dataset Clínico Incompleto: campo farmacológico obrigatório (${field})` };
      }
    }

    return {
      valid: true,
      reason: disease?.name
        ? `Dados clínicos e MIABIS essenciais presentes para ${disease.name}`
        : 'Dados clínicos e MIABIS essenciais presentes',
    };
  }

  async _validatePharmacology(sample, requirements = defaultRequirements(), disease = null) {
    const pharmacologyData = sample?.pharmacologyData && typeof sample.pharmacologyData === 'object'
      ? sample.pharmacologyData
      : {};

    const treatmentStatus = normalizeString(pharmacologyData.treatmentStatus).toUpperCase();

    if (requirements?.miabis?.requireTreatmentStatus && !treatmentStatus) {
      return {
        valid: false,
        reason: 'INCOMPLETE: treatment_status (MIABIS) obrigatório',
      };
    }

    if (treatmentStatus === 'TREATED' || treatmentStatus === 'ON_TREATMENT') {
      const atcCode = normalizeString(pharmacologyData.atcCode).replace(/^ATC:/i, '').toUpperCase();
      if (!atcCode) {
        return {
          valid: false,
          reason: 'INCOMPLETE: tratamento ativo exige atc_code',
        };
      }

      const medicationCollection = await getCollection(this.db, 'medicationDictionary');
      const medication = await medicationCollection.findOne({ atc_code: atcCode, active: { $ne: false } });
      const diseaseDrugClasses = Array.isArray(disease?.drug_classes)
        ? disease.drug_classes.map((item) => normalizeString(item).toLowerCase()).filter(Boolean)
        : [];

      if (diseaseDrugClasses.length > 0 && medication) {
        const medicationDrugClass = normalizeString(medication.drug_class || pharmacologyData.atcClass).toLowerCase();
        if (medicationDrugClass && !diseaseDrugClasses.includes(medicationDrugClass)) {
          return {
            valid: false,
            reason: 'INCOMPLETE: classe farmacológica ATC não coerente com a patologia ORPHA',
          };
        }
      }
    }

    return {
      valid: true,
      reason: 'Nó farmacológico válido',
    };
  }

  async _validateIntegrity(sample) {
    const persistedRoot = normalizeString(sample?.merkleRoot);
    if (!persistedRoot) {
      return { valid: false, reason: 'Violação de Integridade Criptográfica (Tampering)' };
    }

    const recomputedRoot = await generateSampleHashFromSample(this.db, sample);
    if (persistedRoot !== recomputedRoot) {
      return { valid: false, reason: 'Violação de Integridade Criptográfica (Tampering)' };
    }

    return {
      valid: true,
      reason: 'Integridade criptográfica confirmada',
    };
  }

  async _recordClinicalSealHistory(sample, samplesCollection) {
    const sampleMovements = await getCollection(this.db, 'sampleMovements');
    const movementID = await SampleMovementModel.generateMovementID(this.db);

    const movement = SampleMovementModel.create({
      movementID,
      specimenId: String(sample?.specimenId || '').trim(),
      barcode: normalizeString(sample?.barcode) || null,
      type: SampleMovementModel.MOVEMENT_TYPES.ADJUST,
      quantity: 1,
      unit: 'registro',
      responsible: 'SampleGraphValidator',
      purpose: 'compliance_graph_validation',
      observations: 'Perfil Clínico/Farmacológico selado via Merkle Root',
      previousQuantity: Number(sample?.currentQuantity || sample?.quantity || 0),
      newQuantity: Number(sample?.currentQuantity || sample?.quantity || 0),
      timestamp: new Date(),
    });

    await appendMovementWithHashChain(sampleMovements, movement);

    await samplesCollection.updateOne(
      { _id: sample._id },
      {
        $set: {
          updatedAt: new Date(),
        },
      }
    );
  }

  async validateSampleCompliance(specimenId) {
    if (!this.db) {
      throw new Error('Database não inicializado para SampleGraphValidator');
    }

    const { samplesCollection, sample } = await this._loadSample(specimenId);
    if (!sample) {
      throw new Error('Amostra não encontrada para validação de conformidade');
    }
    if (!normalizeString(sample.specimenId)) {
      throw new Error('Amostra sem specimenId canônico');
    }

    const consentsCollection = await getCollection(this.db, 'consents');

    const diseaseContext = await this._loadDiseaseRequirements(sample?.clinicalData?.orphaCode);

    const graphPath = {
      ethics: await this._validateEthics(sample, consentsCollection),
      quality: await this._validateQuality(sample),
      clinical: this._validateClinical(sample, diseaseContext.requirements, diseaseContext.disease),
      pharmacology: await this._validatePharmacology(sample, diseaseContext.requirements, diseaseContext.disease),
      integrity: await this._validateIntegrity(sample),
    };

    const isReleasable = Object.values(graphPath).every((node) => Boolean(node?.valid));
    const suggestedStatus = resolveSuggestedStatus(graphPath);

    const report = {
      specimenId: String(sample.specimenId || specimenId),
      orphaCode: normalizeOrpha(sample?.clinicalData?.orphaCode),
      disease: diseaseContext.disease
        ? {
          orpha_code: diseaseContext.disease.orpha_code,
          name: diseaseContext.disease.name,
          disease_category: diseaseContext.disease.disease_category,
        }
        : null,
      isReleasable,
      graphPath,
      suggestedStatus,
    };

    // #532: specimenStatus/QuarantineAction is the canonical status model
    // (#389/#398/#399/#404/#405/#406/#408) — write there directly instead of
    // the cosmetic `release_status` field, with a merge rule so this
    // re-evaluation can only escalate a *stronger* block or release one it
    // opened itself, never silently clear a block from an unrelated source
    // (a cold-chain incident, equipment fault, manual action) or a terminal
    // state (destroyed/disposed).
    const targetSpecimenStatus = SUGGESTED_STATUS_TO_SPECIMEN_STATUS[suggestedStatus];
    const currentSpecimenStatus = String(sample.specimenStatus || 'available').toLowerCase();
    const setPayload = {
      complianceGraph: {
        ...report,
        evaluatedAt: new Date(),
      },
      updatedAt: new Date(),
    };

    let escalated = false;
    let downgraded = false;
    let latestActiveAction = null;

    if (!TERMINAL_SPECIMEN_STATUSES.includes(currentSpecimenStatus)) {
      const targetOrder = SPECIMEN_STATUS_ORDER[targetSpecimenStatus];
      const currentOrder = SPECIMEN_STATUS_ORDER[currentSpecimenStatus] ?? SPECIMEN_STATUS_ORDER.available;

      if (targetOrder !== currentOrder) {
        const existingActions = await quarantineActionService.getActionsForSpecimen(this.db, report.specimenId);
        latestActiveAction = existingActions.find((action) => action.actionStatus === 'active') || null;
      }

      if (targetOrder > currentOrder) {
        setPayload.specimenStatus = targetSpecimenStatus;
        escalated = true;
      } else if (targetOrder < currentOrder && isComplianceGraphOwnedAction(latestActiveAction)) {
        setPayload.specimenStatus = targetSpecimenStatus;
        downgraded = true;
      }
    }

    await samplesCollection.updateOne(
      { _id: sample._id },
      { $set: setPayload }
    );

    if (escalated) {
      // Close out a prior self-owned action before opening the new one, so
      // at most one compliance-graph QuarantineAction is ever active per
      // specimen — otherwise a QUARANTINE→BLOCKED escalation would leave the
      // superseded QUARANTINE action dangling as still "active" forever.
      // An active action from an unrelated source (cold-chain, equipment,
      // manual) is left untouched; this escalation's own action is recorded
      // alongside it.
      if (isComplianceGraphOwnedAction(latestActiveAction)) {
        await quarantineActionService.releaseActiveAction(this.db, report.specimenId, 'SYSTEM_COMPLIANCE_GRAPH');
      }
      const reasonCodes = complianceGraphReasonCodes(graphPath);
      if (reasonCodes.length > 0) {
        await quarantineActionService.recordAction(this.db, {
          specimenIds: [report.specimenId],
          reasonCodes,
        });
      }
    } else if (downgraded) {
      await quarantineActionService.releaseActiveAction(this.db, report.specimenId, 'SYSTEM_COMPLIANCE_GRAPH');
    }

    if (!isReleasable) {
      logger.warn('[SAMPLE_GRAPH_VALIDATOR] Amostra bloqueada/quarentenada', {
        specimenId: report.specimenId,
        suggestedStatus,
        graphPath,
      });
    } else {
      await this._recordClinicalSealHistory(sample, samplesCollection);
      logger.info('[SAMPLE_GRAPH_VALIDATOR] Amostra apta para liberação', {
        specimenId: report.specimenId,
        suggestedStatus,
      });
    }

    return report;
  }
}

module.exports = SampleGraphValidator;
