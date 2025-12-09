import { Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { canRoleAccessRoute, RoleName } from '../utils/rolePermissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredAccessType?: number;
  requiredRole?: RoleName | RoleName[];
}

export default function ProtectedRoute({ children, requiredAccessType, requiredRole }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasAccess, hasRole, canAccessRoute, user, token } = useAuth();
  const location = useLocation();

  // Adiciona log para debug
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[ProtectedRoute] Estado de autenticação:', {
        isAuthenticated,
        isLoading,
        hasUser: !!user,
        hasToken: !!token,
        path: location.pathname
      });
    }
  }, [isAuthenticated, isLoading, user, token, location.pathname]);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <p>Carregando...</p>
      </div>
    );
  }

  // Verifica se tem token no localStorage mesmo que o estado ainda não tenha sido atualizado
  // Isso evita logout prematuro durante re-renderizações
  const hasStoredToken = typeof window !== 'undefined' && localStorage.getItem('token');
  
  if (!isAuthenticated && !hasStoredToken) {
    console.log('[ProtectedRoute] Redirecionando para login - sem autenticação e sem token armazenado');
    return <Navigate to="/login" replace />;
  }

  // Se tem token armazenado mas ainda está carregando, aguarda
  if (!isAuthenticated && hasStoredToken && isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <p>Carregando...</p>
      </div>
    );
  }

  // Verifica acesso por role (prioridade)
  // Se não tiver roleName mas tiver accessType, tenta mapear
  if (requiredRole && !hasRole(requiredRole)) {
    // Log de debug em desenvolvimento
    if (process.env.NODE_ENV === 'development') {
      console.log('[ProtectedRoute] Acesso negado por role:', {
        requiredRole,
        userRoleName: user?.roleName,
        userAccessType: user?.accessType,
        hasRoleResult: hasRole(requiredRole),
        path: location.pathname
      });
    }
    
    // Se não tem roleName mas tem accessType, tenta verificar por accessType
    if (!user?.roleName && user?.accessType) {
      const roleNameMap: Record<number, string> = {
        1: 'Usuário Externo',
        2: 'Técnico',
        3: 'Coordenador',
        4: 'Administrador'
      };
      const mappedRole = roleNameMap[user.accessType];
      if (mappedRole && hasRole(mappedRole as any)) {
        // Role mapeada tem acesso, permite
      } else {
        return (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <h2>Acesso Negado</h2>
            <p>Esta página requer permissões de {Array.isArray(requiredRole) ? requiredRole.join(' ou ') : requiredRole}.</p>
            <p>Sua role atual: <strong>{mappedRole || `AccessType ${user.accessType}`}</strong></p>
            <button onClick={() => window.history.back()}>Voltar</button>
          </div>
        );
      }
    } else {
      return (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <h2>Acesso Negado</h2>
          <p>Esta página requer permissões de {Array.isArray(requiredRole) ? requiredRole.join(' ou ') : requiredRole}.</p>
          <p>Sua role atual: <strong>{user?.roleName || 'Não definida'}</strong></p>
          <button onClick={() => window.history.back()}>Voltar</button>
        </div>
      );
    }
  }

  // Verifica acesso por accessType (compatibilidade)
  if (requiredAccessType && !hasAccess(requiredAccessType)) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <h2>Acesso Negado</h2>
        <p>Você não tem permissão para acessar esta página.</p>
        <p>Sua role atual: <strong>{user?.roleName || 'Não definida'}</strong></p>
        <button onClick={() => window.history.back()}>Voltar</button>
      </div>
    );
  }

  // Verifica acesso por rota (verificação adicional)
  // Permite acesso ao dashboard, /user/security e /security/mfa-setup mesmo sem roleName (para compatibilidade)
  const allowedRoutesWithoutRole = ['/dashboard', '/user/security', '/security/mfa-setup'];
  if (!allowedRoutesWithoutRole.includes(location.pathname) && !canAccessRoute(location.pathname)) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <h2>Acesso Negado</h2>
        <p>Você não tem permissão para acessar esta página.</p>
        <p>Sua role atual: <strong>{user?.roleName || (user?.accessType ? `AccessType ${user.accessType}` : 'Não definida')}</strong></p>
        <button onClick={() => window.history.back()}>Voltar</button>
      </div>
    );
  }

  return <>{children}</>;
}

