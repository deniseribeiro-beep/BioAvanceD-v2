/**
 * Utilitários para verificação de permissões baseadas em roles
 * Mapeia roles (Coordenador, Técnico, Administrador, Usuário Externo) para permissões
 */

export type RoleName = 'Coordenador' | 'Técnico' | 'Administrador' | 'Usuário Externo';

function mapAccessTypeToRoleName(accessType?: number): RoleName {
  const roleNameMap: Record<number, RoleName> = {
    1: 'Usuário Externo',
    2: 'Técnico',
    3: 'Coordenador',
    4: 'Administrador',
  };

  return roleNameMap[accessType || 2] || 'Técnico';
}

/**
 * Mapeia roleName para accessType mínimo necessário
 */
export function getAccessTypeForRole(roleName?: RoleName): number {
  switch (roleName) {
    case 'Administrador':
      return 4; // Corrigido: Administrador é 4, não 3
    case 'Coordenador':
      return 3; // Corrigido: Coordenador é 3, não 2
    case 'Técnico':
      return 2; // Corrigido: Técnico é 2, não 1
    case 'Usuário Externo':
      return 1;
    default:
      return 2; // Default para Técnico
  }
}

/**
 * Verifica se uma role tem acesso a uma funcionalidade específica
 */
export function hasRoleAccess(roleName: RoleName | undefined, requiredRole?: RoleName | RoleName[]): boolean {
  if (!roleName) return false;
  
  if (Array.isArray(requiredRole)) {
    return requiredRole.includes(roleName);
  }
  
  if (!requiredRole) return true;
  
  // Hierarquia de permissões (corrigida)
  const roleHierarchy: Record<RoleName, number> = {
    'Usuário Externo': 1,
    'Técnico': 2,
    'Coordenador': 3,
    'Administrador': 4,
  };
  
  return roleHierarchy[roleName] >= roleHierarchy[requiredRole];
}

/**
 * Verifica se uma role pode acessar uma rota específica
 */
export function canRoleAccessRoute(roleName: RoleName | undefined, route: string): boolean {
  if (!roleName) return false;

  if (route === '/next/intake' || route === '/pacientes/novo-atendimento') {
    return roleName === 'Administrador' || roleName === 'Coordenador' || roleName === 'Técnico';
  }

  if (route === '/security' || (route.includes('/security') && !route.includes('/user/security') && !route.includes('/security/mfa-setup'))) {
    return roleName === 'Administrador';
  }

  const adminRoutes = ['/users', '/access', '/backup', '/system-management', '/admin'];
  if (adminRoutes.some((restrictedRoute) => route === restrictedRoute || route.startsWith(`${restrictedRoute}/`))) {
    return roleName === 'Administrador';
  }

  const coordinatorRoutes = ['/reports', '/logs'];
  if (coordinatorRoutes.some((restrictedRoute) => route === restrictedRoute || route.startsWith(`${restrictedRoute}/`))) {
    return roleName === 'Coordenador' || roleName === 'Administrador';
  }

  if (['/facility-management', '/quality-descriptions', '/import', '/samples/withdrawal-return', '/patients', '/samples', '/results', '/dashboard'].includes(route)) {
    return true;
  }

  if (route === '/user/security' || route === '/security/mfa-setup') {
    return true;
  }

  return true;
}

/**
 * Obtém a descrição da role
 */
export function getRoleDescription(roleName: RoleName): string {
  const descriptions: Record<RoleName, string> = {
    'Administrador': 'Acesso completo ao sistema, incluindo gerenciamento de usuários e backup',
    'Coordenador': 'Gerenciamento e relatórios',
    'Técnico': 'Operações básicas do sistema',
    'Usuário Externo': 'Acesso limitado a relatórios e assistente',
  };
  
  return descriptions[roleName] || 'Acesso básico';
}

/**
 * Obtém todas as rotas permitidas para uma role
 */
export function getAllowedRoutes(roleName: RoleName | undefined): string[] {
  if (!roleName) return ['/dashboard'];
  
  const allRoutes = [
    '/dashboard',
    '/patients',
    '/samples',
    '/results',
    '/facility-management',
    '/quality-descriptions',
    '/import',
    '/next/intake',
    '/pacientes/novo-atendimento',
    '/samples/withdrawal-return',
    '/user/security',
    '/security/mfa-setup',
  ];
  
  if (roleName === 'Administrador' || roleName === 'Coordenador') {
    allRoutes.push('/reports', '/logs');
  }
  
  if (roleName === 'Administrador') {
    allRoutes.push('/system-management', '/users', '/access', '/security', '/backup', '/admin/dicionario');
  }
  
  if (roleName === 'Usuário Externo') {
    return ['/dashboard', '/reports', '/user/security', '/security/mfa-setup'];
  }
  
  return allRoutes;
}

/**
 * Obtém rota padrão de redirecionamento após login baseado no perfil.
 */
export function getPostLoginRoute(roleName?: RoleName, accessType?: number): string {
  const normalizedRole = roleName || mapAccessTypeToRoleName(accessType);

  switch (normalizedRole) {
    case 'Administrador':
      return '/system-management';
    case 'Coordenador':
      return '/reports';
    case 'Usuário Externo':
      return '/dashboard';
    case 'Técnico':
    default:
      return '/dashboard';
  }
}

