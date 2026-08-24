import { useState, useEffect } from 'react';
import { backupPolicyService } from '../services/api';

interface ApiLikeError {
  message?: string;
  response?: {
    data?: {
      message?: string;
      error?: string;
      details?: string[];
    };
  };
}

interface ResponseEnvelope<T> {
  data?: {
    data?: T;
    details?: string[];
  };
}

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiLikeError;
    const details = apiError.response?.data?.details;
    if (details && details.length > 0) {
      return details.join('; ');
    }
    return apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const extractResponseData = <T,>(response: unknown): T | null => {
  if (typeof response !== 'object' || response === null) {
    return null;
  }

  const typedResponse = response as ResponseEnvelope<T>;
  return typedResponse.data?.data ?? null;
};

export interface BackupPolicy {
  cronExpression: string;
  retentionDays: number;
  encryptionEnabled: boolean;
  rpoHours: number;
  rtoHours: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export function useBackupPolicy() {
  const [policy, setPolicy] = useState<BackupPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPolicy = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await backupPolicyService.getPolicy();
      setPolicy(extractResponseData<BackupPolicy>(response));
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Erro ao carregar política de backup'));
    } finally {
      setLoading(false);
    }
  };

  const updatePolicy = async (updates: Partial<BackupPolicy>) => {
    try {
      setSaving(true);
      setError(null);
      const response = await backupPolicyService.updatePolicy(updates);
      const updated = extractResponseData<BackupPolicy>(response);
      setPolicy(updated);
      return updated;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao salvar política de backup');
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadPolicy();
  }, []);

  return {
    policy,
    loading,
    error,
    saving,
    loadPolicy,
    updatePolicy,
  };
}
