/**
 * Modelo de validação e estrutura para Study (RF004 AC#3, ELM-0053..0067)
 * Fase 1: apenas identidade/atributos essenciais — não o conjunto MIABIS completo.
 */
class StudyModel {
  static validate(data) {
    const errors = [];

    if (!data.studyId || typeof data.studyId !== 'string' || data.studyId.trim() === '') {
      errors.push('studyId é obrigatório e deve ser string');
    }

    if (!data.studyTitle || typeof data.studyTitle !== 'string' || data.studyTitle.trim() === '') {
      errors.push('studyTitle é obrigatório e deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    return {
      studyId: data.studyId,
      studyTitle: data.studyTitle,
      studyStatus: data.studyStatus || 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = StudyModel;
