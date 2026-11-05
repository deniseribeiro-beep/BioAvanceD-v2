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
    mfaMethod: 'totp';
    allowPasswordReset: boolean;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
    requireStrongPassword: boolean;
  };
  passwordRules: {
    minLength: number;
    // #1257: absent from a document stored before it existed.
    minLengthWithMFA?: number;
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
    maxSessionDurationHours: number;
    allowMultipleSessions: boolean;
    autoRenewal?: boolean;
    logExpiration?: boolean;
  };
  loginAttempts: {
    maxAttempts: number;
    lockoutDurationMinutes: number;
    trackIP: boolean;
    blockIPAfterAttempts: number;
  };
  logging: {
    level: 'info' | 'warning' | 'error' | 'critical';
    logLoginAttempts: boolean;
    logAllActions: boolean;
    // #1248: derived from the active RetentionPolicy; null when none applies.
    retentionDays: number | null;
  };
  privacy: {
    anonymizeLogs: boolean;
    // #1261: fixed at null; no job applies a period to data other than logs.
    dataRetentionDays: number | null;
    autoPurge: boolean;
    purgeAfterDays: number | null;
    anonymizeAfterDays: number | null;
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
    // #1262: fixed at null; a PatientConsent carries no expiry.
    consentExpirationDays: number | null;
  };
  // #1248: the keys the active RetentionPolicy decides, read-only here.
  governedBy?: Record<string, {
    entity: string;
    policyId: string | null;
    version: string | null;
    postRetentionAction?: string;
    unavailable?: boolean;
    // #1260, #1261: set for a key whose behaviour is fixed, naming why.
    fixed?: 'audit-required' | 'always-anonymized' | 'not-applied' | 'consent-required' | 'consent-no-expiry' | 'export-pseudonymised';
  }>;
  // #953: flat, per dict-02 P1X-0321/0322/0323.
  configVersion?: number;
  lastUpdatedAt?: Date | string;
  lastUpdatedBy?: string;
}

// #1341: GET /security/permissions returns the seeded roles and the
// permissions each grants, the rows enforcement reads. Read-only.
export interface PermissionEntry {
  permissionCode: string;
  displayName: string;
  resourceType: string;
  allowedActions: string[];
}

export interface RoleEntry {
  roleCode: string;
  displayName: string;
  hierarchyLevel: number | null;
  permissionCodes: string[];
}

export interface ProfilePermissions {
  roles: RoleEntry[];
  permissions: PermissionEntry[];
}

export function useSecurity() {
  const [config, setConfig] = useState<SecurityConfig | null>(null);
  const [permissions, setPermissions] = useState<ProfilePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // #901: one sequence per state pair -- loadConfig/updateConfig write
  // `config`, loadPermissions writes `permissions` (read-only since #1149). Each
  // pair's own catch also guards its `error` write with its own sequence,
  // since `error` is shared: a stale config error shouldn't clobber a
  // fresher permissions error (or vice versa) that landed in between.
  // `saving` is updateConfig's plain in-flight flag,
  // not stale data, so its finally-clear stays unconditional.
  const configSeq = useRequestSequence();
  const permissionsSeq = useRequestSequence();
  // #1446: `loading` is set by loadConfig alone, so only a newer loadConfig
  // may take over its reset; an updateConfig that supersedes a load's data
  // must not leave `loading` stuck true.
  const loadingSeq = useRequestSequence();

  const loadConfig = async () => {
    const seq = configSeq.next();
    const loadingTurn = loadingSeq.next();
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
      if (loadingSeq.isCurrent(loadingTurn)) setLoading(false);
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
    exportLogs
  };
}

