/**
 * Caso de uso: validar disponibilidade de posição sem alocar.
 */
class ValidateStoragePositionUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository') }} deps
   */
  constructor({ storageRepository }) {
    this.storageRepository = storageRepository;
  }

  /**
   * @param {{ boxId: string, position: string }} query
   */
  async execute(query) {
    if (!query?.boxId || !query?.position) {
      throw new Error('boxId e position são obrigatórios');
    }

    return this.storageRepository.validatePositionAvailability({
      boxId: query.boxId,
      position: query.position
    });
  }
}

module.exports = ValidateStoragePositionUseCase;
