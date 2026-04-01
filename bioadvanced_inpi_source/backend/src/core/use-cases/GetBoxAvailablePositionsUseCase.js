/**
 * Caso de uso: obter posições disponíveis de uma caixa.
 */
class GetBoxAvailablePositionsUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository') }} deps
   */
  constructor({ storageRepository }) {
    this.storageRepository = storageRepository;
  }

  /**
   * @param {{ boxId: string }} query
   */
  async execute(query) {
    if (!query?.boxId) {
      throw new Error('boxId é obrigatório');
    }

    const result = await this.storageRepository.getBoxAvailablePositions({
      boxId: query.boxId
    });

    if (!result) {
      throw new Error('StorageBox não encontrada');
    }

    return result;
  }
}

module.exports = GetBoxAvailablePositionsUseCase;
