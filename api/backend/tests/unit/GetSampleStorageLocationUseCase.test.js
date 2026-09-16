import { describe, it, expect, vi } from 'vitest';

const GetSampleStorageLocationUseCase = require('../../src/core/use-cases/GetSampleStorageLocationUseCase');

function makeUseCase(getSamplePhysicalPlacementImpl) {
  const storageRepository = {
    getSamplePhysicalPlacement: vi.fn(getSamplePhysicalPlacementImpl)
  };
  const useCase = new GetSampleStorageLocationUseCase({ storageRepository });
  return { useCase, storageRepository };
}

describe('GetSampleStorageLocationUseCase', () => {
  it('returns the storage location computed by the repository on the happy path', async () => {
    const location = { specimenId: 'sample-1', boxId: 'box-1', position: 'A1' };
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(location)
    );

    const result = await useCase.execute({ specimenId: 'sample-1' });

    expect(result).toBe(location);
    expect(storageRepository.getSamplePhysicalPlacement).toHaveBeenCalledTimes(1);
    expect(storageRepository.getSamplePhysicalPlacement).toHaveBeenCalledWith({
      specimenId: 'sample-1'
    });
  });

  it('throws when specimenId is missing from the query', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({})).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.getSamplePhysicalPlacement).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.getSamplePhysicalPlacement).not.toHaveBeenCalled();
  });
});
