/**
 * CanonicalModelRelease (RF012 AC2, RNF023 C1, GOV-001/GOV-002; dict v2.0.0
 * V2E-0001..0010): the approved canonical model release this build follows.
 * Documents, events and runs name it by canonicalModelReleaseId. The
 * Foundation job registers it (plano §4 F1.2 "Registrar release canônica");
 * a registered release's checksum and artifact manifest are never rewritten.
 */
const crypto = require('crypto');
const { canonicalJson } = require('./ConfigurationRelease');

// V2E-0003, quoted in full by the dictionary.
const RELEASE_STATUSES = ['draft', 'candidate', 'approved', 'active', 'superseded', 'retired'];

// V2E-0004 "SHA-256" over the artifact manifest (V2E-0009 "Artefatos e
// checksums cobertos pela release"), so the release names exactly the
// artifacts it covers.
function manifestChecksum(artifactManifest) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(artifactManifest)).digest('hex')}`;
}

class CanonicalModelReleaseModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      canonicalModelReleaseId: data.canonicalModelReleaseId,
      semanticVersion: data.semanticVersion,
      releaseStatus: data.releaseStatus,
      checksum: data.checksum,
      approvedAt: data.approvedAt,
      approvedBy: data.approvedBy,
      supersedesId: data.supersedesId,
      effectivePeriod: data.effectivePeriod,
      artifactManifest: data.artifactManifest,
      createdAt: data.createdAt,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['canonicalModelReleaseId', 'semanticVersion', 'checksum']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (data.semanticVersion && !/^\d+\.\d+\.\d+$/.test(data.semanticVersion)) {
      errors.push('semanticVersion deve ser SemVer');
    }
    if (!RELEASE_STATUSES.includes(data.releaseStatus)) {
      errors.push(`releaseStatus deve ser um de: ${RELEASE_STATUSES.join('|')}`);
    }
    if (!Array.isArray(data.artifactManifest) || data.artifactManifest.length === 0) {
      errors.push('artifactManifest deve listar ao menos um artefato');
    } else if (data.checksum && data.checksum !== manifestChecksum(data.artifactManifest)) {
      errors.push('checksum não corresponde a artifactManifest');
    }
    // V2E-0005/0006 are conditional on approval: an approved or active
    // release names who approved it and when.
    if (['approved', 'active', 'superseded'].includes(data.releaseStatus) && (!data.approvedBy || !(data.approvedAt instanceof Date))) {
      errors.push('approvedBy e approvedAt são obrigatórios para uma release aprovada');
    }
    if (!(data.createdAt instanceof Date)) {
      errors.push('createdAt é obrigatório');
    }
    return { isValid: errors.length === 0, errors };
  }

  /**
   * Builds the active release record of an approved model release.
   * `artifactManifest` is a list of `{ artifact, version, checksum }`.
   */
  static createActive({ canonicalModelReleaseId, semanticVersion, artifactManifest, approvedBy, approvedAt, now = new Date() } = {}) {
    const release = {
      canonicalModelReleaseId,
      semanticVersion,
      releaseStatus: 'active',
      checksum: manifestChecksum(artifactManifest),
      approvedAt,
      approvedBy,
      supersedesId: null,
      effectivePeriod: { start: approvedAt, end: null },
      artifactManifest,
      createdAt: now,
    };
    const { isValid, errors } = CanonicalModelReleaseModel.validate(release);
    if (!isValid) throw new Error(`CanonicalModelRelease inválida: ${errors.join('; ')}`);
    return release;
  }
}

module.exports = CanonicalModelReleaseModel;
module.exports.RELEASE_STATUSES = RELEASE_STATUSES;
module.exports.manifestChecksum = manifestChecksum;
