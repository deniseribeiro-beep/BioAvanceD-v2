/**
 * Caso de uso: obter o posicionamento físico atual da amostra a partir da
 * cadeia canônica v2.
 */
class GetSampleStorageLocationUseCase {
  constructor({ storageRepository }) {
    this.storageRepository = storageRepository;
  }

  async execute(query) {
    if (!query?.specimenId) throw new Error('specimenId é obrigatório');
    return this.storageRepository.getSamplePhysicalPlacement({ specimenId: query.specimenId });
  }
}

module.exports = GetSampleStorageLocationUseCase;
