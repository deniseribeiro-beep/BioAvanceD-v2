import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import api from './api';
import { storageApi } from './storageApi';

const http = vi.mocked(api);

describe('storageApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the storage payload from each call', async () => {
    http.get.mockResolvedValue({ data: { success: true, data: ['ok'] } } as never);
    http.post.mockResolvedValue({ data: { success: true, sampleLocation: { position: 'A1' } } } as never);
    http.delete.mockResolvedValue({ data: { success: true } } as never);

    await expect(storageApi.searchSamples('a b')).resolves.toMatchObject({ success: true });
    await expect(storageApi.listFreezers()).resolves.toMatchObject({ success: true });
    await expect(storageApi.validatePosition('box', 'A1')).resolves.toMatchObject({ success: true });
    await expect(storageApi.allocateSample('s', 'box', 'A1')).resolves.toMatchObject({ success: true });
    await expect(storageApi.autoAssignSampleToBox('s', 'box')).resolves.toMatchObject({ success: true });
    await expect(storageApi.moveSample('s', 'box', 'B2', 'motivo', 'nota')).resolves.toMatchObject({ success: true });
    await expect(storageApi.releaseSample('s')).resolves.toMatchObject({ success: true });
    await expect(storageApi.getSampleLocation('s')).resolves.toMatchObject({ success: true });
    await expect(storageApi.getAvailablePositions('box')).resolves.toMatchObject({ success: true });
    await expect(storageApi.getFreezerTree('f')).resolves.toMatchObject({ success: true });
    await expect(storageApi.getFreezerStats('f')).resolves.toMatchObject({ success: true });
    expect(http.get).toHaveBeenCalledWith('/storage/samples/search?q=a%20b');
  });

  it('returns a failed result when the storage call is refused', async () => {
    const refused = { response: { data: { error: 'CHEIO', message: 'Sem vaga' } }, message: 'no' };
    http.get.mockRejectedValue(refused);
    http.post.mockRejectedValue(refused);
    http.delete.mockRejectedValue(new Error('rede'));

    await expect(storageApi.searchSamples('x')).resolves.toMatchObject({ success: false, error: 'CHEIO', data: [] });
    await expect(storageApi.listFreezers()).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.validatePosition('b', '1')).resolves.toMatchObject({ available: false, message: 'Sem vaga' });
    await expect(storageApi.allocateSample('s', 'b', '1')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.autoAssignSampleToBox('s', 'b')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.moveSample('s', 'b', '2')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.releaseSample('s')).resolves.toMatchObject({ error: 'RELEASE_ERROR', message: 'rede' });
    await expect(storageApi.getSampleLocation('s')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.getAvailablePositions('b')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.getFreezerTree('f')).resolves.toMatchObject({ error: 'CHEIO' });
    await expect(storageApi.getFreezerStats('f')).resolves.toMatchObject({ error: 'CHEIO' });
  });
});
