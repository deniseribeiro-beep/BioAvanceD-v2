/**
 * Caso de uso: obter localização de armazenamento da amostra.
 */
class GetSampleStorageLocationUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository') }} deps
   */
  constructor({ storageRepository }) {
    this.storageRepository = storageRepository;
  }

  /**
   * @param {{ specimenId: string }} query
   */
  async execute(query) {
    if (!query?.specimenId) {
      throw new Error('specimenId é obrigatório');
    }

    return this.storageRepository.getSampleStorageLocation({
      specimenId: query.specimenId
    });
  }
}

module.exports = GetSampleStorageLocationUseCase;
