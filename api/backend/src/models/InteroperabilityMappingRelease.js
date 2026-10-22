const crypto = require('crypto');

// Canonical Data Model v2.0.0 InteroperabilityMappingRelease (V2E-0244..0252,
// V2E-0710..0729), RF011 AC2/AC6, RNF024 C6 and RULE-035 (#1322): the
// versioned mapping between the canonical model and FHIR R4, with its
// coverage, its round-trip loss report, its approval and its vigência.
//
// A Phase 1 structure: modelled and catalog-conformant. The MongoDB
// persistence of RF011 AC2 and the FHIR validator are later slices (see
// docs/decisions/2026-10-22-interoperability-mapping-release-structures.md).

// INFERENCE, not a citation: V2E-0245's cell and example both read `FHIR R4`,
// and the entity's FHIR-specific Core fields fit no other standard.
const STANDARDS = ['FHIR R4'];

// INFERENCE, not a citation: RF011 AC1 says FHIR 4.0.1, V2E-0711's example is
// `4.0.1` and V2E-0255's is `R4`, the same release.
const FHIR_VERSIONS = ['4.0.1', 'R4'];

// INFERENCE, not a citation: the cell reads `draft` and the example
// `approved`. The set is the repo's release lifecycle, as
// ConfigurationRelease.js and CanonicalModelRelease.js use it.
const STATUSES = ['draft', 'candidate', 'approved', 'active', 'superseded', 'retired'];

// INFERENCE, not a citation: the nine resources RF011 AC4 names.
const RESOURCE_TYPES = [
  'Patient', 'Specimen', 'Consent', 'Observation', 'DiagnosticReport',
  'Provenance', 'AuditEvent', 'DocumentReference', 'ResearchStudy',
];

// INFERENCE, not a citation: RULE-035 binds V2E-0727/0728 at `approved`; an
// active or superseded release followed that approval, so it carries them
// too, as ConfigurationRelease.js does past activation.
const APPROVED_STATUSES = ['approved', 'active', 'superseded'];

// The checksum and mapping hash are SHA-256, written `sha256:<hex>` or as a
// bare 64-hex digest, as DatasetSnapshot.js reads them.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;

const REQUIRED_STRINGS = [
  'standard', 'mappingVersion', 'mappingUri', 'checksum', 'authorId', 'status',
  'roundTripLossReportUri', 'canonicalModelReleaseId', 'fhirVersion',
  'mappingDefinitionUri', 'mappingDefinitionHash', 'conformanceTestReportUri',
];
const REQUIRED_ARRAYS = ['profileRegistryIds', 'resourceTypes', 'identifierNamespaceRegistryIds', 'approvedBy'];
const CLOSED_SETS = {
  standard: STANDARDS,
  fhirVersion: FHIR_VERSIONS,
  status: STATUSES,
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());
const toDate = (value) => (value ? new Date(value) : null);
const arrayOf = (value) => (Array.isArray(value) ? value : []);

