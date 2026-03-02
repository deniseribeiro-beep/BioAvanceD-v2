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
  
  // Rotas que requerem Administrador (mas não /user/security ou /security/mfa-setup)
  const adminRoutes = ['/users', '/access', '/backup'];
  // Verifica se é /security mas não /user/security nem /security/mfa-setup
  // /security/mfa-setup é permitido para todos (configuração pessoal de MFA)
  if (route === '/security' || (route.includes('/security') && !route.includes('/user/security') && !route.includes('/security/mfa-setup'))) {
    return roleName === 'Administrador';
  }
  if (adminRoutes.some(r => route.includes(r))) {
    return roleName === 'Administrador';
  }
  
  // Rotas que requerem Coordenador ou Administrador
  const coordinatorRoutes = ['/reports', '/logs'];
  if (coordinatorRoutes.some(r => route.includes(r))) {
    return roleName === 'Coordenador' || roleName === 'Administrador';
  }
  
  // Rotas básicas (todas as roles) - incluindo /user/security
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
    '/assistant',
  ];
  
  if (roleName === 'Administrador' || roleName === 'Coordenador') {
    allRoutes.push('/reports', '/logs');
  }
  
  if (roleName === 'Administrador') {
    allRoutes.push('/users', '/access', '/security', '/backup');
  }
  
  // Todos os usuários podem acessar sua própria página de segurança e configurar MFA
  allRoutes.push('/user/security', '/security/mfa-setup');
  
  if (roleName === 'Usuário Externo') {
    return ['/dashboard', '/reports', '/assistant', '/user/security', '/security/mfa-setup'];
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
      return '/assistant';
    case 'Técnico':
    default:
      return '/dashboard';
  }
}

