class CheckStorageBoxIntegrityUseCase {
  /**
   * @param {{ topologyReadRepository: import('../ports/IStorageTopologyReadRepository') }} deps
   */
  constructor({ topologyReadRepository }) {
    this.topologyReadRepository = topologyReadRepository;
  }

  /**
   * @param {{ boxId: string }} query
   */
  async execute(query) {
    if (!query?.boxId) {
      throw new Error('boxId é obrigatório');
    }

    return this.topologyReadRepository.checkBoxIntegrity({
      boxId: query.boxId
    });
  }
}

module.exports = CheckStorageBoxIntegrityUseCase;