class InteroperabilityMappingReleaseModel {
  static fieldsOf(data = {}) {
    return {
      interoperabilityMappingReleaseId: data.interoperabilityMappingReleaseId || crypto.randomUUID(),
      standard: data.standard ?? null,
      profile: data.profile ?? null,
      mappingVersion: data.mappingVersion ?? null,
      mappingUri: data.mappingUri ?? null,
      checksum: data.checksum ?? null,
      authorId: data.authorId ?? null,
      status: data.status ?? null,
      roundTripLossReportUri: data.roundTripLossReportUri ?? null,
      canonicalModelReleaseId: data.canonicalModelReleaseId ?? null,
      fhirVersion: data.fhirVersion ?? null,
      implementationGuideCanonical: data.implementationGuideCanonical ?? null,
      implementationGuideVersion: data.implementationGuideVersion ?? null,
      jurisdiction: arrayOf(data.jurisdiction),
      profileRegistryIds: arrayOf(data.profileRegistryIds),
      resourceTypes: arrayOf(data.resourceTypes),
      identifierNamespaceRegistryIds: arrayOf(data.identifierNamespaceRegistryIds),
      terminologyReleaseIds: arrayOf(data.terminologyReleaseIds),
      mappingDefinitionUri: data.mappingDefinitionUri ?? null,
      mappingDefinitionHash: data.mappingDefinitionHash ?? null,
      conformanceTestReportUri: data.conformanceTestReportUri ?? null,
      coverageNumerator: data.coverageNumerator ?? null,
      coverageDenominator: data.coverageDenominator ?? null,
      coverageRatio: data.coverageRatio ?? null,
      roundTripLossesPresent: data.roundTripLossesPresent ?? null,
      approvedBy: arrayOf(data.approvedBy),
      approvedAt: toDate(data.approvedAt),
      // A Period, half-open [start, end); a null end is open-ended.
      effectivePeriod: data.effectivePeriod
        ? { start: toDate(data.effectivePeriod.start), end: toDate(data.effectivePeriod.end) }
        : null,
      supersedesReleaseId: data.supersedesReleaseId ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para InteroperabilityMappingRelease (1..1)`);
    }
    for (const field of ['coverageNumerator', 'coverageDenominator']) {
      if (!isNonNegativeInteger(fields[field])) {
        errors.push(`${field} é obrigatório para InteroperabilityMappingRelease (1..1, integer >= 0)`);
      }
    }
    const ratioValid = typeof fields.coverageRatio === 'number' && Number.isFinite(fields.coverageRatio)
      && fields.coverageRatio >= 0 && fields.coverageRatio <= 1;
    if (!ratioValid) errors.push('coverageRatio é obrigatório para InteroperabilityMappingRelease (1..1, decimal em [0, 1])');
    if (typeof fields.roundTripLossesPresent !== 'boolean') {
      errors.push('roundTripLossesPresent é obrigatório para InteroperabilityMappingRelease (1..1, boolean)');
    }

    for (const field of REQUIRED_ARRAYS) {
      if (fields[field].length === 0 || !fields[field].every(isNonEmptyString)) {
        errors.push(`${field} é obrigatório para InteroperabilityMappingRelease (1..*)`);
      }
    }
    if (!fields.terminologyReleaseIds.every(isNonEmptyString)) {
      errors.push('terminologyReleaseIds deve conter apenas referências não vazias');
    }

    for (const [field, allowed] of Object.entries(CLOSED_SETS)) {
      if (isNonEmptyString(fields[field]) && !allowed.includes(fields[field])) {
        errors.push(`${field} inválido: ${fields[field]}`);
      }
    }
    for (const resourceType of fields.resourceTypes) {
      if (isNonEmptyString(resourceType) && !RESOURCE_TYPES.includes(resourceType)) {
        errors.push(`resourceTypes inválido: ${resourceType}`);
      }
    }

    for (const field of ['checksum', 'mappingDefinitionHash']) {
      if (isNonEmptyString(fields[field]) && !SHA256.test(fields[field])) {
        errors.push(`${field} deve ser um digest SHA-256: ${fields[field]}`);
      }
    }

    const { coverageNumerator: numerator, coverageDenominator: denominator } = fields;
    if (isNonNegativeInteger(numerator) && isNonNegativeInteger(denominator)) {
      if (numerator > denominator) {
        errors.push(`coverageNumerator ${numerator} excede coverageDenominator ${denominator}`);
      } else if (ratioValid) {
        // INFERENCE, not a citation: RULE-035 asks for measured coverage, so
        // the ratio is the one the two counts give.
        const expected = denominator === 0 ? 0 : numerator / denominator;
        if (Math.abs(fields.coverageRatio - expected) > 1e-9) {
          errors.push(`coverageRatio ${fields.coverageRatio} difere de coverageNumerator/coverageDenominator (${expected})`);
        }
      }
    }

    // V2E-0713: "Obrigatório quando implementationGuideCanonical for informado."
    if (isNonEmptyString(fields.implementationGuideCanonical) && !isNonEmptyString(fields.implementationGuideVersion)) {
      errors.push('implementationGuideVersion é obrigatório quando implementationGuideCanonical for informado');
    }
    // INFERENCE, not a citation: V2E-0712 binds an institutional, national or
    // international profile; a set `profile` is one. RULE-035's "IG versions"
    // are read through V2E-0712/0713, so a base-FHIR release carries no IG.
    if (isNonEmptyString(fields.profile) && !isNonEmptyString(fields.implementationGuideCanonical)) {
      errors.push('implementationGuideCanonical é obrigatório quando profile for informado');
    }

    // INFERENCE, not a citation: a CodeableConcept is stored as the Coding
    // shape { systemUri, code, version, display } ClinicalObservation.js uses.
    fields.jurisdiction.forEach((coding, index) => {
      if (!coding || !isNonEmptyString(coding.systemUri) || !isNonEmptyString(coding.code)) {
        errors.push(`jurisdiction[${index}] deve ser um Coding com systemUri e code`);
      }
    });

    const period = fields.effectivePeriod;
    if (period && isValidDate(period.start) && isValidDate(period.end) && period.end <= period.start) {
      errors.push('effectivePeriod.end deve ser posterior a effectivePeriod.start');
    }
    if (isNonEmptyString(fields.supersedesReleaseId)
      && fields.supersedesReleaseId === fields.interoperabilityMappingReleaseId) {
      errors.push('supersedesReleaseId não pode referenciar a própria release');
    }

    // RULE-035, V2E-0727/0728: "Obrigatório quando status=approved."
    if (APPROVED_STATUSES.includes(fields.status)) {
      if (!isValidDate(fields.approvedAt)) {
        errors.push(`approvedAt é obrigatório quando status=${fields.status} (RULE-035)`);
      }
      if (!period || !isValidDate(period.start)) {
        errors.push(`effectivePeriod é obrigatório quando status=${fields.status}, com start (RULE-035)`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = InteroperabilityMappingReleaseModel;
module.exports.STANDARDS = STANDARDS;
module.exports.FHIR_VERSIONS = FHIR_VERSIONS;
module.exports.STATUSES = STATUSES;
module.exports.RESOURCE_TYPES = RESOURCE_TYPES;
