const crypto = require('crypto');

// Canonical Data Model v2.0.0 LabelIdentifier (V2E-0168..0179, V2E-0642..0645),
// RF016 AC4/AC5: the physical identifier a label or a tube carries, an
// opaque value that resolves to its target and holds no personal data.
//
// - symbology: RF016 AC5 names Data Matrix, Code 128 and QR Code, the
//   catalog's own allowed list (data_matrix, code_128, qr_code).
// - targetType: the catalog's value is `container`, the tube's Data Matrix
//   (RF016 AC1). `storage_rack` is the rack's linear code RF016 AC5 asks to
//   confirm, a documented local value.
// - identifierOrigin: `manufacturer_applied` is the catalog's value
//   (RULE-034). `institution_applied` names the institutional identifiers
//   RF016 AC4 contrasts with it, a documented local value.
// - status lists only `active` in the catalog, the one value accepted.
const SYMBOLOGY_VALUES = ['data_matrix', 'code_128', 'qr_code'];
const TARGET_TYPE_VALUES = ['container', 'storage_rack'];
const IDENTIFIER_ORIGIN_VALUES = ['manufacturer_applied', 'institution_applied'];
const STATUS_VALUES = ['active'];

// RF016 AC4: issuance, template and batch are required only of an
// institutional identifier. RULE-034 waives them for a manufacturer's.
const INSTITUTIONAL_ISSUANCE_FIELDS = ['issuedAt', 'issuedBy', 'templateVersionId', 'printBatchId'];

// RULE-012, RF016 AC8: the encoded value is opaque. A CPF, an e-mail or
// free text (a space, as in a name) is refused before it can be printed.
const PII_PATTERNS = [
  { pattern: /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/, what: 'um CPF' },
  { pattern: /[^\s@]+@[^\s@]+\.[^\s@]+/, what: 'um e-mail' },
  { pattern: /\s/, what: 'texto livre' },
];

function lower(value) {
  return value ? String(value).toLowerCase() : null;
}

class LabelIdentifierModel {
  static fieldsOf(data = {}) {
    return {
      labelIdentifierId: data.labelIdentifierId || crypto.randomUUID(),
      encodedValue: data.encodedValue ?? null,
      symbology: lower(data.symbology),
      targetType: lower(data.targetType),
      targetId: data.targetId ? String(data.targetId) : null,
      status: data.status ? String(data.status).toLowerCase() : 'active',
      checksum: data.checksum ?? null,
      issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
      issuedBy: data.issuedBy ?? null,
      templateVersionId: data.templateVersionId ?? null,
      printBatchId: data.printBatchId ?? null,
      replacesIdentifierId: data.replacesIdentifierId ?? null,
      identifierOrigin: lower(data.identifierOrigin),
      namespaceRegistryId: data.namespaceRegistryId ?? null,
      carrierPlacement: lower(data.carrierPlacement),
      immutableAtSource: data.immutableAtSource ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['encodedValue', 'symbology', 'targetType', 'targetId', 'identifierOrigin', 'namespaceRegistryId', 'carrierPlacement']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para LabelIdentifier (1..1)`);
      }
    }
    if (typeof fields.immutableAtSource !== 'boolean') {
      throw new Error('immutableAtSource é obrigatório para LabelIdentifier (1..1, booleano)');
    }
    for (const [field, values] of [
      ['symbology', SYMBOLOGY_VALUES],
      ['targetType', TARGET_TYPE_VALUES],
      ['identifierOrigin', IDENTIFIER_ORIGIN_VALUES],
      ['status', STATUS_VALUES],
    ]) {
      if (!values.includes(fields[field])) {
        throw new Error(`${field} inválido: ${fields[field]}`);
      }
    }
    this.assertNoPersonalData(fields.encodedValue);

    if (fields.identifierOrigin === 'manufacturer_applied') {
      // RULE-034: a manufacturer's identifier is on the tube itself.
      if (fields.targetType !== 'container') {
        throw new Error('Identificador manufacturer_applied deve ter alvo container (RULE-034)');
      }
    } else {
      const missing = INSTITUTIONAL_ISSUANCE_FIELDS.filter((field) => !fields[field]);
      if (missing.length) {
        throw new Error(`Identificador institucional exige ${missing.join(', ')} (RF016 AC4)`);
      }
    }
    return fields;
  }

  static assertNoPersonalData(encodedValue) {
    const value = String(encodedValue);
    const hit = PII_PATTERNS.find(({ pattern }) => pattern.test(value));
    if (hit) {
      throw new Error(`encodedValue não pode conter ${hit.what} (RULE-012)`);
    }
  }
}

module.exports = LabelIdentifierModel;
module.exports.SYMBOLOGY_VALUES = SYMBOLOGY_VALUES;
module.exports.TARGET_TYPE_VALUES = TARGET_TYPE_VALUES;
module.exports.IDENTIFIER_ORIGIN_VALUES = IDENTIFIER_ORIGIN_VALUES;
module.exports.STATUS_VALUES = STATUS_VALUES;
