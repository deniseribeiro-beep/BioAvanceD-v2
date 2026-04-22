/**
 * Modelo de validação e estrutura para AnalysisType (Tipos de Análise)
 */
class AnalysisTypeModel {
  static slugify(value) {
    if (!value || typeof value !== 'string') return '';
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_');
  }

  static validate(data) {
    const errors = [];

    if (!data.name || typeof data.name !== 'string') {
      errors.push('name é obrigatório e deve ser string');
    }

    if (!data.code || typeof data.code !== 'string') {
      errors.push('code é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      name: data.name,
      code: data.code,
      active: data.active !== undefined ? Boolean(data.active) : true,
      createdAt: data.createdAt || new Date()
    };
  }
}

module.exports = AnalysisTypeModel;
