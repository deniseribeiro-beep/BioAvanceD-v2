/**
 * Modelo de validação e estrutura para Collection (RF004 AC#3, ELM-0039..0052)
 * Fase 1: apenas identidade/atributos essenciais — não o conjunto MIABIS completo.
 */
class CollectionModel {
  static validate(data) {
    const errors = [];

    if (!data.collectionId || typeof data.collectionId !== 'string' || data.collectionId.trim() === '') {
      errors.push('collectionId é obrigatório e deve ser string');
    }

    if (!data.collectionName || typeof data.collectionName !== 'string' || data.collectionName.trim() === '') {
      errors.push('collectionName é obrigatório e deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    return {
      collectionId: data.collectionId,
      collectionName: data.collectionName,
      collectionStatus: data.collectionStatus || 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = CollectionModel;
