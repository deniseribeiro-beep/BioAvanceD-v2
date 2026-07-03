import { describe, it, expect, vi } from 'vitest';

const GetFreezerOccupancyStatsUseCase = require('../../src/core/use-cases/GetFreezerOccupancyStatsUseCase');

function makeUseCase(getFreezerOccupancyStatsImpl) {
  const topologyReadRepository = {
    getFreezerOccupancyStats: vi.fn(getFreezerOccupancyStatsImpl)
  };
  const useCase = new GetFreezerOccupancyStatsUseCase({ topologyReadRepository });
  return { useCase, topologyReadRepository };
}

describe('GetFreezerOccupancyStatsUseCase', () => {
  it('returns the occupancy stats computed by the repository on the happy path', async () => {
    const stats = { freezerId: 'fz-1', occupied: 10, total: 20 };
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve(stats)
    );

    const result = await useCase.execute({ freezerId: 'fz-1' });

    expect(result).toBe(stats);
    expect(topologyReadRepository.getFreezerOccupancyStats).toHaveBeenCalledTimes(1);
    expect(topologyReadRepository.getFreezerOccupancyStats).toHaveBeenCalledWith({
      freezerId: 'fz-1'
    });
  });

  it('throws when freezerId is missing from the query', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute({})).rejects.toThrow('freezerId é obrigatório');
    expect(topologyReadRepository.getFreezerOccupancyStats).not.toHaveBeenCalled();
  });

  it('throws when the query object itself is missing', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve({})
    );

    await expect(useCase.execute(undefined)).rejects.toThrow('freezerId é obrigatório');
    expect(topologyReadRepository.getFreezerOccupancyStats).not.toHaveBeenCalled();
  });
});
