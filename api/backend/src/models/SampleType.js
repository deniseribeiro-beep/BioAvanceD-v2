/**
 * Modelo de validação e estrutura para SampleType
 */
class SampleTypeModel {
  static validate(data) {
    const errors = [];

    // sampleTypeID e opcional - quando ausente, o POST o preenche via o parametro
    // generateId de createMasterDataRouter (master-data.routes.js), montado
    // em app.js. #899: o default do factory e randomUUID (uuid, conforme o
    // dict-02 para as entidades que ele cobre), mas ESTA entidade nao esta no
    // dict-02 e exige number aqui -- por isso app.js passa um generateId
    // numerico so para ela. Qual das formas concorrentes (codigo MIABIS no
    // campo `id` do seed, number, uuid) deve valer continua em aberto: #899.
    // Nao existe gerador sequencial: #776 removeu sampleTypeIDGenerator,
    // que nenhum caminho de src/ chamava.
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

