class GetFreezerOccupancyStatsUseCase {
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

    return this.topologyReadRepository.getFreezerOccupancyStats({
      freezerId: query.freezerId
    });
  }
}

module.exports = GetFreezerOccupancyStatsUseCase;
