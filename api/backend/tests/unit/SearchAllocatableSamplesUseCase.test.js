import { describe, it, expect, vi } from 'vitest';

const SearchAllocatableSamplesUseCase = require('../../src/core/use-cases/SearchAllocatableSamplesUseCase');

function makeUseCase(searchAllocatableSampleCandidatesImpl, enrichSamplesWithConsentImpl) {
  const storageRepository = {
    searchAllocatableSampleCandidates: vi.fn(searchAllocatableSampleCandidatesImpl)
  };
  const patientConsentReadRepository = {
    enrichSamplesWithConsent: vi.fn(enrichSamplesWithConsentImpl)
  };
  const useCase = new SearchAllocatableSamplesUseCase({
    storageRepository,
    patientConsentReadRepository
  });
  return { useCase, storageRepository, patientConsentReadRepository };
}

describe('SearchAllocatableSamplesUseCase', () => {
  it('searches candidates then enriches them with consent, returning the enriched result', async () => {
    const candidates = [{ sampleId: 's1' }];
    const enriched = [{ sampleId: 's1', consent: true }];
    const { useCase, storageRepository, patientConsentReadRepository } = makeUseCase(
      () => Promise.resolve(candidates),
      () => Promise.resolve(enriched)
    );

    const result = await useCase.execute({ query: 'abc' });

    expect(result).toBe(enriched);
    expect(storageRepository.searchAllocatableSampleCandidates).toHaveBeenCalledWith({
      query: 'abc',
      scopeFilter: {}
    });
    expect(patientConsentReadRepository.enrichSamplesWithConsent).toHaveBeenCalledWith(
      candidates
    );

    const searchOrder =
      storageRepository.searchAllocatableSampleCandidates.mock.invocationCallOrder[0];
    const enrichOrder =
      patientConsentReadRepository.enrichSamplesWithConsent.mock.invocationCallOrder[0];
    expect(searchOrder).toBeLessThan(enrichOrder);
  });

  it('defaults the query string to empty when query is missing', async () => {
    const { useCase, storageRepository, patientConsentReadRepository } = makeUseCase(
      () => Promise.resolve([]),
      () => Promise.resolve([])
    );

    await useCase.execute(undefined);

    expect(storageRepository.searchAllocatableSampleCandidates).toHaveBeenCalledWith({
      query: '',
      scopeFilter: {}
    });
  });

  it('defaults the query string to empty when query.query is missing', async () => {
    const { useCase, storageRepository } = makeUseCase(
      () => Promise.resolve([]),
      () => Promise.resolve([])
    );

    await useCase.execute({});

    expect(storageRepository.searchAllocatableSampleCandidates).toHaveBeenCalledWith({
      query: '',
      scopeFilter: {}
    });
  });
});
