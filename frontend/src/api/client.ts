import axios, { AxiosError, AxiosInstance } from 'axios';

export type ApiToastType = 'success' | 'error' | 'warning' | 'info';

export interface ApiToastEventDetail {
  message: string;
  type?: ApiToastType;
  duration?: number;
}

export interface ApiRequestConfig {
  suppressErrorToast?: boolean;
}

const API_TOAST_EVENT = 'bioavanced:toast';

function resolveApiBaseUrl(): string {
  if (import.meta.env.VITE_API_BASE_URL) {
    const url = String(import.meta.env.VITE_API_BASE_URL);
    return url.endsWith('/api') ? url : `${url.replace(/\/$/, '')}/api`;
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const currentPort = window.location.port;
  const savedPortRaw = localStorage.getItem('api_port');
  const normalizedSavedPort = savedPortRaw && /^\d+$/.test(savedPortRaw) ? savedPortRaw : null;
  const shouldIgnoreSavedPort = !normalizedSavedPort || normalizedSavedPort === currentPort;
  const apiPort = shouldIgnoreSavedPort ? '3000' : normalizedSavedPort;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//localhost:${apiPort}/api`;
  }

  return `${protocol}//${hostname}:${apiPort}/api`;
}

function dispatchToast(detail: ApiToastEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiToastEventDetail>(API_TOAST_EVENT, { detail }));
}

function getErrorMessage(error: AxiosError): string {
  const responseMessage = (error.response?.data as { message?: string; error?: string } | undefined)?.message
    || (error.response?.data as { message?: string; error?: string } | undefined)?.error;

  return responseMessage
    || error.message
    || 'Ocorreu um erro inesperado na comunicação com a API';
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: resolveApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const requestConfig = error.config as ApiRequestConfig | undefined;

    if (requestConfig?.suppressErrorToast) {
      return Promise.reject(error);
    }

    const status = error.response?.status;

    if (status === 403) {
      dispatchToast({
        message: 'Acesso Negado: Você não tem permissão para esta ação',
        type: 'error',
        duration: 4500,
      });
    } else if (status && status >= 500) {
      dispatchToast({
        message: 'Falha no servidor. Tente novamente em instantes.',
        type: 'error',
        duration: 4500,
      });
    } else if (!error.response) {
      dispatchToast({
        message: 'Não foi possível conectar ao backend.',
        type: 'error',
        duration: 4500,
      });
    } else if (status && status >= 400) {
      dispatchToast({
        message: getErrorMessage(error),
        type: 'warning',
        duration: 4000,
      });
    }

    return Promise.reject(error);
  },
);

export function notifyApiToast(detail: ApiToastEventDetail) {
  dispatchToast(detail);
}

export { API_TOAST_EVENT };