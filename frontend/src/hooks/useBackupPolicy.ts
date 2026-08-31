import { useState, useEffect } from 'react';
import { backupPolicyService } from '../services/api';
import { useRequestSequence } from './useRequestSequence';

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
  // #901: loadPolicy and updatePolicy both write `policy`, so they share one
  // sequence to discard a stale write from either side. `loading`/`saving`
  // are each owned by a single caller (load vs. save), so their own
  // finally-clears stay unconditional -- gating them on this shared
  // sequence would let one call's advance suppress the other's flag clear.
  const requestSeq = useRequestSequence();

  const loadPolicy = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      setError(null);
      const response = await backupPolicyService.getPolicy();
      if (!requestSeq.isCurrent(seq)) return;
      setPolicy(extractResponseData<BackupPolicy>(response));
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar política de backup'));
    } finally {
      setLoading(false);
    }
  };

  const updatePolicy = async (updates: Partial<BackupPolicy>) => {
    const seq = requestSeq.next();
    try {
      setSaving(true);
      setError(null);
      const response = await backupPolicyService.updatePolicy(updates);
      const updated = extractResponseData<BackupPolicy>(response);
      if (requestSeq.isCurrent(seq)) setPolicy(updated);
      return updated;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao salvar política de backup');
      if (requestSeq.isCurrent(seq)) setError(errorMessage);
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
