import { describe, it, expect, vi } from 'vitest';

const GetFreezerTreeUseCase = require('../../src/core/use-cases/GetFreezerTreeUseCase');

function makeUseCase(getFreezerTreeImpl) {
  const topologyReadRepository = {
    getFreezerTree: vi.fn(getFreezerTreeImpl)
  };
  const useCase = new GetFreezerTreeUseCase({ topologyReadRepository });
  return { useCase, topologyReadRepository };
}

describe('GetFreezerTreeUseCase', () => {
  it('returns the freezer tree computed by the repository on the happy path', async () => {
    const tree = { freezerId: 'fz-1', children: [] };
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve(tree)
    );

    const result = await useCase.execute({ freezerId: 'fz-1' });

    expect(result).toBe(tree);
    expect(topologyReadRepository.getFreezerTree).toHaveBeenCalledTimes(1);
    expect(topologyReadRepository.getFreezerTree).toHaveBeenCalledWith({
      freezerId: 'fz-1'
    });
  });

  it('throws when freezerId is missing from the query', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({})).rejects.toThrow('freezerId é obrigatório');
    expect(topologyReadRepository.getFreezerTree).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('freezerId é obrigatório');
    expect(topologyReadRepository.getFreezerTree).not.toHaveBeenCalled();
  });
});
