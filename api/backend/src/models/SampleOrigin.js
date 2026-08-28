/**
 * Modelo de validação e estrutura para SampleOrigin
 */
class SampleOriginModel {
  static validate(data) {
    const errors = [];

    // originID é opcional - quando ausente, master-data.routes.js:53 o
    // preenche com Date.now() no POST (montado em app.js via
    // createMasterDataRouter). Não existe gerador sequencial: #776 removeu
    // originIDGenerator, que nenhum caminho de src/ chamava.
    if (data.originID !== undefined && data.originID !== null) {
      if (typeof data.originID !== 'number') {
        errors.push('originID deve ser um número');
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
      originID: data.originID,
      description: data.description,
      code: data.code || null, // Código MIABIS se aplicável
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = SampleOriginModel;

