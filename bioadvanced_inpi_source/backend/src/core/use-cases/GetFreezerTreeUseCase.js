class GetFreezerTreeUseCase {
  /**
   * @param {{ topologyReadRepository: import('../ports/IStorageTopologyReadRepository') }} deps
   */
  constructor({ topologyReadRepository }) {
    this.topologyReadRepository = topologyReadRepository;
  }

  /**
   * @param {{ freezerId: string }} query
   */
  async execute(query) {
    if (!query?.freezerId) {
      throw new Error('freezerId é obrigatório');
    }

    return this.topologyReadRepository.getFreezerTree({
      freezerId: query.freezerId
    });
  }
}

module.exports = GetFreezerTreeUseCase;
