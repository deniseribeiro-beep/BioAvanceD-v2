class ListOperationalFreezersUseCase {
  /**
   * @param {{ topologyReadRepository: import('../ports/IStorageTopologyReadRepository') }} deps
   */
  constructor({ topologyReadRepository }) {
    this.topologyReadRepository = topologyReadRepository;
  }

  async execute() {
    return this.topologyReadRepository.listOperationalFreezers();
  }
}

module.exports = ListOperationalFreezersUseCase;
