/**
 * Modelo de validação e estrutura para Result (Resultados de Análise)
 */
class ResultModel {
  static validate(data) {
    const errors = [];

    if (!data.sampleID) {
      errors.push('sampleID é obrigatório');
    }

    if (!data.fileType || !['PDF', 'ZIP', 'CSV', 'RAW'].includes(data.fileType)) {
      errors.push('fileType é obrigatório e deve ser: PDF, ZIP, CSV ou RAW (Enum conforme dicionário)');
    }

    if (!data.filePath || typeof data.filePath !== 'string') {
      errors.push('filePath é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      resultID: data.resultID || null, // Int conforme dicionário
      sampleID: data.sampleID, // Referência à amostra
      fileType: data.fileType,
      filePath: data.filePath,
      description: data.description || null,
      method: data.method || null,
      responsibleResearcher: data.responsibleResearcher || null,
      fileSize: data.fileSize || null,
      uploadedAt: data.uploadedAt || new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ResultModel;

