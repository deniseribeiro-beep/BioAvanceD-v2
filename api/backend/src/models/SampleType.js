/**
 * Modelo de validação e estrutura para SampleType
 */
class SampleTypeModel {
  static validate(data) {
    const errors = [];

    // sampleTypeID é opcional - quando ausente, master-data.routes.js:53 o
    // preenche com Date.now() no POST (montado em app.js via
    // createMasterDataRouter). Não existe gerador sequencial: #776 removeu
    // sampleTypeIDGenerator, que nenhum caminho de src/ chamava.
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

