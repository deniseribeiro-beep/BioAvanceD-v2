const crypto = require('crypto');

// Canonical Data Model v2.0.0 DataFileVersion (V2E-0346..0353), RF007 AC4
// and RNF029 C3 (#1321): one row per binary version of a DataFile, written
// when the file is replaced, so the superseded checksum and version are kept
// instead of overwritten.
//
// - checksum: SHA-256 (V2E-0350), the 64 lowercase hex computeChecksum gives.
// - previousVersionId: absent on version 1 only; every later version links
//   to the one it superseded (V2E-0351).
const REQUIRED = ['fileId', 'objectUri', 'checksum', 'changeReason'];
const SHA256_HEX = /^[a-f0-9]{64}$/;

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

class DataFileVersionModel {
  static fieldsOf(data = {}) {
    return {
      dataFileVersionId: data.dataFileVersionId || crypto.randomUUID(),
      fileId: optionalString(data.fileId),
      versionNumber: typeof data.versionNumber === 'number' ? data.versionNumber : null,
      objectUri: optionalString(data.objectUri),
      checksum: optionalString(data.checksum),
      previousVersionId: optionalString(data.previousVersionId),
      changeReason: optionalString(data.changeReason),
      createdAt: data.createdAt ? new Date(data.createdAt) : null,
    };
  }

  // INFERENCE, not a citation: the retained binary is ciphertext, so its
  // version row carries the DataFile row's own four envelope fields under
  // the same names. decryptFileBuffer reads them as they are, and
  // countFileRowsUnderOtherKey (rewriteEncryptedFields.js) counts a version
  // row by encryptionKeyId after a key rotation.
  static envelopeOf(data = {}) {
    return {
      encryptionAlgorithm: data.encryptionAlgorithm ?? null,
      encryptionKeyId: data.encryptionKeyId ?? null,
      encryptionIv: data.encryptionIv ?? null,
      encryptionTag: data.encryptionTag ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of REQUIRED) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para DataFileVersion (1..1)`);
    }
    if (!fields.createdAt || Number.isNaN(fields.createdAt.getTime())) {
      throw new Error('createdAt deve ser uma data ISO 8601');
    }
    if (!Number.isInteger(fields.versionNumber) || fields.versionNumber < 1) {
      throw new Error(`versionNumber deve ser um inteiro >= 1: ${fields.versionNumber}`);
    }
    if (!SHA256_HEX.test(fields.checksum)) {
      throw new Error('checksum deve ser um SHA-256 em hexadecimal minúsculo (V2E-0350)');
    }
    if (fields.versionNumber === 1 && fields.previousVersionId) {
      throw new Error('a versão 1 não tem previousVersionId (V2E-0351)');
    }
    if (fields.versionNumber > 1 && !fields.previousVersionId) {
      throw new Error('previousVersionId é obrigatório a partir da versão 2 (V2E-0351)');
    }
    // BaseRecord ELM-0021 (retentionPolicyId, 0..1): the retained binary of a
    // version is governed by its DataFile's policy (#1321). Kept out of
    // fieldsOf, which lists DataFileVersion's own catalog fields.
    return { ...fields, ...this.envelopeOf(data), retentionPolicyId: optionalString(data.retentionPolicyId) };
  }
}

module.exports = DataFileVersionModel;
