import { describe, it, expect, vi } from 'vitest';

const GetBoxAvailablePositionsUseCase = require('../../src/core/use-cases/GetBoxAvailablePositionsUseCase');

function makeUseCase(getBoxAvailablePositionsImpl) {
  const storageRepository = {
    getBoxAvailablePositions: vi.fn(getBoxAvailablePositionsImpl)
  };
  const useCase = new GetBoxAvailablePositionsUseCase({ storageRepository });
  return { useCase, storageRepository };
}

describe('GetBoxAvailablePositionsUseCase', () => {
  it('returns the available positions computed by the repository on the happy path', async () => {
    const availablePositions = ['A1', 'A2', 'B3'];
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(availablePositions)
    );

    const result = await useCase.execute({ boxId: 'box-123' });

    expect(result).toBe(availablePositions);
    expect(storageRepository.getBoxAvailablePositions).toHaveBeenCalledTimes(1);
    expect(storageRepository.getBoxAvailablePositions).toHaveBeenCalledWith({
      boxId: 'box-123'
    });
  });

  it('throws when boxId is missing from the query', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(['A1'])
    );

    await expect(useCase.execute({})).rejects.toThrow('boxId é obrigatório');
    expect(storageRepository.getBoxAvailablePositions).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(['A1'])
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('boxId é obrigatório');
    expect(storageRepository.getBoxAvailablePositions).not.toHaveBeenCalled();
  });

  it('throws when the repository returns a falsy result (box not found)', async () => {
    const { useCase } = makeUseCase(() => Promise.resolve(null));

    await expect(useCase.execute({ boxId: 'missing-box' })).rejects.toThrow(
      'StorageBox não encontrada'
    );
  });

  it('returns an empty array as-is when the box has zero available positions', async () => {
    const { useCase } = makeUseCase(() => Promise.resolve([]));

    // An empty array is truthy in JS, so the falsy guard must not trip here.
    const result = await useCase.execute({ boxId: 'full-box' });

    expect(result).toEqual([]);
  });
});
