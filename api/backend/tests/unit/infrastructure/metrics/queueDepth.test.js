import { describe, it, expect, vi } from 'vitest';

const { readQueueDepths } = require('../../../../src/infrastructure/metrics/queueDepth');

// RNF015 C1/C2 (#1323): readQueueDepths is driven here by hand-built fakes, so
// no case touches Redis.

const ready = { status: 'ready' };
const never = () => new Promise(() => {});

function inputs(queue, redisClient = ready) {
  return { queues: [{ name: 'import-queue', queue }], redisClient, timeoutMs: 30 };
}

describe('#1323: readQueueDepths', () => {
  it('reports a queue never created as not_initialized', async () => {
    const [result] = await readQueueDepths(inputs(null));

    expect(result).toEqual({ name: 'import-queue', status: 'not_initialized' });
  });

  it('sends no command when the Redis client is not ready', async () => {
    const getJobCounts = vi.fn().mockResolvedValue({ waiting: 1 });

    const [result] = await readQueueDepths(inputs({ getJobCounts }, { status: 'connecting' }));

    expect(getJobCounts).not.toHaveBeenCalled();
    expect(result).toEqual({ name: 'import-queue', status: 'unavailable', reason: 'not_connected' });
  });

  it('returns the job counts from a ready client', async () => {
    const getJobCounts = vi.fn().mockResolvedValue({ waiting: 3, delayed: 1, active: 2, failed: 4, paused: 0 });

    const [result] = await readQueueDepths(inputs({ getJobCounts }));

    expect(getJobCounts).toHaveBeenCalledWith('waiting', 'delayed', 'active', 'failed', 'paused');
    expect(result).toEqual({
      name: 'import-queue',
      status: 'up',
      counts: { waiting: 3, delayed: 1, active: 2, failed: 4, paused: 0 },
    });
  });

  it('reports a read that never answers as timeout', async () => {
    const [result] = await readQueueDepths(inputs({ getJobCounts: vi.fn(never) }));

    expect(result).toEqual({ name: 'import-queue', status: 'unavailable', reason: 'timeout' });
  });

  it('reports a rejected read as unreachable, with no error text', async () => {
    const getJobCounts = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6379'));

    const [result] = await readQueueDepths(inputs({ getJobCounts }));

    expect(result).toEqual({ name: 'import-queue', status: 'unavailable', reason: 'unreachable' });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });
});
