/**
 * Modelo de validação e estrutura para SampleWithQualityDescription
 * Baseado no Diagrama de Classes
 */
class QualityDescriptionModel {
  static validate(data) {
    const errors = [];

    // qualityID e opcional - quando ausente, o POST o preenche via o parametro
    // generateId de createMasterDataRouter (master-data.routes.js), montado
    // em app.js. #899: o default do factory e randomUUID (uuid, conforme o
    // dict-02 para as entidades que ele cobre), mas ESTA entidade nao esta no
    // dict-02 e exige number aqui -- por isso app.js passa um generateId
    // numerico so para ela. Qual das formas concorrentes (codigo MIABIS no
    // campo `id` do seed, number, uuid) deve valer continua em aberto: #899.
    // Nao existe gerador sequencial: #776 removeu qualityIDGenerator,
    // que nenhum caminho de src/ chamava.
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

