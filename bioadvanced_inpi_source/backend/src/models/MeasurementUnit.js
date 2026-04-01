/**
 * Modelo de validação e estrutura para SampleWithMeasurementUnit
 * Baseado no Diagrama de Classes
 */
class MeasurementUnitModel {
  static validate(data) {
    const errors = [];

    if (!data.unitID && data.unitID !== 0) {
      errors.push('unitID é obrigatório');
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
      unitID: data.unitID,
      description: data.description,
      abbreviation: data.abbreviation || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = MeasurementUnitModel;

