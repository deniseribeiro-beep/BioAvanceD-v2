import api from './api';

export const sampleChainApi = {
  getMovements: (sampleId: string) =>
    api.get(`/samples/${sampleId}/movements`),
  withdraw: (sampleId: string, data: any) =>
    api.post(`/samples/${sampleId}/withdraw`, data),
  returnSample: (sampleId: string, data: any) =>
    api.post(`/samples/${sampleId}/return`, data),
};
