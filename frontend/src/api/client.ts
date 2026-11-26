import axios, { AxiosError, AxiosInstance } from 'axios';
import { withRequestId } from './requestId';
import { installTimingReporter } from './timingReporter';
import { getLanguage } from '../i18n';

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
  window.dispatchEvent(new CustomEvent<ApiToastEventDetail>(API_TOAST_EVENT, { detail }));
}

function getErrorMessage(error: AxiosError): string {
  const responseMessage = (error.response?.data as { message?: string; error?: string } | undefined)?.message
    || (error.response?.data as { message?: string; error?: string } | undefined)?.error;

  return responseMessage || error.message;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: resolveApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

apiClient.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // #1422: UI language governs API messages (see services/api.ts).
  config.headers['Accept-Language'] = getLanguage();
  return withRequestId(config);
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const requestConfig = error.config as ApiRequestConfig | undefined;

    if (requestConfig?.suppressErrorToast) {
      return Promise.reject(error);
    }

    if (!error.response) {
      dispatchToast({
        message: 'Não foi possível conectar ao backend.',
        type: 'error',
        duration: 4500,
      });
      return Promise.reject(error);
    }

    const { status } = error.response;

    if (status === 403) {
      dispatchToast({
        message: 'Acesso Negado: Você não tem permissão para esta ação',
        type: 'error',
        duration: 4500,
      });
    } else if (status >= 500) {
      dispatchToast({
        message: 'Falha no servidor. Tente novamente em instantes.',
        type: 'error',
        duration: 4500,
      });
    } else if (status >= 400) {
      dispatchToast({
        message: getErrorMessage(error),
        type: 'warning',
        duration: 4000,
      });
    }

    return Promise.reject(error);
  },
);

// RNF001 C4 (#1469): installed last, so it times each call around the other interceptors.
installTimingReporter(apiClient);

export function notifyApiToast(detail: ApiToastEventDetail) {
  dispatchToast(detail);
}

export { API_TOAST_EVENT };