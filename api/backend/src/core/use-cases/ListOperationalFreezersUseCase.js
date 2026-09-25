class ListOperationalFreezersUseCase {
  /**
   * @param {{ topologyReadRepository: import('../ports/IStorageTopologyReadRepository') }} deps
   */
  constructor({ topologyReadRepository }) {
    this.topologyReadRepository = topologyReadRepository;
  }

  /**
   * @param {{ scopeFilter?: object }} [query] - #1211: extra query terms bounding the list to the caller's organizations
   */
  async execute({ scopeFilter = {} } = {}) {
    return this.topologyReadRepository.listOperationalFreezers(scopeFilter);
  }
}

module.exports = ListOperationalFreezersUseCase;
