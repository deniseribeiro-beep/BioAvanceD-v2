import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  sampleService: {
    getAll: vi.fn(() => 'all'),
    getResults: vi.fn(() => 'results'),
    create: vi.fn(() => 'created'),
    update: vi.fn(() => 'updated'),
    delete: vi.fn(() => 'removed'),
  },
}));

import { sampleService } from '../api';
import { samplesApi } from './samplesApi';

describe('samplesApi', () => {
  it('forwards each sample call and names the template file', () => {
    expect(samplesApi.getAll()).toBe('all');
    expect(samplesApi.getResults(3)).toBe('results');
    expect(samplesApi.create({ barcode: 'B' } as never)).toBe('created');
    expect(samplesApi.update('s1', { barcode: 'C' } as never)).toBe('updated');
    expect(samplesApi.remove('s1')).toBe('removed');
    expect(samplesApi.getTemplateInfo('csv').fileName).toBe('samples-template.csv');
    expect(samplesApi.getTemplateInfo('xlsx').url).toBe('/import-templates/samples-template.xlsx');
    expect(sampleService.getResults).toHaveBeenCalledWith(3);
  });
});
