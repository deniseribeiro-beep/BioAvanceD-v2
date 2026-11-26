import axios, { AxiosRequestConfig } from 'axios';
import {
  Patient,
  Sample,
  Result,
  ConsentTemplate,
  PurposeCode,
  PatientConsent,
  ConsentHistory,
  Equipment,
  Temperature,
  Sensor,
  Policy,
  User,
  Access,
  Reports,
  Log,
  SampleWithMeasurementUnit,
  SampleWithQualityDescription,
  Withdrawal,
  Return,
  CidEntry,
  PhoneCodeEntry,
  Organization,
  Collection,
  CollectionGovernance,
  CollectionGovernanceApproval,
  CollectionGovernanceEvent,
  ReportTemplate,
  AccessRequest,
  AccessCheck,
  BiomarkerAssociation,
} from '../types/models';
import { clearClientSession } from '../utils/sessionCleanup';
import { fetchWithRequestId, withRequestId } from '../api/requestId';
import { installTimingReporter } from '../api/timingReporter';
import { getLanguage } from '../i18n';

// Opt-out for background/speculative requests (e.g. a prefetch for a later
// wizard step) whose failure must not force-logout the user out of an
// unrelated in-progress flow. Default (unset) keeps the existing behavior:
// any 401 attempts a refresh, then ends the session on failure.
//
// Security-reviewed (#397): only changes client-side redirect behavior for
// requests that opt in — never touches the 401 itself or backend
// authorization. Currently used by exactly one caller (ClinicalIntakeWizard's
// consent-template prefetch); re-verify this same scope reasoning before a
// second call site adopts it.
export interface ApiRequestConfig extends AxiosRequestConfig {
  suppressAuthRedirect?: boolean;
}

// #898: the shared envelope shape most JSON routes on this backend actually
// answer with -- verified directly against policy.routes.js (GET/POST/PUT),
// access.routes.js, result.routes.js, user.routes.js's /register, and
// master-data.routes.js (the router factory behind measurement-units,
// quality-descriptions, sample-types, sample-origins, extraction-protocols
// and collections). `data` is optional because several PUT handlers
// (policy.routes.js:220-223, access.routes.js:158-161,
// result.routes.js:504-507 and :591-... for link-sample) return only
// `{ success, message }` with no `data` key at all -- writing the raw
// envelope into state instead of reloading was exactly the #898 bug class.
// A single `ApiEnvelope<never>` reads as "success/message only" for those.
export type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data?: T;
};

// POST /samples/:id/close's 200 body `data` (RF026 AC7).
export type SpecimenCloseResult = {
  specimenId: string;
  previousStatus: string;
  specimenStatus: 'closed';
  quantityStatus: 'depleted';
  operationalStateDecisionId: string;
  triggerEventId: string;
};

// GET /samples/:id/graph-status's 200 body `data` (#1559).
export type SampleGraphStatus = {
  sampleId: string;
  projected: boolean;
  status: string | null;
  compromisedAt: string | null;
  compromiseFreezerKey: string | null;
  compromiseBreachedSince: string | null;
};

const NO_TOKEN_PROTECTED_REQUEST = 'NO_TOKEN_PROTECTED_REQUEST';
const TOKEN_OPTIONAL_ROUTES = [
  '/auth/login',
  '/auth/password-reset/request',
  '/auth/password-reset/reset',
  '/auth/two-factor/qr-first-login',
  '/auth/two-factor/enable-first-login',
  // #1246: the password rules, read by the reset page before any session.
  '/auth/password-policy',
  // #809: participant-facing consent-token endpoints. Whoever follows a bulk
  // consent invitation has no account and no session -- the 64-char token in
  // the emailed link is the credential. Without these entries the request
  // interceptor below cancels the call and redirects to /login, which is the
  // same auth wall #809 exists to remove, just relocated from ProtectedRoute
  // into this client. Both routes are public on the backend too
  // (routes/eConsent.js:246-247, no `authenticate`).
  '/e-consent/consent-tokens/validate',
  '/e-consent/consent-tokens/accept',
  '/e-consent/consent-tokens/revoke',
  '/e-consent/consent-tokens/signed-tcle',
  '/e-consent/govbr',
  // #822: the other two participant-facing pages, on the JWT token system.
  // Same reasoning as the pair above -- EConsentPage and EConsentImportPage
  // are entered by emailed link, so the visitor has no session and the token
  // in the URL is the credential. All four backend routes are public
  // (routes/eConsent.js:38, 78, 187, 206 -- no `authenticate` middleware).
  // The import pair is matched by prefix: `/import/fhir/consent/:token` and
  // `.../accept` both contain this substring.
  '/e-consent/validate',
  '/e-consent/update',
  '/e-consent/import/fhir/consent',
];

let isRedirectingToLogin = false;
let refreshPromise: Promise<string | null> | null = null;

function isTokenOptionalRoute(url = ''): boolean {
  return TOKEN_OPTIONAL_ROUTES.some((route) => url.includes(route));
}

function terminateSessionAndRedirect() {
  if (isRedirectingToLogin) {
    return;
  }

  isRedirectingToLogin = true;
  clearClientSession({ redirectToLogin: true });
}

// Função para detectar automaticamente a URL base da API
function getApiBaseUrl(): string {
  // Se houver variável de ambiente configurada, usa ela
  if (import.meta.env.VITE_API_BASE_URL) {
    const url = import.meta.env.VITE_API_BASE_URL;
    // Garante que termina com /api se não terminar
    return url.endsWith('/api') ? url : `${url}/api`;
  }
  
  // Detecta o hostname atual da página
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const currentPort = window.location.port;
  
  // Tenta obter porta do localStorage (salva quando backend usa porta alternativa)
  const savedPortRaw = localStorage.getItem('api_port');
  const normalizedSavedPort = savedPortRaw && /^\d+$/.test(savedPortRaw) ? savedPortRaw : null;

  // Evita usar porta inválida ou a própria porta do frontend (ex.: 8080),
  // que causa 404 ao chamar /api/* no servidor do front.
  const shouldIgnoreSavedPort = !normalizedSavedPort || normalizedSavedPort === currentPort;
  const apiPort = shouldIgnoreSavedPort ? '3000' : normalizedSavedPort;

  if (shouldIgnoreSavedPort && savedPortRaw && savedPortRaw !== '3000') {
    localStorage.setItem('api_port', '3000');
  }
  
  // Se for localhost ou 127.0.0.1, usa localhost com porta configurada
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://localhost:${apiPort}/api`;
  }
  
  // Caso contrário, usa o mesmo hostname com porta configurada
  // Isso permite acesso de outros dispositivos na rede
  return `${protocol}//${hostname}:${apiPort}/api`;
}

const API_BASE_URL = getApiBaseUrl();

// Log para debug (apenas em desenvolvimento)
if (import.meta.env.DEV) {
  console.log('🔗 API Base URL:', API_BASE_URL);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 segundos de timeout
});

