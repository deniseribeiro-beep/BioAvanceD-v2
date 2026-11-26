import { useState, useCallback } from 'react';
import { userSecurityService } from '../services/api';
import { useRequestSequence } from './useRequestSequence';

interface ApiLikeError {
  name?: string;
  message?: string;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

interface ResponseEnvelope<T> {
  data?: {
    data?: T;
  };
}

interface UserAgentDataLike {
  platform?: string;
}

const extractResponseData = <T>(response: unknown, fallback: T): T => {
  if (typeof response !== 'object' || response === null) {
    return fallback;
  }

  const typed = response as ResponseEnvelope<T>;
  // #1434: { data: { data: null } } is a null payload, not the record { data: null }.
  if (typeof typed.data === 'object' && typed.data !== null && 'data' in typed.data) {
    return typed.data.data ?? fallback;
  }
  return (typed as unknown as { data?: T }).data ?? fallback;
};

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const typedError = error as ApiLikeError;
    return typedError.response?.data?.error || typedError.response?.data?.message || typedError.message || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const extractErrorName = (error: unknown): string | undefined => {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const maybeName = (error as { name?: unknown }).name;
    if (typeof maybeName === 'string') {
      return maybeName;
    }
  }

  return undefined;
};

const getUserAgentData = (): UserAgentDataLike | undefined => {
  if (typeof navigator !== 'object' || navigator === null || !('userAgentData' in navigator)) {
    return undefined;
  }

  return (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
};

interface SecurityStatus {
  securityScore: number;
  overallLevel: 'strong' | 'medium' | 'weak';
  alternativeMethodsCount: number;
}

interface MFAStatus {
  primaryEnabled: boolean;
  primarySetupDate?: string | Date;
  recoveryCodes?: {
    remaining: number;
    codes?: string[];
  };
}

interface PasswordStatus {
  lastChanged?: string | Date;
  expiresAt?: string | Date;
  strength?: 'weak' | 'medium' | 'strong';
  strengthScore?: number;
}

interface Session {
  id: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  location?: string;
  ipAddress?: string;
  lastAccess: string | Date;
  isCurrent: boolean;
}

export function useUserSecurity() {
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<PasswordStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when refreshData is called again
  // (e.g. by a mutation) before the in-flight Promise.all resolves.
  const requestSeq = useRequestSequence();

  const refreshData = useCallback(async () => {
    const seq = requestSeq.next();
    setLoading(true);
    setError(null);
    try {
      const [statusRes, mfaRes, passwordRes, sessionsRes] = await Promise.all([
        userSecurityService.getStatus(),
        userSecurityService.getMFAStatus(),
        userSecurityService.getPasswordStatus(),
        userSecurityService.getSessions()
      ]);

      if (!requestSeq.isCurrent(seq)) return;

      setSecurityStatus(extractResponseData<SecurityStatus | null>(statusRes, null));
      setMfaStatus(extractResponseData<MFAStatus | null>(mfaRes, null));
      setPasswordStatus(extractResponseData<PasswordStatus | null>(passwordRes, null));
      const rawSessions = extractResponseData<any[]>(sessionsRes, []);
      setSessions(
        rawSessions.map((session) => ({
          id: session.id || session.sessionID,
          deviceName: session.deviceName || session.deviceInfo?.deviceName || session.deviceInfo?.type,
          browser: session.browser || session.deviceInfo?.browser,
          os: session.os || session.deviceInfo?.os,
          location: session.location || session.geoLocation || session.ipLocation || session.ipAddress,
          ipAddress: session.ipAddress,
          lastAccess: session.lastAccess || session.lastActivity || session.createdAt,
          isCurrent: Boolean(session.isCurrent ?? session.currentSession ?? session.current)
        }))
      );
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar dados de segurança'));
      console.error('Erro ao carregar dados de segurança:', err);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  }, [requestSeq]);

  const updatePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await userSecurityService.updatePassword(currentPassword, newPassword);
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar senha'));
    }
  }, [refreshData]);

  const generateRecoveryCodes = useCallback(async () => {
    try {
      const response = await userSecurityService.generateRecoveryCodes();
      const codes = response.data?.data?.codes || response.data?.codes || [];
      
      if (!codes || codes.length === 0) {
        throw new Error('Nenhum código foi gerado');
      }

      // #901: invalidate any in-flight refreshData before writing -- a
      // slower, older refresh landing after this write would replace the
      // clear-text codes below with the server's redacted mfaStatus.
      requestSeq.next();

      // Atualiza o estado local com os códigos retornados
      // O getMFAStatus não retorna códigos em texto claro (por segurança),
      // então precisamos manter os códigos gerados no estado
      setMfaStatus(prev => prev ? {
        ...prev,
        recoveryCodes: {
          remaining: codes.length,
          codes: codes // Mantém os códigos em texto claro para exibição
        }
      } : prev);
      
      // Atualiza o remaining sem fazer refresh completo (para não perder os códigos)
      // O refresh completo será feito quando o modal for fechado
      
      return codes;
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao gerar códigos de recuperação'));
    }
  }, [requestSeq]);

  const revokeSession = useCallback(async (sessionId: string) => {
    try {
      await userSecurityService.revokeSession(sessionId);
      // Remoção otimista da lista
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao revogar sessão'));
    }
  }, [refreshData]);

  const revokeAllSessions = useCallback(async () => {
    try {
      await userSecurityService.revokeAllSessions();
      // Mantém apenas a sessão atual na lista (otimista)
      setSessions(prev => prev.filter(s => s.isCurrent));
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao revogar todas as sessões'));
    }
  }, [refreshData]);

  return {
    securityStatus,
    mfaStatus,
    passwordStatus,
    sessions,
    loading,
    error,
    refreshData,
    updatePassword,
    generateRecoveryCodes,
    revokeSession,
    revokeAllSessions
  };
}

