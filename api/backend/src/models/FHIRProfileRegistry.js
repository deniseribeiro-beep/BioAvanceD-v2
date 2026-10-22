const crypto = require('crypto');

const { FHIR_VERSIONS, STATUSES } = require('./InteroperabilityMappingRelease');

// Canonical Data Model v2.0.0 FHIRProfileRegistry (V2E-0253..0260), RF011
// AC2 (#1322): a FHIR profile, its version and identifier systems, under the
// InteroperabilityMappingRelease that uses it. A Phase 1 structure, as that
// model is (see
// docs/decisions/2026-10-22-interoperability-mapping-release-structures.md).
// fhirVersion and status share InteroperabilityMappingRelease's sets.

const REQUIRED_STRINGS = ['canonicalUrl', 'fhirVersion', 'profileVersion', 'mappingReleaseId', 'status'];
const CLOSED_SETS = {
  fhirVersion: FHIR_VERSIONS,
  status: STATUSES,
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

class FHIRProfileRegistryModel {
  static fieldsOf(data = {}) {
    return {
      fhirProfileRegistryId: data.fhirProfileRegistryId || crypto.randomUUID(),
      canonicalUrl: data.canonicalUrl ?? null,
      fhirVersion: data.fhirVersion ?? null,
      profileVersion: data.profileVersion ?? null,
      identifierSystems: Array.isArray(data.identifierSystems) ? data.identifierSystems : [],
      capabilityStatementUri: data.capabilityStatementUri ?? null,
      mappingReleaseId: data.mappingReleaseId ?? null,
      status: data.status ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para FHIRProfileRegistry (1..1)`);
    }
    for (const [field, allowed] of Object.entries(CLOSED_SETS)) {
      if (isNonEmptyString(fields[field]) && !allowed.includes(fields[field])) {
        errors.push(`${field} inválido: ${fields[field]}`);
      }
    }
    if (!fields.identifierSystems.every(isNonEmptyString)) {
      errors.push('identifierSystems deve conter apenas URIs não vazias');
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

module.exports = FHIRProfileRegistryModel;
