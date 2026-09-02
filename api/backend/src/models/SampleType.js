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
    // numerico so para ela. Qual das formas concorrentes deve
    // valer foi RESOLVIDO em #902: o identificador de negocio canonico e o
    // codigo MIABIS que o seed escreve em `id`. O manifest declara
    // uniqueKeys: ['id'] e o seed o usa como filtro de upsert; create-db.js
    // indexa so `id`; toda consulta CHAVEADA do backend resolve por `id`
    // (import-lgpd.service.js:1376); e o dict-02 nao
    // cobre esta entidade, entao nada se sobrepoe a convencao do proprio
    // repositorio. O sampleTypeID numerico e portanto artefato write-only do
    // factory -- sua retirada e o escopo restante de #881.
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

