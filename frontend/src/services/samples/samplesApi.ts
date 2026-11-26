import { sampleService } from '../api';
import { Sample } from '@/types/models';

export type TemplateFormat = 'csv' | 'xlsx';

export const samplesApi = {
  getAll: (params?: { limit?: number; skip?: number; specimenId?: string; participantId?: string; sampleType?: string }) =>
    sampleService.getAll(params),
  getResults: (id: number) => sampleService.getResults(id),
  create: (data: Partial<Sample>) => sampleService.create(data),
  update: (id: number | string, data: Partial<Sample>) => sampleService.update(id, data),
  remove: (id: number | string) => sampleService.delete(id),
  getTemplateInfo: (format: TemplateFormat) => {
    const fileName = format === 'csv' ? 'samples-template.csv' : 'samples-template.xlsx';
    return {
      fileName,
      url: `/import-templates/${fileName}`,
    };
  },
};
