import { describe, it, expect, vi } from 'vitest';

const ValidateStoragePositionUseCase = require('../../src/core/use-cases/ValidateStoragePositionUseCase');

function makeUseCase(validatePositionAvailabilityImpl) {
  const storageRepository = {
    validatePositionAvailability: vi.fn(validatePositionAvailabilityImpl)
  };
  const useCase = new ValidateStoragePositionUseCase({ storageRepository });
  return { useCase, storageRepository };
}

describe('ValidateStoragePositionUseCase', () => {
  it('returns the validation result computed by the repository on the happy path', async () => {
    const validationResult = { available: true };
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve(validationResult)
    );

    const result = await useCase.execute({ boxId: 'box-1', position: 'A1' });

    expect(result).toBe(validationResult);
    expect(storageRepository.validatePositionAvailability).toHaveBeenCalledTimes(1);
    expect(storageRepository.validatePositionAvailability).toHaveBeenCalledWith({
      boxId: 'box-1',
      position: 'A1'
    });
  });

  it('throws when boxId is missing from the query', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({ position: 'A1' })).rejects.toThrow(
      'boxId e position são obrigatórios'
    );
    expect(storageRepository.validatePositionAvailability).not.toHaveBeenCalled();
  });

  it('throws when position is missing from the query', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({ boxId: 'box-1' })).rejects.toThrow(
      'boxId e position são obrigatórios'
    );
    expect(storageRepository.validatePositionAvailability).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, storageRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow(
      'boxId e position são obrigatórios'
    );
    expect(storageRepository.validatePositionAvailability).not.toHaveBeenCalled();
  });
});
