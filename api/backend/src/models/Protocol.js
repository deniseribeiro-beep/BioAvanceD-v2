/**
 * Modelo de validação e estrutura para Protocol (RF004 AC#3, ELM-0068..0075)
 * Fase 1: apenas identidade/atributos essenciais — não o conjunto MIABIS completo.
 * Não confundir com ExtractionProtocol.js (vocabulário controlado de métodos
 * de extração usado em Sample.extractionProtocol) — este é o protocolo
 * técnico/científico vinculado a um estudo (Sample.protocolId).
 *
 * protocolVersion (ELM-0071) is deliberately a plain controlled-string
 * field, not a supersession chain — decided in #589 (RF021 AC#2). The
 * dictionary defines no versionGroupId/previousProtocolId pair for
 * Protocol the way it does for ConsentTemplate (P1X-0365/P1X-0366,
 * ConsentTemplate.js); ELM-0071 itself is "Versão formal controlada"
 * (SemVer/document control), matching FHIR PlanDefinition.version — a
 * single current-version string, not a history mechanism. Don't add a
 * versionGroupId/previousProtocolId pair here on the ConsentTemplate
 * precedent without a matching dictionary entry authorizing it first.
 */
function isUri(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

class ProtocolModel {
  static validate(data) {
    const errors = [];

    if (!data.protocolId || typeof data.protocolId !== 'string' || data.protocolId.trim() === '') {
      errors.push('protocolId é obrigatório e deve ser string');
    }

    if (!data.protocolName || typeof data.protocolName !== 'string' || data.protocolName.trim() === '') {
      errors.push('protocolName é obrigatório e deve ser string');
    }

    // #1316, RF021 AC1/AC2: the type, the formal version and the protocol's
    // document are each 1..1 Core (ELM-0070, ELM-0071, ELM-0073). A version
    // is recorded as its own string, so a protocol is versioned by its
    // version and document together, never by an unnamed edit.
    for (const field of ['protocolType', 'protocolVersion']) {
      if (typeof data[field] !== 'string' || data[field].trim() === '') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!isUri(data.documentUri)) {
      errors.push('documentUri é obrigatório e deve ser uma URI');
    }

    const period = data.effectivePeriod;
    const start = period && typeof period === 'object' ? new Date(period.start) : new Date(NaN);
    const startValid = period && typeof period === 'object' && period.start !== undefined && !Number.isNaN(start.getTime());

    if (!startValid) {
      errors.push('effectivePeriod.start é obrigatório e deve ser uma data válida');
    }

    if (period && typeof period === 'object' && period.end !== undefined && period.end !== null) {
      const end = new Date(period.end);
      if (Number.isNaN(end.getTime())) {
        errors.push('effectivePeriod.end deve ser uma data válida');
      } else if (startValid && end < start) {
        errors.push('effectivePeriod.end não pode ser anterior a effectivePeriod.start');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const period = data.effectivePeriod || {};
    return {
      protocolId: data.protocolId,
      protocolName: data.protocolName,
      protocolType: data.protocolType,
      protocolVersion: data.protocolVersion,
      documentUri: data.documentUri,
      intendedUse: data.intendedUse ?? null,
      approvalStatus: data.approvalStatus || 'approved',
      effectivePeriod: {
        start: period.start !== undefined ? new Date(period.start) : null,
        end: period.end !== undefined && period.end !== null ? new Date(period.end) : null
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ProtocolModel;
