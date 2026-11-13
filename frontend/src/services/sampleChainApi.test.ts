import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  default: { get: vi.fn(() => 'movements'), post: vi.fn(() => 'posted') },
}));

import api from './api';
import { sampleChainApi } from './sampleChainApi';

describe('sampleChainApi', () => {
  it('reads movements and posts a withdrawal and a return', () => {
    expect(sampleChainApi.getMovements('s1')).toBe('movements');
    expect(sampleChainApi.withdraw('s1', { reason: 'uso' })).toBe('posted');
    expect(sampleChainApi.returnSample('s1', { condition: 'intact' })).toBe('posted');
    expect(api.get).toHaveBeenCalledWith('/samples/s1/movements');
    expect(api.post).toHaveBeenCalledWith('/samples/s1/return', { condition: 'intact' });
  });
});
