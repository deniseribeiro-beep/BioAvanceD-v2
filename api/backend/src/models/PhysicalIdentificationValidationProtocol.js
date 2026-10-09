const crypto = require('crypto');
const { SYMBOLOGY_VALUES } = require('./LabelIdentifier');

// Canonical Data Model v2.0.0 PhysicalIdentificationValidationProtocol
// (V2E-0700..0709), RF016 AC7: the ex ante protocol that tries the physical
// identification on empty tubes and synthetic data before any real use.
// scope lists only `ex_ante_synthetic` in the catalog, the one value
// accepted. approvedAt is required once approvalStatus is
// approved_for_execution (V2E-0709).
//
// RULE-037: execution is blocked unless the protocol is
// approved_for_execution and, in its scope, realSpecimenUse is false. The
// approval is documentary: it never records, or stands for, a passed run,
// so this model has no result field.
const SCOPE_VALUES = ['ex_ante_synthetic'];
const APPROVAL_STATUS_VALUES = ['draft', 'approved_for_execution', 'retired'];
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/i;

class PhysicalIdentificationValidationProtocolModel {
  static fieldsOf(data = {}) {
    return {
      physicalIdentificationValidationProtocolId: data.physicalIdentificationValidationProtocolId || crypto.randomUUID(),
      protocolVersion: data.protocolVersion ?? null,
      scope: data.scope ? String(data.scope).toLowerCase() : null,
      evidenceUri: data.evidenceUri ?? null,
      evidenceHash: data.evidenceHash ?? null,
      approvedSymbologies: Array.isArray(data.approvedSymbologies) ? data.approvedSymbologies.map((s) => String(s).toLowerCase()) : [],
      fixtureCatalogRefs: Array.isArray(data.fixtureCatalogRefs) ? data.fixtureCatalogRefs.map(String) : [],
      realSpecimenUse: data.realSpecimenUse ?? null,
      approvalStatus: data.approvalStatus ? String(data.approvalStatus).toLowerCase() : 'draft',
      approvedAt: data.approvedAt ? new Date(data.approvedAt) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.protocolVersion || !SEMVER.test(fields.protocolVersion)) {
      throw new Error(`protocolVersion é obrigatório e SemVer: ${fields.protocolVersion}`);
    }
    if (!SCOPE_VALUES.includes(fields.scope)) {
      throw new Error(`scope inválido: ${fields.scope}`);
    }
    if (!fields.evidenceUri) {
      throw new Error('evidenceUri é obrigatório (1..1)');
    }
    if (!fields.evidenceHash || !SHA256.test(fields.evidenceHash)) {
      throw new Error('evidenceHash deve ser um SHA-256 em hexadecimal (1..1)');
    }
    if (!fields.approvedSymbologies.length || fields.approvedSymbologies.some((s) => !SYMBOLOGY_VALUES.includes(s))) {
      throw new Error(`approvedSymbologies inválido: ${fields.approvedSymbologies.join(', ')}`);
    }
    if (!fields.fixtureCatalogRefs.length) {
      throw new Error('fixtureCatalogRefs é obrigatório (1..*)');
    }
    if (typeof fields.realSpecimenUse !== 'boolean') {
      throw new Error('realSpecimenUse é obrigatório (1..1, booleano)');
    }
    if (!APPROVAL_STATUS_VALUES.includes(fields.approvalStatus)) {
      throw new Error(`approvalStatus inválido: ${fields.approvalStatus}`);
    }
    if (fields.approvalStatus === 'approved_for_execution' && !fields.approvedAt) {
      throw new Error('approvedAt é obrigatório quando approvalStatus=approved_for_execution (V2E-0709)');
    }
    return fields;
  }

  // RULE-037, RF016 AC7: the gate a run of the protocol passes first.
  static assertExecutable(protocol) {
    if (protocol?.approvalStatus !== 'approved_for_execution') {
      throw new Error(`Protocolo não executável: approvalStatus=${protocol?.approvalStatus} (RULE-037)`);
    }
    if (protocol.scope === 'ex_ante_synthetic' && protocol.realSpecimenUse !== false) {
      throw new Error('Protocolo ex ante sintético não pode usar espécime real (RULE-037)');
    }
  }
}

module.exports = PhysicalIdentificationValidationProtocolModel;
module.exports.SCOPE_VALUES = SCOPE_VALUES;
module.exports.APPROVAL_STATUS_VALUES = APPROVAL_STATUS_VALUES;
