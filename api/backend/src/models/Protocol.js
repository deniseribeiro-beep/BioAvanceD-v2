/**
 * Modelo de validação e estrutura para Protocol (RF004 AC#3, ELM-0068..0075)
 * Fase 1: apenas identidade/atributos essenciais — não o conjunto MIABIS completo.
 * Não confundir com ExtractionProtocol.js (vocabulário controlado de métodos
 * de extração usado em Sample.extractionProtocol) — este é o protocolo
 * técnico/científico vinculado a um estudo (Sample.protocolId).
 */
class ProtocolModel {
  static validate(data) {
    const errors = [];

    if (!data.protocolId || typeof data.protocolId !== 'string' || data.protocolId.trim() === '') {
      errors.push('protocolId é obrigatório e deve ser string');
    }

    if (!data.protocolName || typeof data.protocolName !== 'string' || data.protocolName.trim() === '') {
      errors.push('protocolName é obrigatório e deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    return {
      protocolId: data.protocolId,
      protocolName: data.protocolName,
      protocolVersion: data.protocolVersion || null,
      approvalStatus: data.approvalStatus || 'approved',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ProtocolModel;
