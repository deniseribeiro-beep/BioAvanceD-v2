const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const { generateSampleHash } = require('./MerkleService');
const SampleMovementModel = require('../models/SampleMovement');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');

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
    clinical_data: sample?.clinical_data && typeof sample.clinical_data === 'object' ? sample.clinical_data : {},
    pharmacology_data: sample?.pharmacology_data && typeof sample.pharmacology_data === 'object' ? sample.pharmacology_data : {},
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
      required: ['treatment_status'],
      recommended: ['medication_name', 'last_dose_date'],
      treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
    },
  };
}

function resolveSuggestedStatus(graphPath) {
  if (!graphPath.ethics.valid || !graphPath.clinical.valid || !graphPath.integrity.valid) {
    return 'BLOCKED';
  }

  if (!graphPath.quality.valid) {
    return 'QUARANTINE';
  }

  return 'AVAILABLE';
}

function normalizeSampleIdFilter(sampleId) {
  if (ObjectId.isValid(sampleId)) {
    return { _id: new ObjectId(sampleId) };
  }

  return { sampleID: normalizeString(sampleId) };
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

  async _loadSample(sampleId) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const sample = await samplesCollection.findOne(normalizeSampleIdFilter(sampleId));
    return { samplesCollection, sample };
  }

  async _validateEthics(sample, consentsCollection) {
    const tcleId = normalizeString(sample?.tcle_id || sample?.consentTemplateId);
    const patientID = normalizeString(sample?.patientID || sample?.patientId);

    if (!tcleId || !patientID) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    const consentQuery = {
      $or: [
        { _id: ObjectId.isValid(tcleId) ? new ObjectId(tcleId) : null },
        { templateId: tcleId },
        { consentTemplateId: tcleId },
      ].filter(Boolean),
    };

    const consent = await consentsCollection.findOne(consentQuery);

    if (!consent) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    const consentStatus = normalizeString(consent.status).toUpperCase();
    const consentPatient = normalizeString(consent.patientId || consent.patientID);

    if (consentStatus !== 'ACTIVE' || (consentPatient && consentPatient !== patientID)) {
      return { valid: false, reason: 'Consentimento Inválido ou Revogado' };
    }

    return {
      valid: true,
      reason: 'Consentimento ativo e compatível com paciente',
    };
  }

  _validateQuality(sample) {
    const qualityCategory = normalizeString(sample?.quality_category).toUpperCase();
    const qualityScore = normalizeNumber(sample?.quality_score);
    const penaltyLog = Array.isArray(sample?.penalty_log) ? sample.penalty_log : [];
    const sprec = sample?.sprec && typeof sample.sprec === 'object' ? sample.sprec : {};

    const mandatorySprecFields = [
      sprec.sampleType,
      sprec.primaryContainer,
      sprec.preCentrifugation,
      sprec.centrifugation,
      sprec.secondCentrifugation,
      sprec.postCentrifugationDelay,
      sprec.longTermStorage,
    ];

    const hasMissingMandatorySprec = mandatorySprecFields.some((field) => normalizeString(field).length === 0);
    const hasUnknownCriticalSprec = mandatorySprecFields.some((field) => {
      const code = normalizeString(field).toUpperCase();
      return code === 'X' || code === 'XXX';
    });

    const hasCriticalPenalty = penaltyLog.some((entry) => {
      const value = normalizeString(entry).toLowerCase();
      return value.includes('metadata_critica_ausente') || value.includes('quarentena_forcada:true');
    });

    if (hasMissingMandatorySprec || hasUnknownCriticalSprec || hasCriticalPenalty) {
      return {
        valid: false,
        reason: 'Falha crítica de metadado pré-analítico/SPREC (quarentena técnica obrigatória)',
      };
    }

    if (qualityScore !== null) {
      const expectedCategory = qualityScore >= 85 ? 'A' : qualityScore >= 65 ? 'B' : 'C';
      if (qualityCategory && qualityCategory !== expectedCategory) {
        return {
          valid: false,
          reason: `Inconsistência score/categoria (${qualityScore} => ${expectedCategory}, recebido ${qualityCategory})`,
        };
      }
      if (expectedCategory === 'A' || expectedCategory === 'B') {
        return {
          valid: true,
          reason: `Qualidade ${expectedCategory} aprovada (score ${qualityScore})`,
        };
      }

      return {
        valid: false,
        reason: `Qualidade insuficiente (score ${qualityScore}, quarentena técnica)`,
      };
    }

    if (qualityCategory === 'A' || qualityCategory === 'B') {
      return {
        valid: true,
        reason: `Qualidade ${qualityCategory} aprovada`,
      };
    }

    return {
      valid: false,
      reason: 'Qualidade Insuficiente (Quarentena Técnica)',
    };
  }

  _validateClinical(sample, requirements = defaultRequirements(), disease = null) {
    const clinicalData = sample?.clinical_data && typeof sample.clinical_data === 'object'
      ? sample.clinical_data
      : {};
    const pharmacologyData = sample?.pharmacology_data && typeof sample.pharmacology_data === 'object'
      ? sample.pharmacology_data
      : {};

    const orphaCode = normalizeString(clinicalData.orphaCode);
    const cid = normalizeString(clinicalData.cid);

    if (!orphaCode || !cid) {
      return { valid: false, reason: 'Dataset Clínico Incompleto' };
    }

    const biomarkerValues = normalizeBiomarkerMap(
      clinicalData.biomarkers_values && typeof clinicalData.biomarkers_values === 'object'
        ? clinicalData.biomarkers_values
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

    const treatmentStatus = normalizeString(
      pharmacologyData.treatment_status || pharmacologyData.treatmentStatus
    ).toUpperCase();

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
    const pharmacologyData = sample?.pharmacology_data && typeof sample.pharmacology_data === 'object'
      ? sample.pharmacology_data
      : {};

    const treatmentStatus = normalizeString(
      pharmacologyData.treatment_status || pharmacologyData.treatmentStatus
    ).toUpperCase();

    if (requirements?.miabis?.requireTreatmentStatus && !treatmentStatus) {
      return {
        valid: false,
        reason: 'INCOMPLETE: treatment_status (MIABIS) obrigatório',
      };
    }

    if (treatmentStatus === 'TREATED' || treatmentStatus === 'ON_TREATMENT') {
      const atcCode = normalizeString(pharmacologyData.atc_code || pharmacologyData.medication_code).replace(/^ATC:/i, '').toUpperCase();
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
        const medicationDrugClass = normalizeString(medication.drug_class || pharmacologyData.drug_class).toLowerCase();
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

  _validateIntegrity(sample) {
    const persistedRoot = normalizeString(sample?.merkle_root);
    if (!persistedRoot) {
      return { valid: false, reason: 'Violação de Integridade Criptográfica (Tampering)' };
    }

    const recomputedRoot = generateSampleHash(sample);
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
      sampleID: String(sample?.sampleID || sample?._id || '').trim(),
      barcode: normalizeString(sample?.barcode) || null,
      type: SampleMovementModel.MOVEMENT_TYPES.ADJUST,
      quantity: 1,
      unit: 'registro',
      responsible: 'SampleGraphValidator',
      purpose: 'compliance_graph_validation',
      observations: 'Perfil Clínico/Farmacológico selado via Merkle Root',
      previousQuantity: Number(sample?.availableQuantity || sample?.quantity || 0),
      newQuantity: Number(sample?.availableQuantity || sample?.quantity || 0),
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

  async validateSampleCompliance(sampleId) {
    if (!this.db) {
      throw new Error('Database não inicializado para SampleGraphValidator');
    }

    const { samplesCollection, sample } = await this._loadSample(sampleId);
    if (!sample) {
      throw new Error('Amostra não encontrada para validação de conformidade');
    }

    const consentsCollection = await getCollection(this.db, 'consents');

    const diseaseContext = await this._loadDiseaseRequirements(sample?.clinical_data?.orphaCode);

    const graphPath = {
      ethics: await this._validateEthics(sample, consentsCollection),
      quality: this._validateQuality(sample),
      clinical: this._validateClinical(sample, diseaseContext.requirements, diseaseContext.disease),
      pharmacology: await this._validatePharmacology(sample, diseaseContext.requirements, diseaseContext.disease),
      integrity: this._validateIntegrity(sample),
    };

    const isReleasable = Object.values(graphPath).every((node) => Boolean(node?.valid));
    const suggestedStatus = resolveSuggestedStatus(graphPath);

    const report = {
      sampleId: String(sample._id || sample.sampleID || sampleId),
      orphaCode: normalizeOrpha(sample?.clinical_data?.orphaCode),
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

    await samplesCollection.updateOne(
      { _id: sample._id },
      {
        $set: {
          release_status: suggestedStatus,
          complianceGraph: {
            ...report,
            evaluatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      }
    );

    if (!isReleasable) {
      logger.warn('[SAMPLE_GRAPH_VALIDATOR] Amostra bloqueada/quarentenada', {
        sampleId: report.sampleId,
        suggestedStatus,
        graphPath,
      });
    } else {
      await this._recordClinicalSealHistory(sample, samplesCollection);
      logger.info('[SAMPLE_GRAPH_VALIDATOR] Amostra apta para liberação', {
        sampleId: report.sampleId,
        suggestedStatus,
      });
    }

    return report;
  }
}

module.exports = SampleGraphValidator;
