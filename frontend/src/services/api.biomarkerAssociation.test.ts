import { afterEach, describe, expect, it, vi } from 'vitest';
import api, { biomarkerAssociationService } from './api';

// #1402 (ELM-0275..0285): the entry screen reads, creates and edits rows on
// the master-data mount, and an edit names the row by its biomarkerId.
describe('biomarkerAssociationService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the rows from the mount', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any);
    await biomarkerAssociationService.getAll();
    expect(get).toHaveBeenCalledWith('/biomarker-associations');
  });

  it('posts a new row to the mount', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    await biomarkerAssociationService.create({ contextOfUse: 'c' });
    expect(post).toHaveBeenCalledWith('/biomarker-associations', { contextOfUse: 'c' });
  });

  it('puts an edit to the row\'s encoded biomarkerId', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} } as any);
    await biomarkerAssociationService.update('a/b', { contextOfUse: 'c' });
    expect(put).toHaveBeenCalledWith('/biomarker-associations/a%2Fb', { contextOfUse: 'c' });
  });
});
