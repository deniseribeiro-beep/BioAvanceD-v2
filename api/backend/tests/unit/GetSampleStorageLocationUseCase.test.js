import { describe, it, expect, vi } from 'vitest';

const GetSampleStorageLocationUseCase = require('../../src/core/use-cases/GetSampleStorageLocationUseCase');

function makeUseCase(getSampleStorageLocationImpl) {
  const storageRepository = {
    getSampleStorageLocation: vi.fn(getSampleStorageLocationImpl)
  };
  const useCase = new GetSampleStorageLocationUseCase({ storageRepository });
  return { useCase, storageRepository };
}

describe('GetSampleStorageLocationUseCase', () => {
  it('returns the storage location computed by the repository on the happy path', async () => {
    const location = { sampleId: 'sample-1', boxId: 'box-1', position: 'A1' };
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(location)
    );

    const result = await useCase.execute({ sampleId: 'sample-1' });

    expect(result).toBe(location);
    expect(storageRepository.getSampleStorageLocation).toHaveBeenCalledTimes(1);
    expect(storageRepository.getSampleStorageLocation).toHaveBeenCalledWith({
      sampleId: 'sample-1'
    });
  });

  it('throws when sampleId is missing from the query', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({})).rejects.toThrow('sampleId é obrigatório');
    expect(storageRepository.getSampleStorageLocation).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('sampleId é obrigatório');
    expect(storageRepository.getSampleStorageLocation).not.toHaveBeenCalled();
  });
});
