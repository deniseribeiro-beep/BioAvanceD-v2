import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canRoleAccessRoute, RoleName } from '../utils/rolePermissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredAccessType?: number;
  requiredRole?: RoleName | RoleName[];
  // #1239: admit only the backend's audit readers (administrator or the
  // additive auditor role), from the user's isAuditReader flag.
  requireAuditReader?: boolean;
}

export default function ProtectedRoute({ children, requiredAccessType, requiredRole, requireAuditReader }: ProtectedRouteProps) {
    const renderAccessDenied = (message: string, currentRole: string) => (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-start justify-center gap-3 px-4">
        <h2 className="text-xl font-semibold text-foreground">Acesso Negado</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-sm text-muted-foreground">Sua role atual: <strong className="text-foreground">{currentRole}</strong></p>
        <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => window.history.back()}>Voltar</button>
      </div>
    );

  const { isAuthenticated, isLoading, hasAccess, hasRole, canAccessRoute, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[ProtectedRoute] Redirecionando para login - sem autenticação');
    }
    return <Navigate to="/login" replace />;
  }

  if (requireAuditReader && user?.isAuditReader !== true) {
    return renderAccessDenied(
      'Esta página requer o perfil Administrador ou Auditor.',
      user?.roleName || 'Não definida'
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
        return renderAccessDenied(
          `Esta página requer permissões de ${Array.isArray(requiredRole) ? requiredRole.join(' ou ') : requiredRole}.`,
          mappedRole || `AccessType ${user.accessType}`
        );
      }
    } else {
      return renderAccessDenied(
        `Esta página requer permissões de ${Array.isArray(requiredRole) ? requiredRole.join(' ou ') : requiredRole}.`,
        user?.roleName || 'Não definida'
      );
    }
  }

  // Verifica acesso por accessType (compatibilidade)
  if (requiredAccessType && !hasAccess(requiredAccessType)) {
    return renderAccessDenied('Você não tem permissão para acessar esta página.', user?.roleName || 'Não definida');
  }

  // Verifica acesso por rota (verificação adicional)
  // Permite acesso ao dashboard, /user/security e /security/mfa-setup mesmo sem roleName (para compatibilidade)
  const allowedRoutesWithoutRole = ['/dashboard', '/user/security', '/security/mfa-setup'];
  if (!allowedRoutesWithoutRole.includes(location.pathname) && !canAccessRoute(location.pathname)) {
    return renderAccessDenied(
      'Você não tem permissão para acessar esta página.',
      user?.roleName || (user?.accessType ? `AccessType ${user.accessType}` : 'Não definida')
    );
  }

  return <>{children}</>;
}