// Interceptor para adicionar token em todas as requisições
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    const url = config.url || '';

    if (!token && !isTokenOptionalRoute(url)) {
      const error = new Error('Requisição protegida cancelada por ausência de sessão') as Error & { code?: string };
      error.code = NO_TOKEN_PROTECTED_REQUEST;
      terminateSessionAndRedirect();
      return Promise.reject(error);
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // #1422: tell the API the UI language so auth/error messages follow the
    // login-page switch, not the browser's Accept-Language fallbacks.
    config.headers['Accept-Language'] = getLanguage();
    return withRequestId(config);
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para tratamento de erros
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.code === NO_TOKEN_PROTECTED_REQUEST || axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const errorMessage = String(error?.message || '');

    if (error.code === 'ECONNREFUSED' || errorMessage.includes('Network Error')) {
      console.error('❌ Erro de conexão: Backend não está respondendo');
      
      // Tenta detectar porta alternativa (3001, 3002, etc.)
      const currentPort = parseInt(localStorage.getItem('api_port') || '3000', 10);
      if (currentPort === 3000 && !error.config?.url?.includes('/health')) {
        console.log('🔍 Tentando detectar porta alternativa do backend...');
        
        // Tenta portas alternativas comuns
        const alternativePorts = [3001, 3002, 3003, 3004, 3005];
        let foundPort = null;
        
        for (const port of alternativePorts) {
          try {
            const testUrl = `http://localhost:${port}/api/health`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);
            
            const response = await fetchWithRequestId(testUrl, {
              method: 'GET', 
              signal: controller.signal 
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
              foundPort = port;
              break;
            }
          } catch (e) {
            // Continua tentando próxima porta
          }
        }
        
        if (foundPort) {
          console.log(`✅ Backend encontrado na porta ${foundPort}`);
          localStorage.setItem('api_port', foundPort.toString());
          // Não recarrega automaticamente para evitar loop
          // Usuário pode recarregar manualmente se necessário
          return Promise.reject(new Error(`Backend encontrado na porta ${foundPort}. Recarregue a página para aplicar.`));
        }
      }
      
      console.error(`💡 Verifique se o servidor backend está rodando na porta ${currentPort}`);
      return Promise.reject(new Error(`Servidor backend não está disponível. Verifique se está rodando na porta ${currentPort}.`));
    }
    
    // Se erro 401 (não autorizado), tenta refresh do access token antes de encerrar sessão
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const isRefreshEndpoint = requestUrl.includes('/auth/refresh');
      const isRetry = Boolean(error.config?._retry);
      const suppressAuthRedirect = Boolean((error.config as ApiRequestConfig | undefined)?.suppressAuthRedirect);

      // Rotas públicas de autenticação, chamadas de refresh, e requisições
      // que explicitamente optam por não encerrar a sessão (ex.: prefetch em
      // segundo plano para uma etapa futura) não devem forçar limpeza de sessão
      if (isTokenOptionalRoute(requestUrl) || isRefreshEndpoint || suppressAuthRedirect) {
        return Promise.reject(error);
      }

      if (!isRetry) {
        try {
          if (!refreshPromise) {
            refreshPromise = api.post('/auth/refresh')
              .then((response) => {
                const newToken = response?.data?.data?.token;
                if (newToken) {
                  localStorage.setItem('token', newToken);
                  return newToken;
                }
                return null;
              })
              .finally(() => {
                refreshPromise = null;
              });
          }

          const refreshedToken = await refreshPromise;
          if (refreshedToken) {
            error.config._retry = true;
            error.config.headers = error.config.headers || {};
            error.config.headers.Authorization = `Bearer ${refreshedToken}`;
            return api.request(error.config);
          }
        } catch (refreshError) {
          // segue para limpeza de sessão abaixo
        }
      }

      terminateSessionAndRedirect();
    }
    
    return Promise.reject(error);
  }
);

// RNF001 C4 (#1469): installed last, so it times each call around the other interceptors.
installTimingReporter(api);

// ========== PATIENT SERVICES ==========
export const patientService = {
  // paciente.controller.js's listar() nests the page inside `data`
  // (`data: { patients, total, limit, skip }`), in both its "cadastro" and
  // "operacional" branches (paciente.controller.js:220-228, :255-258) --
  // `data` is never Patient[] directly.
  getAll: (params?: { limit?: number; skip?: number; patientName?: string; clinicalUnit?: string }) =>
    api.get<ApiEnvelope<{ patients: Patient[]; total: number; limit: number; skip: number }>>('/patients', { params }),
  getById: (id: number | string) => api.get<Patient>(`/patients/${id}`),
  create: (data: Partial<Patient>) => api.post<Patient>('/patients', data),
  update: (id: number | string, data: Partial<Patient>) => api.put<Patient>(`/patients/${id}`, data),
  delete: (id: number | string) => api.delete(`/patients/${id}`),
  validateID: (participantId: string) => api.post<{ valid: boolean; participantId: string }>('/patients/validate-id', { participantId }),
  findForEdit: (participantId: string) => api.post<Patient>('/patients/find-for-edit', { participantId }),
  search: (searchTerm: string) => api.get<{ patients: Patient[]; total: number }>(`/patients/search?q=${encodeURIComponent(searchTerm)}`),
  resendConsentNotification: (participantId: string) => api.post(`/patients/${participantId}/consent/resend`),
};

export const cidService = {
  search: (term: string, limit = 10, page = 1) => api.get<{ success: boolean; data: CidEntry[]; pagination?: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean; query?: string } }>('/cids/search', {
    params: { q: term, limit, page }
  })
};

export const phoneCodeService = {
  search: (term: string, limit = 20) => api.get<{ success: boolean; data: PhoneCodeEntry[] }>('/phone-codes/search', {
    params: { q: term, limit }
  })
};

