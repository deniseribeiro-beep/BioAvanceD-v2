import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canRoleAccessRoute, RoleName } from './rolePermissions';

const ROLES: RoleName[] = ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'];

describe('canRoleAccessRoute — unknown routes', () => {
  it('denies a route that is not on the allow-list, for every role (#816)', () => {
    // The finding: the function used to end in a bare `return true`, so any
    // route not named in one of its restrictive blocks was reachable by every
    // authenticated role — including a route that does not exist yet, which is
    // the shape of the next route someone adds without a `requiredRole` prop.
    for (const role of ROLES) {
      expect(canRoleAccessRoute(role, '/some-route-nobody-listed')).toBe(false);
      expect(canRoleAccessRoute(role, '/admin-console-v2')).toBe(false);
      expect(canRoleAccessRoute(role, '/internal/metrics')).toBe(false);
    }
  });

  it('still denies everything when there is no role at all', () => {
    expect(canRoleAccessRoute(undefined, '/dashboard')).toBe(false);
  });

  // A near-miss must not inherit a listed route's grant: prefix matching has to
  // respect segment boundaries, or '/reports-internal' rides in on '/reports'.
  it('does not treat a longer name sharing a prefix as the listed route', () => {
    expect(canRoleAccessRoute('Administrador', '/reports-internal')).toBe(false);
    expect(canRoleAccessRoute('Administrador', '/backupsomething')).toBe(false);
  });
});

describe('canRoleAccessRoute — the restrictive blocks still hold', () => {
  it('keeps admin-only routes admin-only', () => {
    for (const route of ['/system-management', '/users', '/access', '/backup', '/security', '/admin/dicionario']) {
      expect(canRoleAccessRoute('Administrador', route)).toBe(true);
      expect(canRoleAccessRoute('Coordenador', route)).toBe(false);
      expect(canRoleAccessRoute('Técnico', route)).toBe(false);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  it('keeps /reports and /logs to Administrador and Coordenador', () => {
    for (const route of ['/reports', '/logs', '/logs/123', '/reports/templates']) {
      expect(canRoleAccessRoute('Administrador', route)).toBe(true);
      expect(canRoleAccessRoute('Coordenador', route)).toBe(true);
      expect(canRoleAccessRoute('Técnico', route)).toBe(false);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  it('keeps the intake wizard to staff roles', () => {
    for (const route of ['/next/intake', '/pacientes/novo-atendimento']) {
      expect(canRoleAccessRoute('Técnico', route)).toBe(true);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  it('keeps the two self-service security pages open to every role', () => {
    for (const route of ['/user/security', '/security/mfa-setup']) {
      for (const role of ROLES) {
        expect(canRoleAccessRoute(role, route)).toBe(true);
      }
    }
  });
});

describe('canRoleAccessRoute — routes reached with a concrete id', () => {
  // ProtectedRoute passes `location.pathname`, not the route pattern, so every
  // parameterised route arrives here with a real id substituted in.
  it('resolves a parameterised path through its prefix', () => {
    expect(canRoleAccessRoute('Técnico', '/samples/68ab12cd34ef56ab78cd90ef')).toBe(true);
    expect(canRoleAccessRoute('Técnico', '/samples/68ab12cd34ef56ab78cd90ef/label')).toBe(true);
    expect(canRoleAccessRoute('Coordenador', '/reports/query/auditoria')).toBe(true);
    expect(canRoleAccessRoute('Técnico', '/reports/query/auditoria')).toBe(false);
  });
});

describe('every route declared in App.tsx is covered by the allow-list', () => {
  // The guard #816 asked for. Without it, failing closed turns "someone added a
  // route and forgot the allow-list entry" from an invisible grant into an
  // invisible *denial* — better, but still invisible until a user reports it.
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'App.tsx'),
    'utf8'
  );

  // Routes rendered outside ProtectedRoute never reach canRoleAccessRoute:
  // the participant-facing consent pages, login, and password reset.
  const PUBLIC_ROUTES = [
    '/login',
    '/reset-password',
    '/mfa-setup',
    '/patient/e-consent',
    '/patient/e-consent/:token',
    '/patient/e-consent/import/:token',
    '/patients/:id/consent',
    '/',
    '/*',
    '/next/*',
  ];

  const declaredRoutes = Array.from(appSource.matchAll(/<Route\s+path="([^"]+)"/g))
    .map((match) => match[1])
    .filter((route) => !PUBLIC_ROUTES.includes(route));

  it('finds the routes it is supposed to check', () => {
    // Guards the regex itself: a refactor of App.tsx that changed the <Route>
    // shape would otherwise make this whole describe vacuously green.
    expect(declaredRoutes.length).toBeGreaterThan(25);
  });

  it('grants each declared route to at least one role', () => {
    const unreachable = declaredRoutes.filter((route) => {
      // Route patterns are relative in the nested <Routes> block, and carry
      // :params — normalise both before asking.
      const concrete = (route.startsWith('/') ? route : `/${route}`)
        .replace(/:[^/]+/g, 'x');
      return !ROLES.some((role) => canRoleAccessRoute(role, concrete));
    });

    expect(unreachable).toEqual([]);
  });
});
