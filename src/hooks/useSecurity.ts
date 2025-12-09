import { useState, useEffect } from 'react';
import { securityService } from '../services/api';

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

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await securityService.getConfig();
      setConfig(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const loadPermissions = async () => {
    try {
      setError(null);
      const response = await securityService.getPermissions();
      setPermissions(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Erro ao carregar permissões');
    }
  };

  const updateConfig = async (updates: Partial<SecurityConfig>) => {
    try {
      setSaving(true);
      setError(null);
      const response = await securityService.updateConfig(updates);
      setConfig(response.data.data);
      return response.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Erro ao salvar configurações';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const updatePermissions = async (updates: ProfilePermissions) => {
    try {
      setSaving(true);
      setError(null);
      const response = await securityService.updatePermissions(updates);
      setPermissions(response.data.data);
      return response.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Erro ao salvar permissões';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const exportLogs = async (filters?: any, format: 'csv' | 'json' = 'csv') => {
    try {
      setError(null);
      const response = await securityService.exportLogs(filters, format);
      // Para CSV, response.data é string; para JSON, response.data é objeto
      return response;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Erro ao exportar logs';
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