// ========== SAMPLE SERVICES ==========
export const sampleService = {
  // Inventory mounts pass limit/specimenId (ui-mongo-binding); deep-links and
  // Mongo ObjectIds arrive as strings on getById from the route param (#1425).
  getAll: (params?: { limit?: number; skip?: number; specimenId?: string; participantId?: string; sampleType?: string }) =>
    api.get<ApiEnvelope<Sample[]>>('/samples', { params }),
  getById: (id: number | string) => api.get<Sample>(`/samples/${id}`),
  getComplianceGraph: (id: number | string) => api.get(`/samples/${id}/compliance-graph`),
  // #1559: the sample's projected graph status and cold-chain compromise.
  getGraphStatus: (id: number | string) => api.get<ApiEnvelope<SampleGraphStatus>>(`/samples/${id}/graph-status`),
  getByBarcode: (barcode: string) => api.get<{ sample: Sample; patient: { participantId: number; patientName: string; recordNumber: number } | null }>(`/samples/by-barcode/${encodeURIComponent(barcode)}`),
  getResults: (id: number) => api.get<ApiEnvelope<Result[]>>(`/samples/${id}/results`), // Implementa Sample.getResults()
  getMovements: (id: string) => api.get<{ success: boolean; data: any[] }>(`/samples/${id}/movements`), // Histórico de movimentações
  create: (data: Partial<Sample>) => api.post<Sample>('/samples', data),
  update: (id: number | string, data: Partial<Sample>) => api.put<Sample>(`/samples/${id}`, data),
  // RF019 AC5: leaving quarantine is an evidenced release, not an update.
  releaseQuarantine: (id: number | string, data: { evidenceIds: string[]; reason?: string | null }) =>
    api.post(`/samples/${id}/quarantine/release`, data),
  // RF026 AC7: closes a fully consumed (quantityStatus depleted) specimen;
  // 409 SPECIMEN_CLOSE_REFUSED otherwise.
  close: (id: number | string) =>
    api.post<{ success: boolean; data: SpecimenCloseResult }>(`/samples/${id}/close`, {}),
  delete: (id: number | string) => api.delete(`/samples/${id}`),
  withdraw: (sampleID: number | string, data: Partial<Withdrawal>) => 
    api.post(`/samples/${sampleID}/withdraw`, data),
  return: (sampleID: number | string, data: Partial<Return>) => 
    api.post(`/samples/${sampleID}/return`, data),
  // RF007 - Upload de arquivos de análise
  uploadFile: (sampleID: string, formData: FormData) => 
    api.post(`/samples/${sampleID}/files/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  listFiles: (sampleID: string) => 
    api.get<{ success: boolean; data: any[] }>(`/samples/${sampleID}/files`),
  downloadFile: (sampleID: string, fileID: string) => 
    api.get(`/samples/${sampleID}/files/${fileID}/download`, {
      responseType: 'blob'
    }),
  deleteFile: (sampleID: string, fileID: string) => 
    api.delete(`/samples/${sampleID}/files/${fileID}`),
  // Exportação HL7
  exportHL7v2: (sampleID: string, fileID: string) =>
    api.get(`/samples/${sampleID}/files/${fileID}/export/hl7`, {
      responseType: 'text'
    }),
  exportFHIR: (sampleID: string, fileID: string) =>
    api.get(`/samples/${sampleID}/files/${fileID}/export/fhir`),
  exportCDA: (sampleID: string, fileID: string) =>
    api.get(`/samples/${sampleID}/files/${fileID}/export/cda`, {
      responseType: 'text'
    }),
};

export const dataImportService = {
  stageFhirBundle: (payload: unknown) => api.post('/import/fhir/stage', payload),
  getFhirBatch: (batchId: string) => api.get(`/import/fhir/batches/${encodeURIComponent(batchId)}`),
  validateFhirBatch: (batchId: string) => api.post(`/import/fhir/batches/${encodeURIComponent(batchId)}/validate`),
  sendFhirBatchConsents: (batchId: string) => api.post(`/import/fhir/batches/${encodeURIComponent(batchId)}/send-consents`),
  getFhirBatchConsentStatus: (batchId: string) => api.get(`/import/fhir/batches/${encodeURIComponent(batchId)}/consent-status`),
  commitFhirBatch: (batchId: string) => api.post(`/import/fhir/batches/${encodeURIComponent(batchId)}/commit`),
  attachFhirExternalDocument: (batchId: string, recordId: string, note?: string) =>
    api.post(`/import/fhir/batches/${encodeURIComponent(batchId)}/records/${encodeURIComponent(recordId)}/external-document`, { note }),
};

// ========== RESULT SERVICES ==========
export const resultService = {
  getAll: (importJobID?: string) => {
    return api.get<ApiEnvelope<Result[]>>('/results', {
      params: importJobID ? { importJobID } : undefined
    });
  },
  getById: (id: number) => api.get<Result>(`/results/${id}`),
  upload: (formData: FormData) =>
    api.post('/results/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  create: (data: Partial<Result>) => api.post<ApiEnvelope<Result>>('/results', data), // result.routes.js:426-430
  // result.routes.js:504-507 and :591-... (link-sample) both answer
  // { success, message } with no `data` key.
  linkSample: (id: number, specimenId: string) =>
    api.put<ApiEnvelope<never>>(`/results/${id}/link-sample`, { specimenId }), // Implementa Result.linkSample()
  update: (id: number, data: Partial<Result>) => api.put<ApiEnvelope<never>>(`/results/${id}`, data),
  delete: (id: number) => api.delete(`/results/${id}`),
  download: async (id: number | string) => {
    try {
      // Usa axios com responseType: 'blob' para download de arquivos
      const response = await api.get(`/results/${id}/download`, {
        responseType: 'blob',
      });
      
      // Verifica se a resposta é realmente um blob ou se é JSON de erro
      const contentType = String(response.headers['content-type'] || '');
      
      // Se for JSON, pode ser uma resposta de erro ou redirecionamento
      if (contentType.includes('application/json')) {
        let json: any;
        try {
          // Se response.data é um Blob, converte para texto
          const text = response.data instanceof Blob 
            ? await response.data.text()
            : response.data;
          json = typeof text === 'string' ? JSON.parse(text) : text;
        } catch (parseError: any) {
          // Se não conseguir parsear, verifica se é erro HTTP
          if (response.status >= 400) {
            throw new Error('Erro ao fazer download do arquivo');
          }
          throw parseError;
        }

        // Se for redirecionamento para URL externa
        if (json?.redirect && json?.url) {
          window.open(json.url, '_blank');
          return;
        }

        // Se for erro (#1420: fora do try, o texto do servidor chega ao chamador)
        throw new Error(json?.error || json?.message || 'Erro ao fazer download do arquivo');
      }
      
      // Cria blob URL para download
      const blob = new Blob([response.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      
      // Tenta obter o nome do arquivo do header Content-Disposition
      const contentDisposition = String(response.headers['content-disposition'] || '');
      let filename = `resultado_${id}.pdf`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
          // Decodifica URI se necessário
          try {
            filename = decodeURIComponent(filename);
          } catch {
            // Se falhar, usa o nome original
          }
        }
      }
      
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error: any) {
      console.error('Erro no download:', error);
      
      // Trata diferentes tipos de erro
      if (error.response) {
        const response = error.response;
        
        // Se a resposta é um blob (pode ser JSON de erro dentro do blob)
        if (response.data instanceof Blob) {
          let errorJson: any;
          try {
            const errorText = await response.data.text();
            errorJson = JSON.parse(errorText);
          } catch {
            // Se não conseguir parsear, usa status HTTP
            throw new Error(`Erro ${response.status}: ${response.statusText || 'Erro ao fazer download do arquivo'}`);
          }
          // #1420: fora do try, o texto do servidor chega ao chamador
          throw new Error(errorJson?.error || errorJson?.message || 'Erro ao fazer download do arquivo');
        }
        
        // Se a resposta é um objeto JSON
        if (response.data && typeof response.data === 'object') {
          throw new Error(response.data.error || response.data.message || 'Erro ao fazer download do arquivo');
        }
        
        // Erro HTTP genérico
        throw new Error(response.statusText || `Erro ${response.status} ao fazer download do arquivo`);
      }
      
      // Erro de rede ou outro tipo
      throw new Error(error.message || 'Erro ao fazer download do arquivo');
    }
  },
};
// ========== ANALYSIS FILE SERVICES ==========
export const analysisFileService = {
  validateSample: (sampleIdentifier: string) =>
    api.get(`/analysis-files/validate/${sampleIdentifier}`),
  upload: (formData: FormData, onUploadProgress?: (progressEvent: any) => void) =>
    api.post('/analysis-files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
};

// ========== EQUIPMENT SERVICES ==========
export const equipmentService = {
  getAll: () => api.get<ApiEnvelope<Equipment[]>>('/equipment'),
  getById: (id: number) => api.get<Equipment>(`/equipment/${id}`),
  getAnalytical: () => api.get<ApiEnvelope<Equipment[]>>('/equipment/analytical'),
  create: (data: Partial<Equipment>) => api.post<Equipment>('/equipment', data),
  update: (id: number | string, data: Partial<Equipment>) => api.put<Equipment>(`/equipment/${id}`, data),
  delete: (id: number | string) => api.delete(`/equipment/${id}`),
};

// ========== TEMPERATURE SERVICES ==========
export const temperatureService = {
  // temperature.service.js's getTemperatureHistory nests the page inside
  // `data` (`data: { temperatures, total, limit, skip }`, temperature.
  // service.js:226) -- `data` is never Temperature[] directly.
  getAll: () => api.get<ApiEnvelope<{ temperatures: Temperature[]; total: number; limit: number; skip: number }>>('/temperature'),
  // #1391 (RF009 AC1): a reading is read from InfluxDB by its telemetryReadingId.
  getById: (telemetryReadingId: string) => api.get<ApiEnvelope<Temperature>>(`/temperature/${encodeURIComponent(telemetryReadingId)}`),
};

// ========== SENSOR SERVICES ==========
export const sensorService = {
  getAll: () => api.get<ApiEnvelope<Sensor[]>>('/sensors'),
  getById: (id: string) => api.get<Sensor>(`/sensors/${id}`),
  create: (data: Partial<Sensor>) => api.post<Sensor>('/sensors', data),
  update: (id: string, data: Partial<Sensor>) => api.put<Sensor>(`/sensors/${id}`, data),
  delete: (id: string) => api.delete(`/sensors/${id}`),
};

// ========== POLICY SERVICES ==========
export const policyService = {
  getAll: () => api.get<ApiEnvelope<Policy[]>>('/policies'),
  // #1178: `id` is the policy's _id. The API never returns a `policyID`, and
  // PUT/DELETE look up by _id only.
  getById: (id: string) => api.get<Policy>(`/policies/${id}`),
  getActiveLimit: (id: string, isMax: boolean = true) =>
    api.get<{ limit: number; type: string; unit: string }>(`/policies/${id}/active-limit`, {
      params: { type: isMax ? 'max' : 'min' }
    }), // Implementa Policy.getActiveLimit()
  create: (data: Partial<Policy>) => api.post<ApiEnvelope<Policy>>('/policies', data), // policy.routes.js:224 (#1089 moved it)
  update: (id: string, data: Partial<Policy>) => api.put<ApiEnvelope<never>>(`/policies/${id}`, data), // policy.routes.js:220-223, no data key
  delete: (id: string) => api.delete(`/policies/${id}`),
};

// ========== USER SERVICES ==========
export const userService = {
  getAll: () => api.get<ApiEnvelope<User[]>>('/users'),
  getById: (id: number) => api.get<User>(`/users/${id}`),
  register: (data: Partial<User>) => api.post<ApiEnvelope<User>>('/users/register', data), // user.routes.js:105-109
  validateStatus: (id: number) => api.get<{ status: string }>(`/users/${id}/validate-status`), // Implementa User.validateUserStatus()
  registerPatient: (data: Partial<Patient>) => api.post<Patient>('/users/register-patient', data), // Implementa User.registerPatient()
  registerSample: (data: Partial<Sample>) => api.post<Sample>('/users/register-sample', data), // Implementa User.registerSample()
  recordWithdrawal: (data: Partial<Withdrawal>) => api.post<Withdrawal>('/users/record-withdrawal', data), // Implementa User.recordSampleWithdrawal()
  generateReport: (reportType: string) => api.post<Reports>('/users/generate-report', { reportType }), // Implementa User.generateReports()
  registerSensor: (data: Partial<Sensor>) => api.post<Sensor>('/users/register-sensor', data), // Implementa User.registerSensor()
  // log.service.js's getLogs (also used by logService.getLogs below) nests
  // the page inside `data` (`data: { logs, total, page, totalPages }`,
  // log.service.js:352-359) -- `data` is never Log[] directly.
  getLogs: (filters?: any) => api.get<ApiEnvelope<{ logs: Log[]; total: number; page: number; totalPages: number }>>('/users/logs', { params: filters }), // Implementa User.getLogs()
  update: (id: number | string, data: Partial<User>) => api.put<User>(`/users/${id}`, data),
  delete: (id: number | string) => api.delete(`/users/${id}`),
  resetMFA: (id: number | string) => api.post(`/users/${id}/reset-mfa`),
  disableMFA: (id: number | string) => api.post(`/users/${id}/disable-mfa`),
  forcePasswordReset: (id: number | string) => api.post(`/users/${id}/force-password-reset`),
  // #1013: an administrator sets another user's password (off PUT /:id).
  setPassword: (id: number | string, password: string) =>
    api.post<ApiEnvelope<{ forceReset: boolean }>>(`/users/${id}/set-password`, { password }),
  // #1020 / RF003 AC#5: revoke every active session; 'risk' records a
  // suspected compromise, 'admin_action' a routine administrative revoke.
  revokeSessions: (id: number | string, reason: 'admin_action' | 'risk') =>
    api.post<{ success: boolean; data: { revoked: number; reason: string } }>(`/users/${id}/revoke-sessions`, { reason }),
  // #1358: the organizations the user's role is scoped to, beyond the home one.
  getOrganizationScopes: (id: number | string) =>
    api.get<ApiEnvelope<UserOrganizationScopes>>(`/users/${id}/organizations`),
  addOrganizationScope: (id: number | string, organizationId: string) =>
    api.post<ApiEnvelope<UserOrganizationScopes>>(`/users/${id}/organizations`, { organizationId }),
  removeOrganizationScope: (id: number | string, organizationId: string) =>
    api.delete<ApiEnvelope<UserOrganizationScopes>>(`/users/${id}/organizations/${encodeURIComponent(organizationId)}`),
};

export interface UserOrganizationScopes {
  homeOrganizationId: string | null;
  global: boolean;
  organizationIds: string[];
}

// ========== ORGANIZATION SERVICES ==========
export const organizationService = {
  // #1280: the route returns one sorted page (limit at most 500); useOrganizations pages through it.
  getAll: (params?: { limit?: number; skip?: number }) =>
    api.get<ApiEnvelope<Organization[]>>('/organizations', { params }),
  // #1354: the caller's own organization scope, for the create forms' picker.
  getMine: () =>
    api.get<ApiEnvelope<{ scope: 'global' | 'organization' | 'none' | 'unassigned'; organizations: Array<{ organizationId: string; officialName: string | null }> }>>('/organizations/mine'),
  create: (data: Partial<Organization>) => api.post<Organization>('/organizations', data),
  update: (id: string, data: Partial<Organization>) => api.put<Organization>(`/organizations/${id}`, data),
  delete: (id: string) => api.delete(`/organizations/${id}`),
};

// #726 (RF008 AC#6): admin-editable report templates, replacing
// reports.routes.js's old fixed string-matching dispatch.
export const reportTemplateService = {
  getAll: () => api.get('/report-templates'),
  getOne: (id: string) => api.get(`/report-templates/${id}`),
  create: (data: Partial<ReportTemplate>) => api.post('/report-templates', data),
  update: (id: string, data: Partial<ReportTemplate>) => api.put(`/report-templates/${id}`, data),
  delete: (id: string) => api.delete(`/report-templates/${id}`),
};

// ========== COLLECTION SERVICES (RF020, MIABIS Collection) ==========
export const collectionsService = {
  getAll: () => api.get<ApiEnvelope<Collection[]>>('/collections'),
  getById: (id: string) => api.get<Collection>(`/collections/${id}`),
  create: (data: Partial<Collection>) => api.post<Collection>('/collections', data),
  update: (id: string, data: Partial<Collection>) => api.put<Collection>(`/collections/${id}`, data),
  delete: (id: string) => api.delete(`/collections/${id}`),
};

// RF004 AC3-AC5, RF020 AC2-AC4, RF021 AC2/AC3: collection-governance.routes.js.
// The regime and context change only through recordEvent.
export const collectionGovernanceService = {
  get: (collectionId: string) =>
    api.get<ApiEnvelope<CollectionGovernance>>(`/collections/${encodeURIComponent(collectionId)}/governance`),
  createApproval: (collectionId: string, data: Record<string, unknown>) =>
    api.post<ApiEnvelope<CollectionGovernanceApproval>>(
      `/collections/${encodeURIComponent(collectionId)}/governance/approvals`, data),
  setApprovalStatus: (collectionId: string, approvalId: string, data: { status: string; reason?: string }) =>
    api.post<ApiEnvelope<CollectionGovernanceApproval>>(
      `/collections/${encodeURIComponent(collectionId)}/governance/approvals/${encodeURIComponent(approvalId)}/status`, data),
  recordEvent: (collectionId: string, data: Record<string, unknown>) =>
    api.post<ApiEnvelope<{ event: CollectionGovernanceEvent; governanceRegime: string; governanceContext: Record<string, unknown> }>>(
      `/collections/${encodeURIComponent(collectionId)}/governance/events`, data),
};

// RF024 (#1350): access and distribution requests, accessRequest.js's routes.
// Every call needs manageAccessRequests, which only Administrador holds.
export const accessRequestService = {
  getAll: () => api.get<ApiEnvelope<AccessRequest[]>>('/access-requests'),
  getById: (id: string) => api.get<ApiEnvelope<AccessRequest>>(`/access-requests/${encodeURIComponent(id)}`),
  create: (data: Record<string, unknown>) => api.post<ApiEnvelope<AccessRequest>>('/access-requests', data),
  evaluate: (id: string) => api.post<ApiEnvelope<AccessRequest>>(`/access-requests/${encodeURIComponent(id)}/evaluate`),
  decide: (id: string, data: Record<string, unknown>) =>
    api.post<ApiEnvelope<AccessRequest>>(`/access-requests/${encodeURIComponent(id)}/decision`, data),
  distribute: (id: string) => api.post<ApiEnvelope<AccessRequest>>(`/access-requests/${encodeURIComponent(id)}/distribute`),
  revoke: (id: string, data: { justification: string }) =>
    api.post<ApiEnvelope<AccessRequest>>(`/access-requests/${encodeURIComponent(id)}/revoke`, data),
  accessCheck: (id: string) => api.get<ApiEnvelope<AccessCheck>>(`/access-requests/${encodeURIComponent(id)}/access-check`),
};

// ========== ACCESS SERVICES ==========
export const accessService = {
  getAll: () => api.get<ApiEnvelope<Access[]>>('/access'),
  getById: (id: number) => api.get<Access>(`/access/${id}`),
  create: (data: Partial<Access>) => api.post<ApiEnvelope<Access>>('/access', data), // access.routes.js:100-104
  update: (id: number, data: Partial<Access>) => api.put<ApiEnvelope<never>>(`/access/${id}`, data), // access.routes.js:158-161, no data key
  delete: (id: number) => api.delete(`/access/${id}`),
};

// ========== REPORTS SERVICES ==========
export const reportsService = {
  // #898: the one exception among the api.get<X[]> sites -- reports.
  // routes.js's GET / answers `res.status(200).json(reports.map(...))`
  // (reports.routes.js:906, `#637` region), a bare array with no
  // { success, data } envelope. Left as Reports[], not ApiEnvelope<Reports[]>.
  getAll: () => api.get<Reports[]>('/reports'),
  getById: (id: number) => api.get<Reports>(`/reports/${id}`),
  generate: (reportType: string) => api.post<Reports>('/reports/generate', { reportType }), // Implementa User.generateReports()
  delete: (id: number) => api.delete(`/reports/${id}`),
  getFilters: (type: string) =>
    api.get<{ filters: any[]; reportType?: string; handlerKey?: string; name?: string; description?: string | null }>(`/reports/${encodeURIComponent(type)}/filters`),
  previewReport: (type: string, data: { filters: any }) => 
    api.post<any>(`/reports/${encodeURIComponent(type)}/preview`, data),
  exportReport: (type: string, format: 'csv' | 'pdf', filters?: any) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
          params.append(key, filters[key]);
        }
      });
    }
    const url = format === 'pdf' 
      ? `/reports/${encodeURIComponent(type)}/export/pdf?${params.toString()}`
      : `/reports/${encodeURIComponent(type)}/export?${params.toString()}`;
    return api.get(url, { responseType: format === 'csv' ? 'text' : 'json' });
  },
};

