/**
 * Modelo de validação e estrutura para ExtractionProtocol
 */
class ExtractionProtocolModel {
  static validate(data) {
    const errors = [];

    // protocolID é opcional - será gerado automaticamente se não fornecido
    if (data.protocolID !== undefined && data.protocolID !== null) {
      if (typeof data.protocolID !== 'number') {
        errors.push('protocolID deve ser um número');
      }
    }

    if (!data.description || typeof data.description !== 'string') {
      errors.push('description é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      protocolID: data.protocolID,
      description: data.description,
      code: data.code || null, // Código do protocolo se aplicável
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ExtractionProtocolModel;

