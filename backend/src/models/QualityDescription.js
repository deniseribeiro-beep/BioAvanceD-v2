/**
 * Modelo de validação e estrutura para SampleWithQualityDescription
 * Baseado no Diagrama de Classes
 */
class QualityDescriptionModel {
  static validate(data) {
    const errors = [];

    // qualityID é opcional - será gerado automaticamente se não fornecido
    // Apenas valida se fornecido
    if (data.qualityID !== undefined && data.qualityID !== null) {
      if (typeof data.qualityID !== 'number') {
        errors.push('qualityID deve ser um número');
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
      qualityID: data.qualityID,
      description: data.description,
      qualityLevel: data.qualityLevel || null, // Ex: 'A', 'B', 'C'
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = QualityDescriptionModel;