// ========== MEASUREMENT UNIT SERVICES ==========
export const measurementUnitService = {
  // master-data.routes.js (the router factory this mount uses) always
  // answers { success, data } -- including PUT, unlike policy/access/result's
  // updates (master-data.routes.js:77, :95, :140, :173).
  getAll: () => api.get<ApiEnvelope<SampleWithMeasurementUnit[]>>('/measurement-units'),
  getById: (id: number) => api.get<SampleWithMeasurementUnit>(`/measurement-units/${id}`),
  create: (data: Partial<SampleWithMeasurementUnit>) => api.post<ApiEnvelope<SampleWithMeasurementUnit>>('/measurement-units', data),
  update: (id: number, data: Partial<SampleWithMeasurementUnit>) => api.put<ApiEnvelope<SampleWithMeasurementUnit>>(`/measurement-units/${id}`, data),
  delete: (id: number) => api.delete(`/measurement-units/${id}`),
};

// ========== QUALITY DESCRIPTION SERVICES ==========
// #881: idField is now the string MIABIS `id` (settled by #902), not the
// numeric qualityID this mount used to require.
export const qualityDescriptionService = {
  getAll: () => api.get<ApiEnvelope<SampleWithQualityDescription[]>>('/quality-descriptions'),
  getById: (id: string) => api.get<SampleWithQualityDescription>(`/quality-descriptions/${id}`),
  create: (data: Partial<SampleWithQualityDescription>) => api.post<SampleWithQualityDescription>('/quality-descriptions', data),
  update: (id: string, data: Partial<SampleWithQualityDescription>) => api.put<SampleWithQualityDescription>(`/quality-descriptions/${id}`, data),
  delete: (id: string) => api.delete(`/quality-descriptions/${id}`),
};

