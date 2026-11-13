import { describe, it, expect } from 'vitest';
import { DASHBOARD_CARDS, dashboardRole, needsReportCount, showsCard } from './dashboardCards';

// RF002 AC1-AC4 (Requisitos v4.0.0): each role's dashboard cards.
describe('dashboardRole', () => {
  it('reads the role names the backend sends, accented or not', () => {
    expect(dashboardRole({ roleName: 'Usuário Externo' })).toBe('external');
    expect(dashboardRole({ roleName: 'UsuarioExterno' })).toBe('external');
    expect(dashboardRole({ roleName: 'Técnico' })).toBe('technician');
    expect(dashboardRole({ roleName: 'Tecnico' })).toBe('technician');
    expect(dashboardRole({ roleName: 'Coordenador' })).toBe('coordinator');
    expect(dashboardRole({ roleName: 'Administrador' })).toBe('administrator');
  });

  it('falls back to the access level when the name is absent or unknown', () => {
    expect(dashboardRole({ accessType: 1 })).toBe('external');
    expect(dashboardRole({ roleName: 'Auditor', accessType: 4 })).toBe('administrator');
    expect(dashboardRole({ accessType: 9 })).toBeNull();
    expect(dashboardRole(null)).toBeNull();
  });
});

describe('DASHBOARD_CARDS', () => {
  it('AC1: the Técnico sees registration, custody and storage operations, and no governance or admin card', () => {
    expect(DASHBOARD_CARDS.technician).toEqual(expect.arrayContaining(['patients', 'samples', 'custodyReports', 'storage']));
    expect(DASHBOARD_CARDS.technician).not.toContain('governanceReports');
    expect(DASHBOARD_CARDS.technician).not.toContain('users');
  });

  it('AC2: the Coordenador adds governance reports to the operational indicators and alerts', () => {
    expect(DASHBOARD_CARDS.coordinator).toEqual(expect.arrayContaining(['temperatureAlerts', 'governanceReports', ...DASHBOARD_CARDS.technician]));
    expect(DASHBOARD_CARDS.coordinator).not.toContain('security');
  });

  it('AC3: the Administrador adds users and audit; security and settings live in the account menu', () => {
    expect(DASHBOARD_CARDS.administrator).toEqual(expect.arrayContaining(['users', 'audit', ...DASHBOARD_CARDS.coordinator]));
    expect(DASHBOARD_CARDS.administrator).not.toContain('security');
    expect(DASHBOARD_CARDS.administrator).not.toContain('settings');
  });

  it('AC4: the Usuário Externo sees only the authorized reports', () => {
    expect(DASHBOARD_CARDS.external).toEqual(['authorizedReports']);
  });

  it('loads the report count only for the roles that show it', () => {
    expect(needsReportCount('technician')).toBe(false);
    expect(needsReportCount('coordinator')).toBe(true);
    expect(needsReportCount('external')).toBe(true);
    expect(needsReportCount(null)).toBe(false);
    expect(showsCard('technician', 'storage')).toBe(true);
    expect(showsCard('technician', 'users')).toBe(false);
    expect(showsCard('administrator', 'audit')).toBe(true);
    expect(showsCard(null, 'storage')).toBe(false);
  });
});
