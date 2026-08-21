import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { User } from '../types/models';
import { authService } from '../services/api';
import { hasRoleAccess, canRoleAccessRoute, getAccessTypeForRole, RoleName } from '../utils/rolePermissions';
import { clearClientSession, onClientLogout } from '../utils/sessionCleanup';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string, twoFactorCode?: string, newPassword?: string) => Promise<{ requiresTwoFactor?: boolean; requiresTwoFactorSetup?: boolean; requiresPasswordChange?: boolean; user?: User } | void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasAccess: (requiredAccessType: number) => boolean;
  hasRole: (requiredRole: RoleName | RoleName[]) => boolean;
  canAccessRoute: (route: string) => boolean;
  hasReportAccess: (reportType: string) => boolean;
  getAllowedReports: () => string[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapAccessTypeToRoleName(accessType?: number): RoleName {
  const roleNameMap: Record<number, RoleName> = {
    1: 'Usuário Externo',
    2: 'Técnico',
    3: 'Coordenador',
    4: 'Administrador'
  };

  return roleNameMap[accessType || 2] || 'Técnico';
}

function decodeUserFromToken(token: string): User | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );

    const payload = JSON.parse(jsonPayload);
    const accessType = Number(payload.accessType || payload.role || 2);
    const roleName = payload.roleName || mapAccessTypeToRoleName(accessType);

    return {
      id: Number(payload.id || 0),
      name: payload.name || payload.username || 'Usuário',
      email: payload.email || 'no-email@local',
      username: payload.username || payload.name || 'user',
      userID: payload.userID || payload.id || payload.sub,
      accessType,
      roleName,
    } as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);
  const [skipVerification, setSkipVerification] = useState(false);
  const verifyInFlightRef = useRef(false);
  const lastVerifyAtRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Verifica token apenas na montagem inicial do componente
  useEffect(() => {
    let isMounted = true;
    let verificationTimeout: NodeJS.Timeout | null = null;
    
    const verifyToken = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        const fallbackUser = decodeUserFromToken(storedToken);
        if (fallbackUser && isMounted) {
          setUser((currentUser) => currentUser || fallbackUser);
          setToken(storedToken);
        }

        try {
          const now = Date.now();
          if (verifyInFlightRef.current) {
            if (isMounted) {
              setIsLoading(false);
            }
            return;
          }

          if (now - lastVerifyAtRef.current < 5000) {
            if (isMounted) {
              setIsLoading(false);
            }
            return;
          }

          verifyInFlightRef.current = true;
          lastVerifyAtRef.current = now;

          // Verifica se acabou de fazer login (evita verificação imediata após login)
          const lastLoginTime = sessionStorage.getItem('lastLoginTime');
          const timeSinceLogin = lastLoginTime ? now - parseInt(lastLoginTime, 10) : Infinity;
          
          // Se fez login há menos de 2 segundos, não verifica ainda
          if (timeSinceLogin < 2000) {
            console.log('Login muito recente, aguardando antes de verificar token');
            if (isMounted) {
              setIsLoading(false);
            }
            return;
          }
          
          // Limpa tentativas anteriores ao iniciar nova verificação
          sessionStorage.removeItem('verifyAttempts');
          
          const response = await authService.verifyToken();
          // Verifica diferentes formatos de resposta do backend
          // Backend retorna: { success: true, data: { user: {...}, valid: true } }
          const responseData = response.data || {};
          const userData = responseData.data?.user || responseData.user;
          
          if (isMounted && userData) {
            // Se não tiver roleName mas tiver accessType, mapeia
            if (!userData.roleName && userData.accessType) {
              userData.roleName = mapAccessTypeToRoleName(userData.accessType);
            }
            setUser(userData);
            setToken(storedToken);
          } else if (isMounted) {
            // Resposta inválida - mas mantém token
            // Pode ser que o backend ainda esteja processando ou formato de resposta diferente
            console.warn('Resposta de verificação de token inválida, mas mantendo sessão:', response.data);
            // NÃO remove token - mantém a sessão ativa mesmo com resposta inválida
            // O usuário pode continuar usando a aplicação
          }
        } catch (error: any) {
          // NÃO remove token automaticamente em caso de erro
          // Erros podem ser temporários (rede, servidor, etc)
          if (isMounted) {
            console.warn('Erro ao verificar token (mantendo sessão):', error.message);
            
            // Apenas loga o erro, mas NÃO faz logout automático
            // O usuário permanece logado mesmo se a verificação falhar
            // Isso evita deslogar o usuário por erros temporários de rede ou servidor
            
            // Se for erro 401 e login foi muito recente, apenas loga
            const lastLoginTime = sessionStorage.getItem('lastLoginTime');
            const now = Date.now();
            const timeSinceLogin = lastLoginTime ? now - parseInt(lastLoginTime, 10) : Infinity;
            
            if (error.response?.status === 429) {
              console.warn('Muitas requisições na verificação de token. Reagendando verificação.');
              if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
              }
              retryTimeoutRef.current = setTimeout(() => {
                if (isMounted) {
                  verifyToken();
                }
              }, 15000);
            } else if (error.response?.status === 401 && timeSinceLogin < 5000) {
              console.log('Login recente detectado, mantendo token mesmo com erro 401');
            } else if (error.response?.status === 401) {
              // Erro 401 após login - pode ser token expirado, mas não remove automaticamente
              // O usuário pode continuar usando a aplicação
              console.warn('Token pode estar expirado, mas mantendo sessão ativa');
            } else {
              // Para outros erros (rede, servidor, etc), mantém o token
              console.warn('Erro não-401 ao verificar token, mantendo token:', error.message);
            }
            
            // SEMPRE mantém o token e usuário, mesmo em caso de erro
            // O logout só deve acontecer quando o usuário explicitamente faz logout
            // ou quando uma requisição autenticada falha (não na verificação)
          }
        } finally {
          verifyInFlightRef.current = false;
        }
      } else if (isMounted) {
        setToken(null);
        setUser(null);
      }
      
      if (isMounted) {
        setIsLoading(false);
      }
    };

    // Só verifica se não tiver skipVerification ativo
    if (!skipVerification) {
      verifyToken();
    } else {
      // Se skipVerification estiver ativo, apenas marca como não carregando
      // e agenda verificação para depois
      setIsLoading(false);
      setSkipVerification(false);
      
      // Agenda verificação para 3 segundos depois do login
      verificationTimeout = setTimeout(() => {
        if (isMounted) {
          verifyToken();
        }
      }, 3000);
    }

    // Escuta mudanças no localStorage (para quando token é salvo em outra aba/componente)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'token') {
        const lastLoginTime = sessionStorage.getItem('lastLoginTime');
        const now = Date.now();
        const timeSinceLogin = lastLoginTime ? now - parseInt(lastLoginTime, 10) : Infinity;
        
        // Só verifica se não foi login recente
        if (timeSinceLogin > 2000) {
          verifyToken();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      isMounted = false;
      if (verificationTimeout) {
        clearTimeout(verificationTimeout);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []); // Executa apenas uma vez na montagem

  // api.ts's response interceptor dispatches this event on a forced logout
  // (401 + failed refresh) — every other hook that reads auth-derived data
  // (useUsers, useOrganizations, useResults, ...) already clears its own
  // state on it via the same onClientLogout subscription; AuthContext is
  // the actual source of truth for isAuthenticated/user/token that
  // ProtectedRoute and LoginPage read, and needs to clear its own state
  // the same way rather than relying solely on the page reload that
  // currently accompanies every real-world call site of this event (#614).
  useEffect(() => {
    return onClientLogout(() => {
      setUser(null);
      setToken(null);
    });
  }, []);

  const login = useCallback(async (username: string, password: string, twoFactorCode?: string, newPassword?: string): Promise<{ requiresTwoFactor?: boolean; requiresTwoFactorSetup?: boolean; requiresPasswordChange?: boolean; user?: User } | void> => {
    try {
      const response = await authService.login(username, password, twoFactorCode, newPassword);

      // Backend retorna diferentes estruturas:
      // 1. Login com sucesso: { success: true, data: { token, user } }
      // 2. Requer MFA: { success: true, requiresMFA: true, requiresTwoFactor: true }
      // 3. Requer setup MFA: { success: true, requiresMFASetup: true, requiresTwoFactorSetup: true }
      // 4. Requer troca de senha (RF014 AC#4, #648): { success: true, requiresPasswordChange: true }
      const responseData = response.data || {};

      // Verifica flags primeiro
      const requiresTwoFactor = responseData.requiresTwoFactor || responseData.requiresMFA || false;
      const requiresTwoFactorSetup = responseData.requiresTwoFactorSetup || responseData.requiresMFASetup || false;
      const requiresPasswordChange = responseData.requiresPasswordChange || false;

      // Extrai token e user (pode estar em data.data ou data)
      const data = responseData.data || responseData;
      const newToken = data?.token || responseData.token;
      const userData = data?.user || responseData.user;

      // Se requer configuração obrigatória de 2FA no primeiro login
      if (requiresTwoFactorSetup) {
        // Salva credenciais temporariamente para usar após configurar 2FA
        localStorage.setItem('tempUsername', username);
        localStorage.setItem('tempPassword', password);
        return { requiresTwoFactorSetup: true };
      }

      // Se requer 2FA mas não foi fornecido código, retorna informação para o componente
      if (requiresTwoFactor && !twoFactorCode) {
        return { requiresTwoFactor: true };
      }

      // Se o admin forçou redefinição de senha e a nova senha ainda não foi
      // enviada, retorna informação para o componente solicitar a nova senha.
      if (requiresPasswordChange && !newPassword) {
        return { requiresPasswordChange: true };
      }

      // Se tem token, significa que login foi bem-sucedido
      if (newToken && userData) {
        // Se não tiver roleName mas tiver accessType, mapeia
        if (!userData.roleName && userData.accessType) {
          userData.roleName = mapAccessTypeToRoleName(userData.accessType);
        }
        
        localStorage.removeItem('tempUsername');
        localStorage.removeItem('tempPassword');
        localStorage.setItem('token', newToken);
        
        // Marca timestamp do login para evitar remoção prematura do token
        sessionStorage.setItem('lastLoginTime', Date.now().toString());
        sessionStorage.removeItem('verifyAttempts');
        
        // Atualiza estado imediatamente após salvar token
        setToken(newToken);
        setUser(userData);
        
        // Marca como não carregando
        setIsLoading(false);
        
        // Marca para pular verificação imediata após login
        // Isso evita que o useEffect remova o token imediatamente
        setSkipVerification(true);
        
        return { requiresTwoFactor: false, user: userData };
      }
      
      // Caso contrário, requer 2FA
      return { requiresTwoFactor: true };
    } catch (error: any) {
      const statusCode = Number(error?.response?.status || 0);
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          'Erro ao fazer login';
      const requiresTwoFactor = error.response?.data?.requiresTwoFactor || false;
      const attemptsRemaining = error.response?.data?.attemptsRemaining;

      if (statusCode === 401) {
        throw new Error(errorMessage || 'Login error. Please check your credentials.');
      }
      
      if (requiresTwoFactor) {
        throw { message: errorMessage, requiresTwoFactor: true, attemptsRemaining };
      }
      
      throw new Error(errorMessage);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) {
        // Chama endpoint de logout para invalidar sessão no backend
        await authService.logout();
      }
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      // Continua mesmo se houver erro (logout local sempre funciona)
    } finally {
      // Limpa sessão local e força saída da área autenticada
      clearClientSession({ redirectToLogin: true });
      setToken(null);
      setUser(null);
    }
  }, [token]);

  const hasAccess = useCallback((requiredAccessType: number): boolean => {
    if (!user) return false;
    // Usa roleName se disponível, senão usa accessType
    if (user.roleName) {
      const roleAccessType = getAccessTypeForRole(user.roleName);
      return roleAccessType >= requiredAccessType;
    }
    // Fallback para accessType antigo
    return (user.accessType ?? 0) >= requiredAccessType;
  }, [user]);

  const hasRole = useCallback((requiredRole: RoleName | RoleName[]): boolean => {
    // Se tem roleName, usa ele
    if (user?.roleName) {
      return hasRoleAccess(user.roleName, requiredRole);
    }
    
    // Se não tem roleName mas tem accessType, mapeia e verifica
    if (user?.accessType) {
      const roleNameMap: Record<number, string> = {
        1: 'Usuário Externo',
        2: 'Técnico',
        3: 'Coordenador',
        4: 'Administrador'
      };
      const mappedRole = roleNameMap[user.accessType];
      if (mappedRole) {
        return hasRoleAccess(mappedRole as RoleName, requiredRole);
      }
    }
    
    return false;
  }, [user]);

  const canAccessRoute = useCallback((route: string): boolean => {
    // Rotas que são permitidas para todos os usuários autenticados (mesmo sem roleName)
    const publicAuthenticatedRoutes = ['/dashboard', '/user/security', '/security/mfa-setup'];
    if (publicAuthenticatedRoutes.includes(route)) {
      return true;
    }
    
    // Se tem roleName, usa ele
    if (user?.roleName) {
      return canRoleAccessRoute(user.roleName, route);
    }
    
    // Se não tem roleName mas tem accessType, mapeia e verifica
    if (user?.accessType) {
      const roleNameMap: Record<number, string> = {
        1: 'Usuário Externo',
        2: 'Técnico',
        3: 'Coordenador',
        4: 'Administrador'
      };
      const mappedRole = roleNameMap[user.accessType];
      if (mappedRole) {
        return canRoleAccessRoute(mappedRole as RoleName, route);
      }
    }
    
    // Dashboard sempre permite acesso
    if (route === '/dashboard') {
      return true;
    }
    
    return false;
  }, [user]);

  const hasReportAccess = useCallback((reportType: string): boolean => {
    if (!user) return false;
    
    // accessType 3 tem acesso completo
    if (user.accessType === 3) return true;
    
    // Verifica se o usuário tem este tipo de relatório nos allowedReports
    if (user.allowedReports && user.allowedReports.length > 0) {
      return user.allowedReports.includes(reportType);
    }
    
    // Se não tem allowedReports definido, usa lógica antiga
    // accessType 2 tem acesso a relatórios
    if ((user.accessType ?? 0) >= 2) {
      return true;
    }
    
    // accessType 1 não tem acesso a relatórios
    return false;
  }, [user]);
  
  const getAllowedReports = useCallback((): string[] => {
    if (!user) return [];
    if (user.accessType === 3) {
      // Acesso completo - retorna todos os tipos possíveis
      return [
        'Relatório de Pacientes',
        'Relatório de Amostras',
        'Relatório de Temperatura',
        'Relatório de Sensores',
        'Relatório de Equipamentos',
        'Relatório de Resultados',
        'Relatório de Auditoria'
      ];
    }
    return user.allowedReports || [];
  }, [user]);

  // Memoiza o valor do contexto para evitar re-renderizações desnecessárias
  // As funções já são memoizadas com useCallback, então não precisam estar nas dependências
  const contextValue = useMemo(() => ({
    user,
    token,
    login,
    logout,
    isAuthenticated: !!user && !!token,
    isLoading,
    hasAccess,
    hasRole,
    canAccessRoute,
    hasReportAccess,
    getAllowedReports,
  }), [user, token, isLoading, login, logout, hasAccess, hasRole, canAccessRoute, hasReportAccess, getAllowedReports]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}

