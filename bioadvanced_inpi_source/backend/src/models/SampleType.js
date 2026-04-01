/**
 * Modelo de validação e estrutura para SampleType
 */
class SampleTypeModel {
  static validate(data) {
    const errors = [];

    // sampleTypeID é opcional - será gerado automaticamente se não fornecido
    if (data.sampleTypeID !== undefined && data.sampleTypeID !== null) {
      if (typeof data.sampleTypeID !== 'number') {
        errors.push('sampleTypeID deve ser um número');
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
      sampleTypeID: data.sampleTypeID,
      description: data.description,
      code: data.code || null, // Código MIABIS se aplicável
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = SampleTypeModel;

