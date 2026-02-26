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
   * @param {{ sampleId: string }} query
   */
  async execute(query) {
    if (!query?.sampleId) {
      throw new Error('sampleId é obrigatório');
    }

    return this.storageRepository.getSampleStorageLocation({
      sampleId: query.sampleId
    });
  }
}

module.exports = GetSampleStorageLocationUseCase;
