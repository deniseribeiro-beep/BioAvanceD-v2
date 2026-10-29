class SearchAllocatableSamplesUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository'), patientConsentReadRepository: import('../ports/IPatientConsentReadRepository') }} deps
   */
  constructor({ storageRepository, patientConsentReadRepository }) {
    this.storageRepository = storageRepository;
    this.patientConsentReadRepository = patientConsentReadRepository;
  }

  /**
   * @param {{ query: string }} query
   */
  async execute(query) {
    const candidates = await this.storageRepository.searchAllocatableSampleCandidates({
      query: query?.query || '',
      scopeFilter: query?.scopeFilter || {}
    });

    return this.patientConsentReadRepository.enrichSamplesWithConsent(candidates);
  }
}

module.exports = SearchAllocatableSamplesUseCase;
