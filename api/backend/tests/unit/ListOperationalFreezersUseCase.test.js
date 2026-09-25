import { describe, it, expect, vi } from 'vitest';

const ListOperationalFreezersUseCase = require('../../src/core/use-cases/ListOperationalFreezersUseCase');

function makeUseCase(listOperationalFreezersImpl) {
  const topologyReadRepository = {
    listOperationalFreezers: vi.fn(listOperationalFreezersImpl)
  };
  const useCase = new ListOperationalFreezersUseCase({ topologyReadRepository });
  return { useCase, topologyReadRepository };
}

describe('ListOperationalFreezersUseCase', () => {
  it('returns the freezers computed by the repository on the happy path', async () => {
    const freezers = [{ freezerId: 'fz-1' }, { freezerId: 'fz-2' }];
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.resolve(freezers)
    );

    const result = await useCase.execute();

    expect(result).toBe(freezers);
    expect(topologyReadRepository.listOperationalFreezers).toHaveBeenCalledTimes(1);
    // #1211: no scope filter means an empty one, the global caller's.
    expect(topologyReadRepository.listOperationalFreezers).toHaveBeenCalledWith({});
  });

  it('passes the organization scope filter through to the repository (#1211)', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() => Promise.resolve([]));
    const scopeFilter = { containerID: { $in: [4201, '4201'] } };

    await useCase.execute({ scopeFilter });

    expect(topologyReadRepository.listOperationalFreezers).toHaveBeenCalledWith(scopeFilter);
  });

  it('propagates errors thrown by the repository', async () => {
    const { useCase, topologyReadRepository } = makeUseCase(() =>
      Promise.reject(new Error('repository unavailable'))
    );

    await expect(useCase.execute()).rejects.toThrow('repository unavailable');
    expect(topologyReadRepository.listOperationalFreezers).toHaveBeenCalledTimes(1);
  });
});
