import axios from 'axios';
import {
  Patient,
  Sample,
  Result,
  ConsentTemplate,
  ConsentPolicy,
  PatientConsent,
  Equipment,
  Location,
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
} from '../types/models';

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
  const port = window.location.port;
  
  // Tenta obter porta do localStorage (salva quando backend usa porta alternativa)
  const savedPort = localStorage.getItem('api_port');
  const apiPort = savedPort || '3000';
  
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
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 segundos de timeout
});

// Interceptor para adicionar token em todas as requisições
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para tratamento de erros
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
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
            
            const response = await fetch(testUrl, { 
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
    
    // Se erro 401 (não autorizado), remove token e redireciona para login
    // Mas NÃO faz isso durante o processo de login (evita logout imediato)
    if (error.response?.status === 401) {
      const isLoginRoute = error.config?.url?.includes('/auth/login');
      const isVerifyRoute = error.config?.url?.includes('/auth/verify');
      const isKeepaliveRoute = error.config?.url?.includes('/auth/keepalive');
      
      // NÃO remove token para rotas de autenticação (login, verify, keepalive)
      // Isso evita que o token seja removido durante o processo de autenticação
      if (isLoginRoute || isVerifyRoute || isKeepaliveRoute) {
        // Para verificação de token, NÃO remove o token automaticamente
        // A verificação é apenas informativa e não deve causar logout
        if (isVerifyRoute) {
          console.warn('Erro 401 na verificação de token, mas mantendo sessão ativa');
          // NÃO remove token - apenas rejeita a promise
          // O AuthContext já trata isso sem fazer logout
        }
        return Promise.reject(error);
      }
      
      // Para outras rotas (não autenticação), pode remover token após várias tentativas
      // Mas isso não deve acontecer para /auth/verify
      const verifyAttempts = sessionStorage.getItem('verifyAttempts') || '0';
      const attempts = parseInt(verifyAttempts, 10);
      
      if (attempts >= 3) {
        localStorage.removeItem('token');
        sessionStorage.removeItem('verifyAttempts');
        sessionStorage.removeItem('lastLoginTime');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      } else {
        sessionStorage.setItem('verifyAttempts', String(attempts + 1));
      }
    }
    
    return Promise.reject(error);
  }
);

// ========== PATIENT SERVICES ==========
export const patientService = {
  getAll: () => api.get<Patient[]>('/patients'),
  getById: (id: number | string) => api.get<Patient>(`/patients/${id}`),
  create: (data: Partial<Patient>) => api.post<Patient>('/patients', data),
  update: (id: number | string, data: Partial<Patient>) => api.put<Patient>(`/patients/${id}`, data),
  delete: (id: number | string) => api.delete(`/patients/${id}`),
  validateID: (patientID: string) => api.post<{ valid: boolean; patientID: string }>('/patients/validate-id', { patientID }),
  findForEdit: (patientID: string) => api.post<Patient>('/patients/find-for-edit', { patientID }),
  search: (searchTerm: string) => api.get<{ patients: Patient[]; total: number }>(`/patients/search?q=${encodeURIComponent(searchTerm)}`),
  resendConsentNotification: (patientID: string) => api.post(`/patients/${patientID}/consent/resend`),
};

