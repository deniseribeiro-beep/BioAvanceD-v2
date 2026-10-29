const crypto = require('crypto');

// Canonical Data Model v2.0.0 BiomarkerAssociation (ELM-0275..0285, #1206):
// reference data naming an analyte, the conditions it is associated with,
// its role and context of use, and the evidence behind it (see
// docs/decisions/2026-10-23-biomarker-association-store.md). A
// CodeableConcept is the {systemUri, code, version, display} Coding shape
// LabelDefinition.js records; the 0..1 CodeableConcept and BackboneElement
// fields are stored as given, as Condition.js stores its own. create() never
// throws: validation is the router's job, as for Network.js.

const REQUIRED = ['analyte', 'associatedCondition', 'biomarkerRole', 'contextOfUse', 'evidenceReferences'];

// ELM-0279's six purposes, in the English form of its example `diagnostic`;
// dict-ENUMS governs no biomarkerRole value.
const BIOMARKER_ROLES = ['diagnostic', 'prognostic', 'risk', 'safety', 'monitoring', 'response'];

// ENUM-0096..0098: ORPHA, ICD-11, MONDO. The URIs are those of
// src/reference-data/reference-imports/sources/{orpha,icd11,mondo}.js,
// hard-coded rather than required, since the importers stay off the startup
// path (intakeWizard.js hard-codes the ORPHA URI the same way).
const CONDITION_SYSTEMS = [
  'http://www.orpha.net',
  'http://id.who.int/icd/release/11/mms',
  'http://purl.obolibrary.org/obo/mondo.owl',
];

// ENUM-0099/0100: DOI, PMID.
const EVIDENCE_FORMATS = {
  DOI: /^10\.\d{4,9}\/\S+$/,
  PMID: /^[1-9]\d{0,8}$/,
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isCoding = (value) => isPlainObject(value) && isNonEmptyString(value.systemUri) && isNonEmptyString(value.code);

function evidenceError(reference) {
  // A non-string system is refused before the lookup, which would turn
  // ['DOI'] into the key 'DOI'.
  if (!isPlainObject(reference) || typeof reference.system !== 'string'
    || !Object.hasOwn(EVIDENCE_FORMATS, reference.system)) {
    return 'evidenceReferences deve usar o sistema DOI|PMID';
  }
  if (!isNonEmptyString(reference.value)) return 'evidenceReferences deve ter value não vazio';
  if (!EVIDENCE_FORMATS[reference.system].test(reference.value)) {
    return `evidenceReferences contém ${reference.system} inválido: ${reference.value}`;
  }
  return null;
}

const RULES = {
  analyte: (fields) => (isCoding(fields.analyte)
    ? []
    : ['analyte é obrigatório para BiomarkerAssociation (1..1)']),
  associatedCondition: (fields) => {
    if (fields.associatedCondition.length === 0) {
      return ['associatedCondition é obrigatório para BiomarkerAssociation (1..*)'];
    }
    return fields.associatedCondition.every((entry) => isCoding(entry) && CONDITION_SYSTEMS.includes(entry.systemUri))
      ? []
      : ['associatedCondition deve conter apenas Codings de ORPHA, ICD-11 ou MONDO'];
  },
  biomarkerRole: (fields) => {
    if (fields.biomarkerRole === null || fields.biomarkerRole === '') {
      return ['biomarkerRole é obrigatório para BiomarkerAssociation (1..1)'];
    }
    return BIOMARKER_ROLES.includes(fields.biomarkerRole)
      ? []
      : [`biomarkerRole deve ser um de ${BIOMARKER_ROLES.join(', ')}`];
  },
  contextOfUse: (fields) => (isNonEmptyString(fields.contextOfUse)
    ? []
    : ['contextOfUse é obrigatório para BiomarkerAssociation (1..1)']),
  evidenceReferences: (fields) => {
    if (fields.evidenceReferences.length === 0) {
      return ['evidenceReferences é obrigatório para BiomarkerAssociation (1..*)'];
    }
    return [...new Set(fields.evidenceReferences.map(evidenceError).filter(Boolean))];
  },
};

class BiomarkerAssociationModel {
  static fieldsOf(data = {}) {
    return {
      biomarkerId: data.biomarkerId || crypto.randomUUID(),
      analyte: data.analyte ?? null,
      associatedCondition: Array.isArray(data.associatedCondition) ? data.associatedCondition : [],
      biospecimenMatrix: data.biospecimenMatrix ?? null,
      biomarkerRole: data.biomarkerRole !== undefined && data.biomarkerRole !== null
        ? String(data.biomarkerRole).trim().toLowerCase()
        : null,
      contextOfUse: data.contextOfUse ?? null,
      assayMethod: data.assayMethod ?? null,
      cutoff: data.cutoff ?? null,
      evidenceLevel: data.evidenceLevel ?? null,
      regulatoryStatus: data.regulatoryStatus ?? null,
      evidenceReferences: Array.isArray(data.evidenceReferences) ? data.evidenceReferences : [],
    };
  }

  // The errors of the named keys only, so a PUT re-checks just what it carries.
  static fieldErrors(fields, keys) {
    return keys.flatMap((key) => (RULES[key] ? RULES[key](fields) : []));
  }

  static validate(data = {}) {
    const errors = this.fieldErrors(this.fieldsOf(data), REQUIRED);
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = BiomarkerAssociationModel;
module.exports.REQUIRED = REQUIRED;
module.exports.BIOMARKER_ROLES = BIOMARKER_ROLES;
