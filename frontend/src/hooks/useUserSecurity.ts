import { useState, useCallback } from 'react';
import { userSecurityService } from '../services/api';

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
  return typed.data?.data ?? (typed as unknown as { data?: T }).data ?? fallback;
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
  phoneEnabled: boolean;
  phoneNumber?: string;
  passkeys?: Array<{ id: string; name?: string }>;
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

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Tenta buscar dados do backend
      try {
        const [statusRes, mfaRes, passwordRes, sessionsRes] = await Promise.all([
          userSecurityService.getStatus(),
          userSecurityService.getMFAStatus(),
          userSecurityService.getPasswordStatus(),
          userSecurityService.getSessions()
        ]);

        setSecurityStatus(extractResponseData<SecurityStatus | null>(statusRes, null));
        setMfaStatus(extractResponseData<MFAStatus | null>(mfaRes, null));
        setPasswordStatus(extractResponseData<PasswordStatus | null>(passwordRes, null));
        setSessions(extractResponseData<Session[]>(sessionsRes, []));
      } catch (apiErr: unknown) {
        // Se o backend não estiver disponível, usa dados mockados para desenvolvimento
        console.warn('Backend não disponível, usando dados mockados:', extractErrorMessage(apiErr, 'Erro ao carregar backend'));
        
        // Dados mockados para desenvolvimento
        const mockSecurityStatus: SecurityStatus = {
          securityScore: 75,
          overallLevel: 'medium',
          alternativeMethodsCount: 1
        };

        const mockMFAStatus: MFAStatus = {
          primaryEnabled: true,
          primarySetupDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 dias atrás
          phoneEnabled: false,
          passkeys: [],
          recoveryCodes: {
            remaining: 8,
            codes: []
          }
        };

        const mockPasswordStatus: PasswordStatus = {
          lastChanged: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 dias atrás
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Expira em 30 dias
          strength: 'strong',
          strengthScore: 4
        };

        const mockSessions: Session[] = [
          {
            id: '1',
            deviceName: 'Chrome no Windows',
            browser: 'Chrome 120',
            os: 'Windows 11',
            location: 'São Paulo, Brasil',
            lastAccess: new Date(),
            isCurrent: true
          }
        ];

        setSecurityStatus(mockSecurityStatus);
        setMfaStatus(mockMFAStatus);
        setPasswordStatus(mockPasswordStatus);
        // Não sobrescreve a lista atual se já houver sessões carregadas (evita reintroduzir mocks após revogação)
        setSessions(prev => (prev && prev.length ? prev : mockSessions));
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Erro ao carregar dados de segurança'));
      console.error('Erro ao carregar dados de segurança:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateMFA = useCallback(async (method: 'phone' | 'passkey', enabled: boolean) => {
    try {
      await userSecurityService.updateMFA(method, enabled);
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar MFA'));
    }
  }, [refreshData]);

  const updatePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await userSecurityService.updatePassword(currentPassword, newPassword);
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar senha'));
    }
  }, [refreshData]);

  const updatePhone = useCallback(async (phone: string) => {
    try {
      const response = await userSecurityService.updatePhone(phone);
      
      // Aguarda um pouco para garantir que o banco foi atualizado
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Atualiza os dados
      await refreshData();
      
      return response;
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Erro ao atualizar telefone');
      throw new Error(errorMessage);
    }
  }, [refreshData]);

  const addPasskey = useCallback(async () => {
    try {
      // Verifica se WebAuthn está disponível
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn não é suportado neste navegador. Use um navegador moderno (Chrome, Firefox, Edge, Safari).');
      }

      // Verifica se está em contexto seguro (HTTPS ou localhost)
      // WebAuthn requer HTTPS ou localhost/127.0.0.1
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      const isHTTPS = protocol === 'https:';
      const isSecureContext = window.isSecureContext || isHTTPS || isLocalhost;
      
      if (!isSecureContext) {
        const isIP = hostname.match(/^\d+\.\d+\.\d+\.\d+$/);
        if (isIP) {
          throw new Error('WebAuthn requer HTTPS para endereços IP. Acesse via HTTPS (https://) ou use localhost.');
        } else {
          throw new Error('WebAuthn requer HTTPS ou localhost. Acesse via HTTPS (https://) ou localhost.');
        }
      }
      
      // Aviso para IPs em HTTP (pode não funcionar)
      const isIP = hostname.match(/^\d+\.\d+\.\d+\.\d+$/);
      if (isIP && !isHTTPS) {
        console.warn('WebAuthn pode não funcionar com endereços IP em HTTP. Use HTTPS ou localhost para melhor compatibilidade.');
      }

      // Primeiro, solicita ao backend para iniciar o registro
      const challengeResponse = await userSecurityService.startPasskeyRegistration();
      const responseData = challengeResponse.data?.data || challengeResponse.data;
      const challenge = responseData?.challenge;
      const userId = responseData?.userId;
      const userEmail = responseData?.userEmail;
      const userName = responseData?.userName;

      if (!challenge) {
        throw new Error('Erro ao obter desafio do servidor');
      }

      if (!userId) {
        throw new Error('Erro ao obter ID do usuário');
      }

      // Converte challenge de base64 para ArrayBuffer
      const challengeBuffer = Uint8Array.from(atob(challenge), c => c.charCodeAt(0));

      // Prepara dados do usuário - userId deve ser um ArrayBuffer
      // Converte o userId (string) para ArrayBuffer usando TextEncoder
      const encoder = new TextEncoder();
      const userIdBuffer = encoder.encode(userId);

      // Determina o rp.id baseado no hostname
      // WebAuthn requer um domínio válido ou localhost
      let rpId = window.location.hostname;
      if (rpId === 'localhost' || rpId === '127.0.0.1') {
        rpId = 'localhost';
      } else if (rpId.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        // WebAuthn não funciona bem com IPs - precisa de um domínio válido
        // Tenta usar o IP, mas pode falhar
        console.warn('WebAuthn pode não funcionar com endereços IP. Use um domínio válido ou localhost.');
        rpId = window.location.hostname;
      }

      // Cria credencial usando WebAuthn API
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: challengeBuffer,
          rp: {
            name: 'BioAvanceD',
            id: rpId
          },
          user: {
            id: userIdBuffer,
            name: userEmail || 'user@bioavanced.com',
            displayName: userName || 'Usuário BioAvanceD'
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'cross-platform', // Permite tanto platform quanto cross-platform
            userVerification: 'preferred',
            requireResidentKey: false
          },
          timeout: 60000,
          attestation: 'none'
        }
      }) as PublicKeyCredential;

      if (!credential || !credential.response) {
        throw new Error('Erro ao criar credencial. Tente novamente.');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Converte os dados para base64
      const credentialIdArray = new Uint8Array(credential.rawId);
      const credentialIdBase64 = btoa(String.fromCharCode(...credentialIdArray));

      const attestationObjectArray = new Uint8Array(response.attestationObject);
      const attestationObjectBase64 = btoa(String.fromCharCode(...attestationObjectArray));

      // PublicKey pode não estar disponível em todos os casos
      let publicKeyBase64 = '';
      if (response.getPublicKey) {
        const publicKey = response.getPublicKey();
        if (publicKey) {
          const publicKeyArray = new Uint8Array(publicKey);
          publicKeyBase64 = btoa(String.fromCharCode(...publicKeyArray));
        }
      }

      // Obtém nome do dispositivo
      const deviceName = getUserAgentData()?.platform ||
                        navigator.platform ||
                        'Dispositivo Desconhecido';

      await userSecurityService.completePasskeyRegistration({
        credentialId: credentialIdBase64,
        publicKey: publicKeyBase64,
        attestationObject: attestationObjectBase64,
        deviceName: deviceName
      });

      await refreshData();
    } catch (err: unknown) {
      const errorName = extractErrorName(err);
      const errorMessage = extractErrorMessage(err, 'Erro ao adicionar passkey');
      // Trata erros específicos do WebAuthn
      if (errorName === 'NotAllowedError') {
        throw new Error('Operação cancelada pelo usuário ou timeout. Tente novamente.');
      } else if (errorName === 'InvalidStateError') {
        throw new Error('Esta passkey já está cadastrada ou há um erro no estado da autenticação.');
      } else if (errorName === 'NotSupportedError') {
        throw new Error('Seu dispositivo ou navegador não suporta passkeys. Use um navegador moderno com suporte a WebAuthn.');
      } else if (errorName === 'SecurityError') {
        throw new Error('Erro de segurança. WebAuthn requer HTTPS ou localhost. Certifique-se de que está usando um contexto seguro.');
      } else if (errorName === 'TypeError' && errorMessage.includes('credentials')) {
        throw new Error('Erro ao acessar a API de credenciais. Verifique se o navegador suporta WebAuthn.');
      } else if (errorName === 'AbortError') {
        throw new Error('Operação cancelada.');
      }
      
      // Log do erro completo para debug
      console.error('Erro ao adicionar passkey:', err);
      
      throw new Error(errorMessage);
    }
  }, [refreshData]);

  const removePasskey = useCallback(async (passkeyId: string) => {
    try {
      await userSecurityService.removePasskey(passkeyId);
      await refreshData();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao remover passkey'));
    }
  }, [refreshData]);

  const generateRecoveryCodes = useCallback(async () => {
    try {
      const response = await userSecurityService.generateRecoveryCodes();
      const codes = response.data?.data?.codes || response.data?.codes || [];
      
      if (!codes || codes.length === 0) {
        throw new Error('Nenhum código foi gerado');
      }
      
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
  }, []);

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
    updateMFA,
    updatePassword,
    updatePhone,
    addPasskey,
    removePasskey,
    generateRecoveryCodes,
    revokeSession,
    revokeAllSessions
  };
}

