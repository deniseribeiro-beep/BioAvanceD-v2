import { apiClient, type ApiRequestConfig } from './client';

export function uploadBatch(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  return apiClient.post('/import/batch', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export function getBatchImportStatus(jobId: string) {
  return apiClient.get(`/import/status/${encodeURIComponent(jobId)}`, {
    suppressErrorToast: true,
  } satisfies ApiRequestConfig);
}

export function stageFhirBundle(bundle: unknown) {
  return apiClient.post('/import/fhir/stage', bundle);
}
