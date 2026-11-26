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
const ALL_ROLES: readonly RoleName[] = ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'];
const ADMIN: readonly RoleName[] = ['Administrador'];
const ADMIN_COORD: readonly RoleName[] = ['Administrador', 'Coordenador'];
const STAFF: readonly RoleName[] = ['Administrador', 'Coordenador', 'Técnico'];

/**
 * #816: route authorization used to fail *open* — `canRoleAccessRoute` applied
 * four restrictive blocks and then ended in a bare `return true`, so any route
 * not explicitly named was reachable by every authenticated role, including
 * `Usuário Externo`. A new route was gated only if someone also remembered its
 * `requiredRole` prop on the `<Route>`; forget it and the grant was silent.
 *
 * This table inverts that: a path is allowed only if it matches an entry, so a
 * missing entry is a visible 403 during development instead of an invisible
 * grant. `rolePermissions.test.ts` asserts every `<Route>` in App.tsx is
 * covered, so adding a route without an entry fails the suite rather than
 * waiting for a user to report it.
 *
 * Order matters: the first matching prefix wins, so a more specific path must
 * come before the broader one it sits under.
 *
 * These entries reproduce what the old function actually answered for every
 * route that exists today — this fix closes the open default, it does not
 * re-decide policy. Where a route's own `requiredRole` is narrower than the
 * old answer, the narrower one is used (that cannot widen anyone's access,
 * since ProtectedRoute requires both).
 *
 * #825: the old answer was *stricter* than the route's declaration in two
 * places — `/reports` (and its `/reports/:id` and `/reports/query/:type`
 * children) denied `Usuário Externo`, and `/admin/tcle/*` denied
 * `Coordenador` — even though both were granted on the `<Route>` itself.
 * Both are resolved here. `/reports/templates` stays Administrador+Coordenador
 * (RF008 AC#6) by sitting ahead of the now-widened `/reports` entry.
 *
 * #1408: `/reports` and its children now admit the Técnico too, who holds
 * viewReports and whom the backend already serves every `/api/reports` read
 * (RF002, RF008). `/reports/templates` still excludes the Técnico, who lacks
 * manageReportTemplates.
 */
const ROUTE_ACCESS: ReadonlyArray<readonly [string, readonly RoleName[]]> = [
  // Self-service security pages — deliberately open to every role.
  ['/user/security', ALL_ROLES],
  ['/security/mfa-setup', ALL_ROLES],
  ['/mfa-setup', ALL_ROLES],

  // G13 — in-app runbook and product legal pages (all authenticated roles).
  ['/runbook', ALL_ROLES],
  ['/help', ALL_ROLES],
  ['/legal', ALL_ROLES],

  // Administration.
  ['/security', ADMIN],
  ['/system-management', ADMIN],
  ['/organizations', ADMIN],
  ['/collections', ADMIN],
  ['/users', ADMIN],
  ['/access-requests', ADMIN],
  ['/access', ADMIN],
  ['/backup', ADMIN],
  ['/settings/parameters', ADMIN],
  ['/admin/tcle', ADMIN_COORD],
  // Legacy UI hub redirects to /runbook; APIs /dictionary/* unchanged.
  ['/admin/dicionario', ADMIN],
  ['/admin', ADMIN],

  // Reporting and audit.
  ['/reports/templates', ADMIN_COORD],
  ['/reports', [...STAFF, 'Usuário Externo']],
  // #1239: /logs is gated by the backend's audit-reader rule (administrator
  // or the additive auditor role), which no base role can express: an auditor
  // may hold any base role, and a Coordenador is refused by every /api/logs
  // call. ProtectedRoute's requireAuditReader carries the real gate; this
  // entry only stops the role map from overruling it.
  ['/logs', ALL_ROLES],

  // Intake wizard.
  ['/next/intake', STAFF],
  ['/pacientes/novo-atendimento', STAFF],
  // `/next/*` renders FoundationApp outside ProtectedRoute, so this gate is
  // only consulted for it by the sidebar/header.
  ['/next', ALL_ROLES],

  // Participants.
  ['/patients/import-fhir', STAFF],
  ['/patients', ALL_ROLES],
  // #1375: revoking a consent and reading its history -- the backend's
  // requireRole(3, 4).
  ['/consents', ADMIN_COORD],
  // #1402: entering BiomarkerAssociation rows -- the backend's requireRole(3, 4).
  ['/biomarker-associations', ADMIN_COORD],

  // Imports — all three surfaces declare the same staff roles on their routes.
  ['/import', STAFF],

  // Facility management, plus the tab redirects that land on it.
  ['/facility-management', STAFF],
  ['/equipment', STAFF],
  ['/locations', STAFF],
  ['/temperature', STAFF],
  ['/sensors', STAFF],
  ['/incidents', STAFF],
  ['/policies', STAFF],
  ['/quality-descriptions', STAFF],

  // Specimens.
  ['/samples/withdrawal-return', STAFF],
  ['/samples', ALL_ROLES],
  ['/results', ALL_ROLES],

  ['/dashboard', ALL_ROLES],
];

/**
 * True when `path` is `prefix` itself or sits beneath it. Compared on segment
 * boundaries so `/reports-internal` does not ride in on `/reports`.
 */
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function canRoleAccessRoute(roleName: RoleName | undefined, route: string): boolean {
  if (!roleName) return false;

  // ProtectedRoute passes `location.pathname`, so strip any query/hash and the
  // trailing slash before matching.
  const path = String(route || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';

  if (path === '/') return true;

  const entry = ROUTE_ACCESS.find(([prefix]) => matchesPrefix(path, prefix));
  if (!entry) return false;

  return entry[1].includes(roleName);
}

/**
 * Obtém a descrição da role
 */
export function getRoleDescription(roleName: RoleName): string {
  const descriptions: Record<RoleName, string> = {
    'Administrador': 'Acesso completo ao sistema, incluindo gerenciamento de usuários e backup',
    'Coordenador': 'Gerenciamento e relatórios',
    'Técnico': 'Operações básicas do sistema',
    'Usuário Externo': 'Acesso limitado a relatórios',
  };
  
  return descriptions[roleName] || 'Acesso básico';
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

