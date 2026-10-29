/**
 * Modelo de validação e estrutura para SampleWithQualityDescription
 * Baseado no Diagrama de Classes
 */
class QualityDescriptionModel {
  static validate(data) {
    const errors = [];

    // #881: qualityID retired. The canonical business identifier is the
    // string MIABIS code the seed writes on `id`, settled by #902 -- the
    // manifest declares uniqueKeys: ['id'] and the seed uses it verbatim as
    // the upsert filter; every KEYED
    // backend lookup resolves on `id` (import-lgpd.service.js:1376). The
    // router factory (app.js) now mounts this entity with idField: 'id'
    // and no numeric generateId override, so create() below returns `id`
    // instead of a numeric key.

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
      id: data.id,
      description: data.description,
      qualityLevel: data.qualityLevel || null, // Ex: 'A', 'B', 'C'
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = QualityDescriptionModel;

