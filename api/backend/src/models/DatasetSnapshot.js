const crypto = require('crypto');

// Canonical Data Model v2.0.0 DatasetSnapshot (V2E-0287..0295), RF029 AC8
// and RNF030 C2 (#1318): the frozen members, filters, policies, references
// and checksum of a dataset prepared for scientific use.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// RF029 AC8 permits it only in authorized and versioned scientific use, and
// no such flow exists yet. inactive-analytical-structures.arch.test.js pins
// that; the flow that activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

// V2E-0294's vocabulary is SHA-256. The synthetic examples write checksums
// as `sha256:<hex>`; a bare 64-hex digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;

const REQUIRED_STRINGS = ['datasetSnapshotId', 'datasetId', 'memberManifestUri', 'queryDefinition', 'checksum'];
const REQUIRED_OBJECTS = ['filterDefinition', 'policySnapshot'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

class DatasetSnapshotModel {
  static fieldsOf(data = {}) {
    return {
      datasetSnapshotId: data.datasetSnapshotId || crypto.randomUUID(),
      datasetId: data.datasetId ?? null,
      memberManifestUri: data.memberManifestUri ?? null,
      queryDefinition: data.queryDefinition ?? null,
      filterDefinition: data.filterDefinition ?? null,
      policySnapshot: data.policySnapshot ?? null,
      referenceVersions: Array.isArray(data.referenceVersions) ? data.referenceVersions : [],
      checksum: data.checksum ?? null,
      createdAt: data.createdAt ? new Date(data.createdAt) : null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para DatasetSnapshot (1..1)`);
    }
    for (const field of REQUIRED_OBJECTS) {
      if (!isPlainObject(fields[field])) errors.push(`${field} é obrigatório para DatasetSnapshot (1..1, object)`);
    }
    if (fields.referenceVersions.length === 0 || !fields.referenceVersions.every(isNonEmptyString)) {
      errors.push('referenceVersions é obrigatório para DatasetSnapshot (1..*, Reference)');
    }
    if (isNonEmptyString(fields.checksum) && !SHA256.test(fields.checksum)) {
      errors.push(`checksum deve ser um digest SHA-256: ${fields.checksum}`);
    }
    if (!isValidDate(fields.createdAt)) errors.push('createdAt é obrigatório para DatasetSnapshot (1..1, ISO 8601)');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf({ ...data, createdAt: data.createdAt || new Date() });
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = DatasetSnapshotModel;