// ========== SAMPLE TYPE SERVICES ==========
// #881: idField is now the string MIABIS `id` (settled by #902), not the
// numeric sampleTypeID this mount used to require.
export const sampleTypeService = {
  getAll: () => api.get<ApiEnvelope<any[]>>('/sample-types'),
  getById: (id: string) => api.get<any>(`/sample-types/${id}`),
  create: (data: Partial<any>) => api.post<any>('/sample-types', data),
};

// ========== ANALYSIS TYPE SERVICES ==========
export const analysisTypeService = {
  getAll: () => api.get<ApiEnvelope<any[]>>('/analysis-types'),
  create: (data: { name: string; code?: string }) => api.post<any>('/analysis-types', data),
};

// ========== SAMPLE ORIGIN SERVICES ==========
// #881: idField is now the string MIABIS `id` (settled by #902), not the
// numeric originID this mount used to require.
export const sampleOriginService = {
  getAll: () => api.get<ApiEnvelope<any[]>>('/sample-origins'),
  getById: (id: string) => api.get<any>(`/sample-origins/${id}`),
  create: (data: Partial<any>) => api.post<any>('/sample-origins', data),
};

// ========== EXTRACTION PROTOCOL SERVICES ==========
// #881: idField is now the string MIABIS `id` (settled by #902), not the
// numeric protocolID this mount used to require.
export const extractionProtocolService = {
  getAll: () => api.get<ApiEnvelope<any[]>>('/extraction-protocols'),
  getById: (id: string) => api.get<any>(`/extraction-protocols/${id}`),
  create: (data: Partial<any>) => api.post<any>('/extraction-protocols', data),
};

