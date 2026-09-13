import { describe, it, expect, vi } from 'vitest';

const CheckStorageBoxIntegrityUseCase = require('../../src/core/use-cases/CheckStorageBoxIntegrityUseCase');

function makeUseCase(checkBoxIntegrityImpl) {
  const topologyReadRepository = {
    checkBoxIntegrity: vi.fn(checkBoxIntegrityImpl)
  };
  const useCase = new CheckStorageBoxIntegrityUseCase({ topologyReadRepository });
  return { useCase, topologyReadRepository };
}

describe('CheckStorageBoxIntegrityUseCase', () => {
  it('returns the integrity report computed by the repository on the happy path', async () => {
    const integrityReport = { boxId: 'box-1', valid: true };
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve(integrityReport)
    );

    const result = await useCase.execute({ boxId: 'box-1' });

    expect(result).toBe(integrityReport);
    expect(topologyReadRepository.checkBoxIntegrity).toHaveBeenCalledTimes(1);
    expect(topologyReadRepository.checkBoxIntegrity).toHaveBeenCalledWith({
      boxId: 'box-1'
    });
  });

  it('throws when boxId is missing from the query', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({})).rejects.toThrow('boxId é obrigatório');
    expect(topologyReadRepository.checkBoxIntegrity).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('boxId é obrigatório');
    expect(topologyReadRepository.checkBoxIntegrity).not.toHaveBeenCalled();
  });
});
