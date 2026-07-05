/**
 * Modelo de validacao e estrutura para Result (Arquivos de Analise)
 */
class ResultModel {
  static ANALYSIS_METHODS = [
    'PCR em Tempo Real',
    'Sequenciamento NGS',
    'ELISA',
    'Espectrometria de Massa',
    'Microscopia'
  ];

  static EQUIPMENT_STATUS = [
    'Calibrado',
    'Manutenção',
    'Não Verificado'
  ];

  static REAGENT_TYPES = [
    'Primer A',
    'Reagente B',
    'Kit Comercial'
  ];

  static validate(data) {
    const errors = [];

    if (!data.sampleID) {
      errors.push('sampleID é obrigatório');
    }

    if (!data.fileType || !['PDF', 'ZIP', 'CSV', 'RAW'].includes(data.fileType)) {
      errors.push('fileType é obrigatório e deve ser: PDF, ZIP, CSV ou RAW (Enum conforme dicionário)');
    }

    if (!data.resultFilePath || typeof data.resultFilePath !== 'string') {
      errors.push('resultFilePath é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      resultID: data.resultID ?? null, // Int conforme dicionário
      sampleID: data.sampleID, // Referência à amostra
      fileType: data.fileType,
      resultFilePath: data.resultFilePath,
      filePath: data.filePath ?? data.resultFilePath,
      description: data.description ?? null,
      analysisType: data.analysisType ?? null,
      method: data.method ?? null,
      responsibleResearcher: data.responsibleResearcher ?? null,
      equipmentID: data.equipmentID ?? null,
      equipmentName: data.equipmentName ?? null,
      fileSize: data.fileSize ?? null,
      uploadedAt: data.uploadedAt ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = ResultModel;

