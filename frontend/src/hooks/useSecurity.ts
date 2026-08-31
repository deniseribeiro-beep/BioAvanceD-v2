import { useState, useEffect } from 'react';
import { securityService } from '../services/api';
import { useRequestSequence } from './useRequestSequence';

interface ApiLikeError {
  message?: string;
  response?: {
    data?: {
      message?: string;
    };
  };
}

interface ResponseEnvelope<T> {
  data?: {
    data?: T;
  };
}

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiLikeError;
    return apiError.response?.data?.message || apiError.message || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const extractResponseData = <T>(response: unknown): T | null => {
  if (typeof response !== 'object' || response === null) {
    return null;
  }

  const typedResponse = response as ResponseEnvelope<T>;
  return typedResponse.data?.data ?? null;
};

export interface SecurityConfig {
  authentication: {
    requireMFA: boolean;
    mfaMethod: 'totp' | 'sms' | 'email';
    allowPasswordReset: boolean;
    maxLoginAttempts: number;
    lockoutDuration: number;
    requireStrongPassword: boolean;
  };
  passwordRules: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    expirationDays: number;
    preventReuse: boolean;
    maxReuseHistory: number;
  };
  session: {
    timeoutMinutes: number;
    maxSessionDuration: number;
    allowMultipleSessions: boolean;
    autoRenewal?: boolean;
    logExpiration?: boolean;
  };
  loginAttempts: {
    maxAttempts: number;
    lockoutDuration: number;
    trackIP: boolean;
    blockIPAfterAttempts: number;
  };
  logging: {
    level: 'info' | 'warning' | 'error' | 'critical';
    logLoginAttempts: boolean;
    logAllActions: boolean;
    retentionDays: number;
  };
  privacy: {
    anonymizeLogs: boolean;
    dataRetentionDays: number;
    autoPurge: boolean;
    purgeAfterDays: number;
    anonymizeAfterDays: number;
  };
  enhancedSecurity: {
    enabled: boolean;
    requireMFAForAll: boolean;
    strictPasswordPolicy: boolean;
    sessionTimeoutMinutes: number;
    logAllActions: boolean;
    blockUnusualActivity: boolean;
  };
  lgpd: {
    allowDataExport: boolean;
    allowDataDeletion: boolean;
    anonymizeOnExport: boolean;
    requireConsent: boolean;
    consentExpirationDays: number;
  };
  metadata?: {
    lastUpdated?: Date | string;
    lastUpdatedBy?: string;
    version?: number;
  };
}

export interface ProfilePermissions {
  [profile: string]: {
    [permission: string]: boolean;
  };
}

export function useSecurity() {
  const [config, setConfig] = useState<SecurityConfig | null>(null);
  const [permissions, setPermissions] = useState<ProfilePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // #901: one sequence per state pair -- loadConfig/updateConfig write
  // `config`, loadPermissions/updatePermissions write `permissions`. Each
  // pair's own catch also guards its `error` write with its own sequence,
  // since `error` is shared: a stale config error shouldn't clobber a
  // fresher permissions error (or vice versa) that landed in between.
  // `saving` is shared by both update* calls but is a plain in-flight flag,
  // not stale data, so its finally-clear stays unconditional.
  const configSeq = useRequestSequence();
  const permissionsSeq = useRequestSequence();

  const loadConfig = async () => {
    const seq = configSeq.next();
    try {
      setLoading(true);
      setError(null);
      const response = await securityService.getConfig();
      if (!configSeq.isCurrent(seq)) return;
      setConfig(extractResponseData<SecurityConfig>(response));
    } catch (err: unknown) {
      if (!configSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar configurações'));
    } finally {
      if (configSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const loadPermissions = async () => {
    const seq = permissionsSeq.next();
    try {
      setError(null);
      const response = await securityService.getPermissions();
      if (!permissionsSeq.isCurrent(seq)) return;
      setPermissions(extractResponseData<ProfilePermissions>(response));
    } catch (err: unknown) {
      if (!permissionsSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar permissões'));
    }
  };

  const updateConfig = async (updates: Partial<SecurityConfig>) => {
    const seq = configSeq.next();
    try {
      setSaving(true);
      setError(null);
      const response = await securityService.updateConfig(updates);
      if (configSeq.isCurrent(seq)) setConfig(extractResponseData<SecurityConfig>(response));
      return response.data;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao salvar configurações');
      if (configSeq.isCurrent(seq)) setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const updatePermissions = async (updates: ProfilePermissions) => {
    const seq = permissionsSeq.next();
    try {
      setSaving(true);
      setError(null);
      const response = await securityService.updatePermissions(updates);
      if (permissionsSeq.isCurrent(seq)) setPermissions(extractResponseData<ProfilePermissions>(response));
      return response.data;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao salvar permissões');
      if (permissionsSeq.isCurrent(seq)) setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const exportLogs = async (filters?: Record<string, unknown>, format: 'csv' | 'json' = 'csv') => {
    try {
      setError(null);
      const response = await securityService.exportLogs(filters, format);
      // Para CSV, response.data é string; para JSON, response.data é objeto
      return response;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao exportar logs');
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  useEffect(() => {
    loadConfig();
    loadPermissions();
  }, []);

  return {
    config,
    permissions,
    loading,
    error,
    saving,
    loadConfig,
    loadPermissions,
    updateConfig,
    updatePermissions,
    exportLogs
  };
}