// ========== BIOMARKER ASSOCIATION SERVICES ==========
// ELM-0275..0285 (#1402): the mount's idField is biomarkerId, which the PUT
// matches and never writes. No delete: the screen only creates and edits.
export const biomarkerAssociationService = {
  getAll: () => api.get<ApiEnvelope<BiomarkerAssociation[]>>('/biomarker-associations'),
  create: (data: Partial<BiomarkerAssociation>) => api.post<ApiEnvelope<BiomarkerAssociation>>('/biomarker-associations', data),
  update: (biomarkerId: string, data: Partial<BiomarkerAssociation>) =>
    api.put<ApiEnvelope<BiomarkerAssociation>>(`/biomarker-associations/${encodeURIComponent(biomarkerId)}`, data),
};

// ========== LOG SERVICES ==========
export const logService = {
  getAll: () => api.get<{ success: boolean; data: { logs: Log[]; total: number } }>('/logs/all'),
  getById: (id: number | string) => api.get<{ success: boolean; data: Log }>(`/logs/${id}`),
  getLogs: (filters?: any) => api.get<{ success: boolean; data: { logs: Log[]; total: number; page: number; totalPages: number } }>('/logs', { params: filters }),
  queryLogs: (filters: any) => api.post<{ success: boolean; data: { logs: Log[]; total: number; page: number; totalPages: number } }>('/logs/query', filters),
  exportExcel: (filters?: any) => api.get('/logs/export/xlsx', { params: filters, responseType: 'blob' }),
  // #1005: every user's sessions, revoked ones included, pseudonymised.
  getSessions: (filters?: SessionAuditFilters) =>
    api.get<{ success: boolean; data: SessionAuditPage }>('/logs/sessions', { params: filters }),
};

export type SessionRevocationReason = 'user_request' | 'admin_action' | 'password_change' | 'risk' | 'expiration';