// ========== SAMPLE SERVICES ==========
export const sampleService = {
  getAll: () => api.get<Sample[]>('/samples'),
  getById: (id: number) => api.get<Sample>(`/samples/${id}`),
  getByBarcode: (barcode: string) => api.get<{ sample: Sample; patient: { patientID: number; patientName: string; recordNumber: number } | null }>(`/samples/by-barcode/${encodeURIComponent(barcode)}`),
  getResults: (id: number) => api.get<Result[]>(`/samples/${id}/results`), // Implementa Sample.getResults()
  getMovements: (id: string) => api.get<{ success: boolean; data: any[] }>(`/samples/${id}/movements`), // Histórico de movimentações
  create: (data: Partial<Sample>) => api.post<Sample>('/samples', data),
  update: (id: number | string, data: Partial<Sample>) => api.put<Sample>(`/samples/${id}`, data),
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

// ========== RESULT SERVICES ==========
export const resultService = {
  getAll: (importJobID?: string) => {
    return api.get<Result[]>('/results', {
      params: importJobID ? { importJobID } : undefined
    });
  },
  getById: (id: number) => api.get<Result>(`/results/${id}`),
  upload: (formData: FormData) =>
    api.post('/results/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  create: (data: Partial<Result>) => api.post<Result>('/results', data),
  linkSample: (id: number, sampleID: number) => 
    api.put<Result>(`/results/${id}/link-sample`, { sampleID }), // Implementa Result.linkSample()
  update: (id: number, data: Partial<Result>) => api.put<Result>(`/results/${id}`, data),
  delete: (id: number) => api.delete(`/results/${id}`),
  download: async (id: number | string) => {
    try {
      // Usa axios com responseType: 'blob' para download de arquivos
      const response = await api.get(`/results/${id}/download`, {
        responseType: 'blob',
      });
      
      // Verifica se a resposta é realmente um blob ou se é JSON de erro
      const contentType = response.headers['content-type'] || '';
      
      // Se for JSON, pode ser uma resposta de erro ou redirecionamento
      if (contentType.includes('application/json')) {
        try {
          // Se response.data é um Blob, converte para texto
          const text = response.data instanceof Blob 
            ? await response.data.text()
            : response.data;
          const json = typeof text === 'string' ? JSON.parse(text) : text;
          
          // Se for redirecionamento para URL externa
          if (json.redirect && json.url) {
            window.open(json.url, '_blank');
            return;
          }
          
          // Se for erro
          throw new Error(json.error || json.message || 'Erro ao fazer download do arquivo');
        } catch (parseError: any) {
          // Se não conseguir parsear, verifica se é erro HTTP
          if (response.status >= 400) {
            throw new Error('Erro ao fazer download do arquivo');
          }
          throw parseError;
        }
      }
      
      // Cria blob URL para download
      const blob = new Blob([response.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      
      // Tenta obter o nome do arquivo do header Content-Disposition
      const contentDisposition = response.headers['content-disposition'];
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
          try {
            const errorText = await response.data.text();
            const errorJson = JSON.parse(errorText);
            throw new Error(errorJson.error || errorJson.message || 'Erro ao fazer download do arquivo');
          } catch {
            // Se não conseguir parsear, usa status HTTP
            throw new Error(`Erro ${response.status}: ${response.statusText || 'Erro ao fazer download do arquivo'}`);
          }
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
  getAll: () => api.get<Equipment[]>('/equipment'),
  getById: (id: number) => api.get<Equipment>(`/equipment/${id}`),
  create: (data: Partial<Equipment>) => api.post<Equipment>('/equipment', data),
  update: (id: number | string, data: Partial<Equipment>) => api.put<Equipment>(`/equipment/${id}`, data),
  delete: (id: number | string) => api.delete(`/equipment/${id}`),
};

// ========== LOCATION SERVICES ==========
export const locationService = {
  getAll: () => api.get<Location[]>('/locations'),
  getById: (id: string) => api.get<Location>(`/locations/${id}`),
  create: (data: Partial<Location>) => api.post<Location>('/locations', data),
  update: (id: string, data: Partial<Location>) => api.put<Location>(`/locations/${id}`, data),
  delete: (id: string) => api.delete(`/locations/${id}`),
  fixMissingLocationIDs: () => api.patch<{ success: boolean; message: string; updated: number; total: number }>('/locations/fix-missing-locationids'),
};

// ========== TEMPERATURE SERVICES ==========
export const temperatureService = {
  getAll: () => api.get<Temperature[]>('/temperature'),
  getById: (id: string) => api.get<Temperature>(`/temperature/${id}`),
  viewControl: (sensorID?: string, policyID?: string) => 
    api.get<any>('/temperature/control', { 
      params: { sensorID, policyID } 
    }), // Implementa User.viewTemperatureControl()
  create: (data: Partial<Temperature>) => api.post<Temperature>('/temperature', data),
};

// ========== SENSOR SERVICES ==========
export const sensorService = {
  getAll: () => api.get<Sensor[]>('/sensors'),
  getById: (id: string) => api.get<Sensor>(`/sensors/${id}`),
  collectReading: (id: string) => 
    api.post<Temperature>(`/sensors/${id}/collect-reading`), // Implementa Sensor.collectReading()
  create: (data: Partial<Sensor>) => api.post<Sensor>('/sensors', data),
  update: (id: string, data: Partial<Sensor>) => api.put<Sensor>(`/sensors/${id}`, data),
  delete: (id: string) => api.delete(`/sensors/${id}`),
};

// ========== POLICY SERVICES ==========
export const policyService = {
  getAll: () => api.get<Policy[]>('/policies'),
  getById: (id: number) => api.get<Policy>(`/policies/${id}`),
  getActiveLimit: (id: number, isMax: boolean = true) => 
    api.get<{ limit: number; type: string; unit: string }>(`/policies/${id}/active-limit`, {
      params: { type: isMax ? 'max' : 'min' }
    }), // Implementa Policy.getActiveLimit()
  create: (data: Partial<Policy>) => api.post<Policy>('/policies', data),
  update: (id: number, data: Partial<Policy>) => api.put<Policy>(`/policies/${id}`, data),
  delete: (id: number) => api.delete(`/policies/${id}`),
};

// ========== USER SERVICES ==========
export const userService = {
  getAll: () => api.get<User[]>('/users'),
  getById: (id: number) => api.get<User>(`/users/${id}`),
  register: (data: Partial<User>) => api.post<User>('/users/register', data), // Implementa User.registerUser()
  validateStatus: (id: number) => api.get<{ status: string }>(`/users/${id}/validate-status`), // Implementa User.validateUserStatus()
  registerPatient: (data: Partial<Patient>) => api.post<Patient>('/users/register-patient', data), // Implementa User.registerPatient()
  registerSample: (data: Partial<Sample>) => api.post<Sample>('/users/register-sample', data), // Implementa User.registerSample()
  recordWithdrawal: (data: Partial<Withdrawal>) => api.post<Withdrawal>('/users/record-withdrawal', data), // Implementa User.recordSampleWithdrawal()
  generateReport: (reportType: string) => api.post<Reports>('/users/generate-report', { reportType }), // Implementa User.generateReports()
  registerSensor: (data: Partial<Sensor>) => api.post<Sensor>('/users/register-sensor', data), // Implementa User.registerSensor()
  getLogs: (filters?: any) => api.get<Log[]>('/users/logs', { params: filters }), // Implementa User.getLogs()
  update: (id: number | string, data: Partial<User>) => api.put<User>(`/users/${id}`, data),
  delete: (id: number | string) => api.delete(`/users/${id}`),
  resetMFA: (id: number | string) => api.post(`/users/${id}/reset-mfa`),
  disableMFA: (id: number | string) => api.post(`/users/${id}/disable-mfa`),
};

// ========== ACCESS SERVICES ==========
export const accessService = {
  getAll: () => api.get<Access[]>('/access'),
  getById: (id: number) => api.get<Access>(`/access/${id}`),
  create: (data: Partial<Access>) => api.post<Access>('/access', data),
  update: (id: number, data: Partial<Access>) => api.put<Access>(`/access/${id}`, data),
  delete: (id: number) => api.delete(`/access/${id}`),
};

// ========== REPORTS SERVICES ==========
export const reportsService = {
  getAll: () => api.get<Reports[]>('/reports'),
  getById: (id: number) => api.get<Reports>(`/reports/${id}`),
  generate: (reportType: string) => api.post<Reports>('/reports/generate', { reportType }), // Implementa User.generateReports()
  delete: (id: number) => api.delete(`/reports/${id}`),
  getFilters: (type: string) => api.get<{ filters: any[] }>(`/reports/${encodeURIComponent(type)}/filters`),
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
  getAll: () => api.get<SampleWithMeasurementUnit[]>('/measurement-units'),
  getById: (id: number) => api.get<SampleWithMeasurementUnit>(`/measurement-units/${id}`),
  create: (data: Partial<SampleWithMeasurementUnit>) => api.post<SampleWithMeasurementUnit>('/measurement-units', data),
  update: (id: number, data: Partial<SampleWithMeasurementUnit>) => api.put<SampleWithMeasurementUnit>(`/measurement-units/${id}`, data),
  delete: (id: number) => api.delete(`/measurement-units/${id}`),
};

// ========== QUALITY DESCRIPTION SERVICES ==========
export const qualityDescriptionService = {
  getAll: () => api.get<SampleWithQualityDescription[]>('/quality-descriptions'),
  getById: (id: number) => api.get<SampleWithQualityDescription>(`/quality-descriptions/${id}`),
  create: (data: Partial<SampleWithQualityDescription>) => api.post<SampleWithQualityDescription>('/quality-descriptions', data),
  update: (id: number, data: Partial<SampleWithQualityDescription>) => api.put<SampleWithQualityDescription>(`/quality-descriptions/${id}`, data),
  delete: (id: number) => api.delete(`/quality-descriptions/${id}`),
};

// ========== SAMPLE TYPE SERVICES ==========
export const sampleTypeService = {
  getAll: () => api.get<any[]>('/sample-types'),
  getById: (id: number) => api.get<any>(`/sample-types/${id}`),
  create: (data: Partial<any>) => api.post<any>('/sample-types', data),
};

// ========== ANALYSIS TYPE SERVICES ==========
export const analysisTypeService = {
  getAll: () => api.get<any[]>('/analysis-types'),
  create: (data: { name: string; code?: string }) => api.post<any>('/analysis-types', data),
};

// ========== SAMPLE ORIGIN SERVICES ==========
export const sampleOriginService = {
  getAll: () => api.get<any[]>('/sample-origins'),
  getById: (id: number) => api.get<any>(`/sample-origins/${id}`),
  create: (data: Partial<any>) => api.post<any>('/sample-origins', data),
};

// ========== EXTRACTION PROTOCOL SERVICES ==========
export const extractionProtocolService = {
  getAll: () => api.get<any[]>('/extraction-protocols'),
  getById: (id: number) => api.get<any>(`/extraction-protocols/${id}`),
  create: (data: Partial<any>) => api.post<any>('/extraction-protocols', data),
};

// ========== LOG SERVICES ==========
export const logService = {
  getAll: () => api.get<{ success: boolean; data: { logs: Log[]; total: number } }>('/logs/all'),
  getById: (id: number | string) => api.get<{ success: boolean; data: Log }>(`/logs/${id}`),
  getLogs: (filters?: any) => api.get<{ success: boolean; data: { logs: Log[]; total: number; page: number; totalPages: number } }>('/logs', { params: filters }),
  queryLogs: (filters: any) => api.post<{ success: boolean; data: { logs: Log[]; total: number; page: number; totalPages: number } }>('/logs/query', filters),
  registerEvent: (data: Partial<Log>) => api.post<{ success: boolean; data: Log }>('/logs/register', data),
  exportCSV: (filters?: any) => api.get('/logs/export/csv', { params: filters, responseType: 'blob' }),
  exportExcel: (filters?: any) => api.get('/logs/export/xlsx', { params: filters, responseType: 'blob' }),
};

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
  login: (username: string, password: string, twoFactorCode?: string) =>
    api.post('/auth/login', { username, password, twoFactorCode }),
  logout: () => api.post('/auth/logout'),
  verifyToken: () => api.get('/auth/verify'),
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
  // Recuperação de senha
  requestPasswordReset: (email: string) => 
    api.post('/auth/password-reset/request', { email }),
  resetPassword: (token: string, newPassword: string) => 
    api.post('/auth/password-reset/reset', { token, newPassword }),
};

// ========== IMPORT SERVICES ==========
export const importService = {
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
  
  // Novos métodos assíncronos
  validateFile: (file: File, dataType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('dataType', dataType);
    return api.post('/import/validate', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  createImportJob: (
    file: File, 
    dataType: string, 
    options?: { startLocationID?: number; autoIncrement?: boolean }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('dataType', dataType);
    if (options?.startLocationID !== undefined) {
      formData.append('startLocationID', options.startLocationID.toString());
    }
    if (options?.autoIncrement !== undefined) {
      formData.append('autoIncrement', options.autoIncrement.toString());
    }
    return api.post('/import/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  getJobStatus: (jobID: string) => api.get(`/import/job/${jobID}`),
  
  listJobs: (params?: { status?: string; dataType?: string; limit?: number; skip?: number }) => 
    api.get('/import/jobs', { params }),
  
  cancelJob: (jobID: string) => api.post(`/import/job/${jobID}/cancel`),
  
  getImportReport: (jobID: string) => api.get(`/import/job/${jobID}/report`),
};

// ========== BACKUP SERVICES ==========
export const backupService = {
  performBackup: () => api.post('/backup/perform'),
  listBackups: () => api.get('/backup/list'),
  restoreBackup: (fileName: string) => api.post(`/backup/restore/${fileName}`),
};

// ========== ASSISTANT SERVICES ==========
export const assistantService = {
  consult: (question: string) => api.post('/assistant/consult', { question }),
  answer: (question: string) => api.post('/assistant/answer', { question }),
  getContextualHelp: (context: string) => api.post('/assistant/contextual-help', { context }),
  requestTutorial: (topic: string) => api.post('/assistant/tutorial', { topic }),
  getSuggestions: (context: string) => api.post('/assistant/suggestions', { context }),
};

// ========== CONSENT SERVICES ==========
export const consentService = {
  createTemplate: (data: Partial<ConsentTemplate>) => api.post<ConsentTemplate>('/consent-templates', data),
  getActiveTemplate: () => api.get<{ success: boolean; data: ConsentTemplate }>('/consent-templates/active'),
  createPolicy: (data: Partial<ConsentPolicy>) => api.post<ConsentPolicy>('/consent-policies', data),
  getActivePolicy: () => api.get<{ success: boolean; data: ConsentPolicy }>('/consent-policies/active'),
  getAllPolicies: () => api.get<{ success: boolean; data: ConsentPolicy[] }>('/consent-policies'),
  createPatientConsent: (data: {
    patientId: string;
    templateId: string;
    responses: Record<string, boolean>;
  }) => api.post<PatientConsent>('/consents', data),
  revokeConsent: (consentId: string) => api.post(`/consents/${consentId}/revoke`),
  getPatientConsent: (patientId: string) => api.get<{ success: boolean; data: PatientConsent }>(`/patients/${patientId}/consent`)
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
};

// ========== SECURITY SERVICES ==========
export const securityService = {
  getConfig: () => api.get('/security/config'),
  updateConfig: (data: any) => api.put('/security/config', data),
  getPermissions: () => api.get('/security/permissions'),
  updatePermissions: (data: any) => api.put('/security/permissions', data),
  getConsentQueueStatus: () => api.get('/security/consent-queue'),
  exportLogs: (filters?: any, format: 'csv' | 'json' = 'csv') => {
    const params = new URLSearchParams();
    if (filters) {
      Object.keys(filters).forEach(key => {
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
  getSessions: () => api.get('/user/security/sessions'),
  getActivities: () => api.get('/user/security/activities'),
  updateMFA: (method: 'phone' | 'passkey', enabled: boolean) => 
    api.put('/user/security/mfa', { method, enabled }),
  updatePassword: (currentPassword: string, newPassword: string) => 
    api.put('/user/security/password', { currentPassword, newPassword }),
  updatePhone: (phone: string) => 
    api.put('/user/security/phone', { phone }),
  startPasskeyRegistration: () => api.post('/user/security/passkey/start'),
  completePasskeyRegistration: (data: { credentialId: string; publicKey: string; attestationObject: string; deviceName?: string }) => 
    api.post('/user/security/passkey', data),
  removePasskey: (passkeyId: string) => api.delete(`/user/security/passkey/${passkeyId}`),
  generateRecoveryCodes: () => api.post('/user/security/recovery-codes'),
  revokeSession: (sessionId: string) => api.delete(`/user/security/sessions/${sessionId}`),
  revokeAllSessions: () => api.delete('/user/security/sessions'),
  requestPasswordReset: () => api.post('/user/security/password-reset/request'),
};

export default api;

