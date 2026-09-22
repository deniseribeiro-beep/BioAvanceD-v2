import api from './api';

export const sampleChainApi = {
  getMovements: (specimenId: string) =>
    api.get(`/samples/${specimenId}/movements`),
  withdraw: (specimenId: string, data: any) =>
    api.post(`/samples/${specimenId}/withdraw`, data),
  returnSample: (specimenId: string, data: any) =>
    api.post(`/samples/${specimenId}/return`, data),
};