export interface SessionAuditFilters {
  revocationReason?: SessionRevocationReason | '';
  isRevoked?: 'true' | 'false' | '';
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface SessionAuditRow {
  id: string | null;
  user: string;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  createdAt: string | null;
  lastActivity: string | null;
  expiresAt: string | null;
  isActive: boolean;
  isRevoked: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: SessionRevocationReason | null;
}

export interface SessionAuditPage {
  sessions: SessionAuditRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ========== AUDIT SERVICES ==========
export const auditService = {
  getReport: (date: string, hash?: string) =>
    api.get<{ success: boolean; data: any }>(`/audit/report/${date}`, {
      params: hash ? { hash } : undefined
    }),
  verify: (hash: string, proof: any[], root: string) =>
    api.post<{ success: boolean; verified: boolean }>('/audit/verify', { hash, proof, root })
};

// ========== AUTH SERVICES ==========
export const authService = {
  login: (username: string, password: string, twoFactorCode?: string, newPassword?: string) =>
    api.post('/auth/login', { username, password, twoFactorCode, newPassword }),
  logout: () => api.post('/auth/logout'),
  getSessions: () => api.get('/auth/sessions'),
  revokeSession: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
  revokeAllOtherSessions: () => api.delete('/auth/sessions/all-others'),
  verifyToken: async () => {
    try {
      return await api.get('/auth/verify');
    } catch (error: any) {
      if (Number(error?.response?.status || 0) === 404) {
        const keepAliveResponse = await api.post('/auth/keepalive');
        return {
          ...keepAliveResponse,
          data: {
            success: true,
            data: {
              valid: true
            }
          }
        } as any;
      }
      throw error;
    }
  },
  keepAlive: () => api.post('/auth/keepalive'),
  // 2FA endpoints
  generateTwoFactorQR: () => api.get('/auth/two-factor/qr'),
  enableTwoFactor: (code: string) => api.post('/auth/two-factor/enable', { code }),
  disableTwoFactor: (password: string) => api.post('/auth/two-factor/disable', { password }),
  getTwoFactorStatus: () => api.get('/auth/two-factor/status'),
  // 2FA endpoints para primeiro login (não requerem autenticação)
  generateTwoFactorQRFirstLogin: (username: string, password: string) => 
    api.post('/auth/two-factor/qr-first-login', { username, password }),
  enableTwoFactorFirstLogin: (code: string, username: string, password: string) => 
    api.post('/auth/two-factor/enable-first-login', { code, username, password }),
  // #1246: passwordRules strength keys in force (no session needed)
  getPasswordPolicy: () => api.get('/auth/password-policy'),
  // Recuperação de senha
  requestPasswordReset: (email: string) => 
    api.post('/auth/password-reset/request', { email }),
  resetPassword: (token: string, newPassword: string) => 
    api.post('/auth/password-reset/reset', { token, newPassword }),
};

// ========== IMPORT SERVICES ==========
export const importService = {
  batchImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/import/batch', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getBatchImportStatus: (jobId: string) => api.get(`/import/batch/${jobId}`),

  // Método síncrono (mantido para compatibilidade)
  uploadFile: (file: File, dataType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('dataType', dataType);
    return api.post('/import/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  listJobs: (params?: { status?: string; dataType?: string; limit?: number; skip?: number }) =>
    api.get('/import/jobs', { params }),

  getImportReport: (jobID: string) => api.get(`/import/job/${jobID}/report`),
};

// ========== BACKUP SERVICES ==========
export const backupService = {
  performBackup: () => api.post('/backup/perform'),
  listBackups: () => api.get('/backup/list'),
  restoreBackup: (fileName: string) => api.post(`/backup/restore/${fileName}`),
};

// #728 (RF013 AC#5/AC#6): admin-editable backup policy (retention/
// frequency/encryption/RPO/RTO), distinct from the operational
// perform/list/restore calls above.
export const backupPolicyService = {
  getPolicy: () => api.get('/backup-policy'),
  updatePolicy: (data: any) => api.put('/backup-policy', data),
};

// ========== CONSENT SERVICES ==========
// TCLE builder should use only ConsentTemplate endpoints for create/update/read
export const consentService = {
  createTemplate: (data: Partial<ConsentTemplate>) => api.post<ConsentTemplate>('/e-consent/consent-templates', data),
  getTemplates: (config?: ApiRequestConfig) => api.get<{ success: boolean; data: ConsentTemplate[] }>('/e-consent/consent-templates', config),
  getActiveTemplate: () => api.get<{ success: boolean; data: ConsentTemplate | null; source?: string; message?: string }>('/e-consent/consent-templates/current'),
  getTemplateById: (id: string) => api.get<{ success: boolean; data: ConsentTemplate }>(`/e-consent/consent-templates/${id}`),
  updateTemplate: (id: string, data: Partial<ConsentTemplate>) => api.put<{ success: boolean; data: ConsentTemplate }>(`/e-consent/consent-templates/${id}`, data),
  // #1349: the active DUO purposes a term's permission may name.
  getPurposeCodes: () => api.get<{ success: boolean; data: PurposeCode[] }>('/e-consent/purpose-codes'),
  // The following endpoints are for legacy or other flows, not for TCLE builder:
  // createPolicy: (data: Partial<ConsentPolicy>) => api.post<ConsentPolicy>('/consent-policies', data),
  // updatePolicy: (id: string, data: Partial<ConsentPolicy>) => api.put<{ success: boolean; data: ConsentPolicy }>(`/consent-policies/${id}`, data),
  // getActivePolicy: () => api.get<{ success: boolean; data: ConsentPolicy }>('/consent-policies/active'),
  // getActivePoliciesWithCaae: () => api.get<{ success: boolean; data: ConsentPolicy[] }>('/consent-policies/active-with-caae'),
  // getPoliciesHistory: (params?: { page?: number; limit?: number; search?: string; groupId?: string }) => api.get<{ success: boolean; data: ConsentPolicy[]; pagination?: { page: number; limit: number; total: number; totalPages: number } }>('/consent-policies/history', { params }),
  // getAllPolicies: () => api.get<{ success: boolean; data: ConsentPolicy[] }>('/consent-policies'),
  createPatientConsent: (data: {
    participantId: string;
    templateId: string;
    consentTemplateId?: string;
    responses: Record<string, boolean>;
    signatureName?: string;
    signatureImageBase64?: string;
    signatureMimeType?: string;
    collectionPlace?: string;
    location?: {
      status: 'unavailable' | 'captured';
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number | null;
      capturedAt?: string | null;
    };
  }) => api.post<PatientConsent>('/e-consent/consents', data),
  // RF010 AC6 (#1375): `consentId` is the consent's Mongo _id. No scope means
  // the whole consent; a scope names the permission codes to withdraw.
  revokeConsent: (consentId: string, request: { scope?: string[]; reason?: string } = {}) =>
    api.post<{ success: boolean; data: PatientConsent }>(`/e-consent/consents/${consentId}/revoke`, request),
  getConsentHistory: (consentId: string) =>
    api.get<{ success: boolean; data: ConsentHistory }>(`/e-consent/consents/${consentId}/history`),
  getPatientConsent: (participantId: string) => api.get<{ success: boolean; data: PatientConsent }>(`/patients/${participantId}/consent`),
  getSignedTcle: (consentId: string) =>
    api.get<Blob>(`/e-consent/consents/${consentId}/signed-tcle`, { responseType: 'blob' }),
};

// #809: the bulk consent-token pair, consumed by ConsentTokenPage. Unlike the
// rest of consentService these are unauthenticated -- see
// TOKEN_OPTIONAL_ROUTES above. They deliberately use the shared `api` client
// rather than raw relative axios: nothing proxies /api on the frontend origin
// in dev, test or prod, so a relative URL returns the SPA's index.html (#822).
export type ConsentTokenTemplatePayload = {
  id: string;
  title: string;
  content: string;
  version: string | null;
  permissions: Array<{ key: string; label: string; required?: boolean }>;
};

export const consentTokenService = {
  validate: (participantId: string, token: string) =>
    api.post<{
      success: boolean;
      data: {
        valid: boolean;
        participantId: string;
        patientStatus?: string | null;
        panel?: 'pending' | 'manage' | 'closed';
        template: ConsentTokenTemplatePayload | null;
        consent?: {
          participantId: string;
          status: string;
          currentStateDerived: string | null;
          signedAt?: string | null;
          hasSignedTcle?: boolean;
          effectivePermissions: Record<string, boolean>;
        } | null;
      };
    }>(
      '/e-consent/consent-tokens/validate',
      { patientId: participantId, token }
    ),
  // #821: the accept carries the manifestation -- the term shown and one
  // answer per purpose -- which the backend records as a Consent.
  accept: (
    participantId: string,
    token: string,
    manifestation: {
      consentTemplateId: string;
      responses: Record<string, boolean>;
      location?: ConsentPanelLocation;
      identityProof?: ConsentIdentityProof | null;
    }
  ) =>
    api.post<{
      success: boolean;
      message: string;
      data: { success: boolean; participantId: string; consentId: string; consentVersion: string | null };
    }>(
      '/e-consent/consent-tokens/accept',
      { patientId: participantId, token, ...manifestation }
    ),
  revoke: (
    participantId: string,
    token: string,
    revocation: { scope?: string[]; reason?: string; location: ConsentPanelLocation }
  ) =>
    api.post<{ success: boolean; data: { participantId: string; status: string; currentStateDerived: string | null; effectivePermissions: Record<string, boolean> } }>(
      '/e-consent/consent-tokens/revoke',
      { patientId: participantId, token, ...revocation }
    ),
  signedTcle: (participantId: string, token: string) =>
    api.post<Blob>(
      '/e-consent/consent-tokens/signed-tcle',
      { patientId: participantId, token },
      { responseType: 'blob' }
    ),
};

export type ConsentIdentityProof =
  | { provider: 'govbr'; sub: string; email?: string | null; name?: string | null; mock?: boolean; verifiedAt?: string }
  | { provider: 'icp-brasil'; certificateThumbprint: string; signedTermHash?: string; subjectDn?: string; verifiedAt?: string }
  | { provider: 'panel' };

export const govbrConsentService = {
  status: () =>
    api.get<{ enabled: boolean; issuer: string | null; mock: boolean }>('/e-consent/govbr/status'),
  start: (participantId: string, token: string) =>
    api.post<{ authorizationUrl: string; state: string }>('/e-consent/govbr/start', {
      patientId: participantId,
      participantId,
      token,
    }),
  callback: (code: string, state: string) =>
    api.get<{
      success: boolean;
      participantId: string;
      identityProof: ConsentIdentityProof;
    }>('/e-consent/govbr/callback', { params: { code, state } }),
};

export type ConsentPanelLocation =
  | { status: 'unavailable' }
  | { status: 'captured'; latitude: number; longitude: number; accuracyMeters: number | null; capturedAt: string | null };

// #822: the JWT consent-token pair behind EConsentPage, and the FHIR import
// consent pair behind EConsentImportPage. Both pages previously called raw
// axios with a relative `/api/...` URL, which resolves against the frontend
// origin -- nothing proxies /api there in dev, test or prod, so every request
// returned the SPA's index.html with a 200 and the pages rendered their
// generic "link inválido" message. Like consentTokenService above, these are
// unauthenticated and listed in TOKEN_OPTIONAL_ROUTES.
export type EConsentValidatePayload = {
  patient: { patientName?: string } | null;
  template: {
    id: string;
    title?: string;
    permissions: Array<{ key: string; label: string; required?: boolean }>;
  } | null;
  responses: Record<string, boolean>;
};

export type EConsentUpdateEntry = { key: string; status: 'ACCEPTED' | 'REVOKED' };

export type ImportConsentPayload = {
  success: boolean;
  batchId?: string;
  recordId?: string;
  participantId?: string;
  patientName?: string;
  patientEmail?: string;
  status?: string;
  consentSigned?: boolean;
};

export const eConsentService = {
  validate: (token: string) =>
    api.get<EConsentValidatePayload>(`/e-consent/validate/${encodeURIComponent(token)}`),
  update: (token: string, consents: EConsentUpdateEntry[]) =>
    api.post('/e-consent/update', { token, consents }),
  validateImportConsent: (token: string) =>
    api.get<ImportConsentPayload>(`/e-consent/import/fhir/consent/${encodeURIComponent(token)}`),
  acceptImportConsent: (token: string) =>
    api.post<ImportConsentPayload>(`/e-consent/import/fhir/consent/${encodeURIComponent(token)}/accept`),
};

// ========== IMPORT LGPD SERVICES ==========
export const importLGPDService = {
  import: (type: 'patients' | 'samples', formData: FormData) => {
    const endpoint = type === 'patients' ? '/import-lgpd/pacientes' : '/import-lgpd/amostras';
    return api.post(endpoint, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  downloadTemplate: (type: 'patients' | 'samples', format: 'csv' | 'xlsx') => {
    const endpoint = type === 'patients' 
      ? `/import-lgpd/pacientes/template/${format}`
      : `/import-lgpd/amostras/template/${format}`;
    return api.get(endpoint, {
      responseType: 'blob',
    });
  },
  // #794 (RNF011 AC#4): the quarantine surface. #787 made rejected rows
  // survive and slice 1 made a batch readable by id; these are what let an
  // operator actually reach one.
  listQuarantineBatches: (params?: { page?: number; limit?: number }) => {
    return api.get('/import-lgpd/batches', { params });
  },
  getQuarantineBatch: (batchId: string) => {
    return api.get(`/import-lgpd/batches/${encodeURIComponent(batchId)}`);
  },
  // #1352: correct-and-resubmit one quarantined sample row through the
  // import's own row path.
  resubmitQuarantinedRow: (batchId: string, recordId: string, row: Record<string, string>) => {
    return api.post(
      `/import-lgpd/batches/${encodeURIComponent(batchId)}/records/${encodeURIComponent(recordId)}/resubmit`,
      { row }
    );
  },
};

// ========== SECURITY SERVICES ==========
export const securityService = {
  getConfig: () => api.get('/security/config'),
  updateConfig: (data: any) => api.put('/security/config', data),
  // RF014 AC4: the configuration's releases, newest first, and a governed
  // rollback to one of them, recorded as a new release.
  getReleases: () => api.get('/security/config/releases'),
  rollbackConfig: (configurationReleaseId: string) => api.post('/security/config/rollback', { configurationReleaseId }),
  // RF014 AC1: the setting catalog, each key with its type, scope and allowed values.
  getCatalog: () => api.get('/security/config/catalog'),
  // #1149: read-only. The PUT it paired with wrote a store nothing enforced.
  getPermissions: () => api.get('/security/permissions'),
  getSessions: () => api.get('/auth/sessions'),
  getConsentQueueStatus: () => api.get('/security/consent-queue'),
  exportLogs: (filters?: any, format: 'csv' | 'json' = 'csv') => {
    const params = new URLSearchParams();
    if (filters) {
      Object.keys(filters).forEach((key) => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
          params.append(key, filters[key]);
        }
      });
    }
    params.append('format', format);
    return api.get(`/security/logs/export?${params.toString()}`, {
      responseType: format === 'csv' ? 'text' : 'json'
    });
  },
};

// ========== USER SECURITY SERVICES ==========
export const userSecurityService = {
  getStatus: () => api.get('/user/security/status'),
  getMFAStatus: () => api.get('/user/security/mfa'),
  getPasswordStatus: () => api.get('/user/security/password'),
  getSessions: () => api.get('/auth/sessions'),
  getActivities: () => api.get('/user/security/activities'),
  updatePassword: (currentPassword: string, newPassword: string) => 
    api.put('/user/security/password', { currentPassword, newPassword }),
  generateRecoveryCodes: () => api.post('/user/security/recovery-codes'),
  revokeSession: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
  revokeAllSessions: () => api.delete('/auth/sessions/all-others'),
  requestPasswordReset: () => api.post('/user/security/password-reset/request'),
};

export default api;

