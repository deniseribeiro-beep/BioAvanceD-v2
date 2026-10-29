const crypto = require('crypto');

// Canonical Data Model v2.0.0 IdentifierNamespaceRegistry (V2E-0691..0699),
// RF016 AC4: the namespace a LabelIdentifier's value belongs to
// (LabelIdentifier.namespaceRegistryId). status lists only `active` in the
// catalog, the one value accepted. effectivePeriod is half-open, [start, end).
//
// RULE-036: an activated namespace's systemUri is HTTPS, under
// bioadvanced.dev or an explicitly approved external authority, and stays
// stable while semanticVersion changes.
const STATUS_VALUES = ['active'];
const OWN_AUTHORITY = 'bioadvanced.dev';
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

class IdentifierNamespaceRegistryModel {
  static fieldsOf(data = {}) {
    const period = data.effectivePeriod || {};
    return {
      identifierNamespaceRegistryId: data.identifierNamespaceRegistryId || crypto.randomUUID(),
      namespaceKey: data.namespaceKey ?? null,
      systemUri: data.systemUri ?? null,
      authorityDomain: data.authorityDomain ?? null,
      targetTypes: Array.isArray(data.targetTypes) ? data.targetTypes.map((t) => String(t).toLowerCase()) : [],
      semanticVersion: data.semanticVersion ?? null,
      status: data.status ? String(data.status).toLowerCase() : 'active',
      effectivePeriod: {
        start: period.start ? new Date(period.start) : null,
        end: period.end ? new Date(period.end) : null,
      },
      configurationReleaseId: data.configurationReleaseId ?? null,
    };
  }

  // `approvedAuthorities`: the external hosts explicitly approved for a
  // namespace, RULE-036's exception.
  static create(data = {}, { approvedAuthorities = [] } = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['namespaceKey', 'systemUri', 'authorityDomain', 'semanticVersion', 'configurationReleaseId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para IdentifierNamespaceRegistry (1..1)`);
      }
    }
    if (!fields.targetTypes.length) {
      throw new Error('targetTypes é obrigatório para IdentifierNamespaceRegistry (1..*)');
    }
    if (!SEMVER.test(fields.semanticVersion)) {
      throw new Error(`semanticVersion não é SemVer: ${fields.semanticVersion}`);
    }
    if (!STATUS_VALUES.includes(fields.status)) {
      throw new Error(`status inválido: ${fields.status}`);
    }
    if (!fields.effectivePeriod.start) {
      throw new Error('effectivePeriod.start é obrigatório ([start, end))');
    }
    if (fields.effectivePeriod.end && fields.effectivePeriod.end <= fields.effectivePeriod.start) {
      throw new Error('effectivePeriod.end deve ser posterior a start ([start, end))');
    }
    this.assertSystemUri(fields.systemUri, approvedAuthorities);
    return fields;
  }

  // The master-data router's POST gate: a row create refuses answers its
  // message as a 422.
  static validate(data = {}, { approvedAuthorities = [] } = {}) {
    try {
      this.create(data, { approvedAuthorities });
      return { isValid: true, errors: [] };
    } catch (error) {
      return { isValid: false, errors: [error.message] };
    }
  }

  // RULE-036.
  static assertSystemUri(systemUri, approvedAuthorities = []) {
    let url;
    try {
      url = new URL(systemUri);
    } catch (error) {
      throw new Error(`systemUri inválido: ${systemUri} (RULE-036)`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`systemUri deve usar HTTPS (RULE-036): ${systemUri}`);
    }
    const host = url.hostname.toLowerCase();
    const own = host === OWN_AUTHORITY || host.endsWith(`.${OWN_AUTHORITY}`);
    if (!own && !approvedAuthorities.map((a) => String(a).toLowerCase()).includes(host)) {
      throw new Error(`systemUri fora de ${OWN_AUTHORITY} e de autoridade externa aprovada (RULE-036): ${host}`);
    }
  }

  // RULE-036: a new version keeps the namespace's URI.
  static assertStableUri(previous, next) {
    if (previous.systemUri !== next.systemUri) {
      throw new Error(`systemUri do namespace ${previous.namespaceKey} não pode mudar entre versões (RULE-036)`);
    }
  }
}

module.exports = IdentifierNamespaceRegistryModel;
module.exports.STATUS_VALUES = STATUS_VALUES;
