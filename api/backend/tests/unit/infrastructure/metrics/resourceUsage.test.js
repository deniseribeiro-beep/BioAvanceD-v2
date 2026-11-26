import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { readResourceUsage } = require('../../../../src/infrastructure/metrics/resourceUsage');

// RNF015 C2 (#1468): the backend's memory and disk in use, as ratios.

const statfsOf = (stats) => async () => stats;

function deps(overrides = {}) {
  return {
    memoryUsage: () => ({ rss: 500 }),
    constrainedMemory: () => 0,
    totalmem: () => 4000,
    statfs: statfsOf({ blocks: 100, bavail: 50 }),
    ...overrides,
  };
}

describe('resourceUsage - memory', () => {
  it('divides rss by the container limit when it is below the host total', async () => {
    const { memory } = await readResourceUsage(deps({ constrainedMemory: () => 1000 }));
    expect(memory).toBe(0.5);
  });

  it('divides rss by the host total when constrainedMemory gives 0', async () => {
    const { memory } = await readResourceUsage(deps({ constrainedMemory: () => 0 }));
    expect(memory).toBe(0.125);
  });

  it('divides rss by the host total when constrainedMemory is absent', async () => {
    const { memory } = await readResourceUsage(deps({ constrainedMemory: undefined }));
    expect(memory).toBe(0.125);
  });
});

describe('resourceUsage - disk', () => {
  it('gives the share of blocks not available', async () => {
    const { disk } = await readResourceUsage(deps({ statfs: statfsOf({ blocks: 100, bavail: 25 }) }));
    expect(disk).toBe(0.75);
  });

  it('gives null when statfs throws', async () => {
    const result = await readResourceUsage(deps({ statfs: async () => { throw new Error('EPERM'); } }));
    expect(result.disk).toBeNull();
    expect(result.memory).toBe(0.125);
  });

  it('gives null when the filesystem reports no blocks', async () => {
    const { disk } = await readResourceUsage(deps({ statfs: statfsOf({ blocks: 0, bavail: 0 }) }));
    expect(disk).toBeNull();
  });
});
