// RF002 (Requisitos v4.0.0): the dashboard shows each role its own cards.
//   AC1  Técnico: authorized registration, custody and storage operations.
//   AC2  Coordenador: operational indicators, alerts and governance reports.
//   AC3  Administrador: security, users, audit and settings, besides the above.
//   AC4  Usuário Externo: only the reports a grant authorizes (the backend
//        filters GET /api/reports to them; RF002 AC5 keeps the check there).

export type DashboardRole = 'external' | 'technician' | 'coordinator' | 'administrator';

export type DashboardCardKey =
  | 'patients'
  | 'samples'
  | 'custodyReports'
  | 'storage'
  | 'results'
  | 'temperatureAlerts'
  | 'governanceReports'
  | 'authorizedReports'
  | 'users'
  | 'security'
  | 'audit'
  | 'settings';

const OPERATIONS: DashboardCardKey[] = ['patients', 'samples', 'custodyReports', 'storage', 'results', 'temperatureAlerts'];

export const DASHBOARD_CARDS: Record<DashboardRole, DashboardCardKey[]> = {
  technician: OPERATIONS,
  coordinator: [...OPERATIONS, 'governanceReports'],
  administrator: [...OPERATIONS, 'governanceReports', 'users', 'security', 'audit', 'settings'],
  external: ['authorizedReports'],
};

const ROLE_BY_NAME: Record<string, DashboardRole> = {
  'usuario externo': 'external',
  usuarioexterno: 'external',
  tecnico: 'technician',
  coordenador: 'coordinator',
  administrador: 'administrator',
};

const ROLE_BY_LEVEL: Record<number, DashboardRole> = {
  1: 'external',
  2: 'technician',
  3: 'coordinator',
  4: 'administrator',
};

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The caller's dashboard role from its role name, else its access level. */
export function dashboardRole(user: { roleName?: string | null; accessType?: number | null } | null | undefined): DashboardRole | null {
  if (!user) return null;
  if (user.roleName) {
    const byName = ROLE_BY_NAME[normalizeName(user.roleName)];
    if (byName) return byName;
  }
  return ROLE_BY_LEVEL[Number(user.accessType)] ?? null;
}

/** Whether a role's dashboard needs the saved-report count. */
export function needsReportCount(role: DashboardRole | null): boolean {
  return role !== null && DASHBOARD_CARDS[role].some((key) => key === 'governanceReports' || key === 'authorizedReports');
}
