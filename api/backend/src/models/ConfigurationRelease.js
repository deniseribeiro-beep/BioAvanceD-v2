/**
 * ConfigurationRelease (RF014 AC2/AC4, CFG-004; dict v2.0.0 V2E-0032..0041):
 * one immutable snapshot of a ConfigurationProfile's settings. Every change
 * is a new release; a release's settings and checksum are never rewritten.
 * Only its lifecycle moves (`active` to `superseded`, closing its
 * effectivePeriod), and the plan's F1.2 gate allows one active release per
 * profile (plano §4: "Uma release ativa por ambiente").
 */
const crypto = require('crypto');

// V2E-0040's extraction keeps `draft` as the vocabulary and `active` as the
// example. The set is CanonicalModelRelease's releaseStatus (V2E-0003), the
// one release lifecycle the same v2.0.0 governance block spells out in full.
// Inference from that sibling, not a quoted list.
const STATUSES = ['draft', 'candidate', 'approved', 'active', 'superseded', 'retired'];

// Stable JSON: keys sorted at every level, so the checksum names the
// settings and not the order a caller happened to build them in.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// V2E-0035 "SHA-256", with the dictionary example's `sha256:` prefix.
function settingsChecksum(settings) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(settings)).digest('hex')}`;
}

class ConfigurationReleaseModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      configurationReleaseId: data.configurationReleaseId,
      profileId: data.profileId,
      semanticVersion: data.semanticVersion,
      checksum: data.checksum,
      effectivePeriod: data.effectivePeriod,
      approvedBy: data.approvedBy,
      approvedAt: data.approvedAt,
      supersedesId: data.supersedesId,
      status: data.status,
      rollbackTargetId: data.rollbackTargetId,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['configurationReleaseId', 'profileId', 'semanticVersion', 'checksum']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${STATUSES.join('|')}`);
    }
    if (!data.effectivePeriod || !(data.effectivePeriod.start instanceof Date)) {
      errors.push('effectivePeriod.start é obrigatório');
    }
    // V2E-0037/0038: "Obrigatório para ativação." A superseded release was
    // active once, so it carries them too.
    if (['active', 'superseded'].includes(data.status) && (!data.approvedBy || !(data.approvedAt instanceof Date))) {
      errors.push('approvedBy e approvedAt são obrigatórios para ativação');
    }
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      errors.push('settings deve ser um objeto');
    } else if (data.checksum && data.checksum !== settingsChecksum(data.settings)) {
      errors.push('checksum não corresponde a settings');
    }
    return { isValid: errors.length === 0, errors };
  }

  /**
   * Builds an active release. `version` is the profile's release ordinal;
   * the semanticVersion is `<version>.0.0`, since each release is a whole
   * new settings snapshot rather than a patch on the previous one.
   */
  static createActive({ profileId, settings, version, approvedBy, supersedesId = null, rollbackTargetId = null, now = new Date() } = {}) {
    const release = {
      configurationReleaseId: crypto.randomUUID(),
      profileId,
      semanticVersion: `${version}.0.0`,
      checksum: settingsChecksum(settings),
      settings,
      effectivePeriod: { start: now, end: null },
      approvedBy,
      approvedAt: now,
      supersedesId,
      status: 'active',
      rollbackTargetId,
      createdAt: now,
    };
    const { isValid, errors } = ConfigurationReleaseModel.validate(release);
    if (!isValid) throw new Error(`ConfigurationRelease inválida: ${errors.join('; ')}`);
    return release;
  }
}

module.exports = ConfigurationReleaseModel;
module.exports.STATUSES = STATUSES;
module.exports.settingsChecksum = settingsChecksum;
module.exports.canonicalJson = canonicalJson;
