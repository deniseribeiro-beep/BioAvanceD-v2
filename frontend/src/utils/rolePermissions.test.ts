import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canRoleAccessRoute, getRoleDescription, RoleName } from './rolePermissions';

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
    for (const route of ['/backup', '/security', '/admin/dicionario']) {
      expect(canRoleAccessRoute('Administrador', route)).toBe(true);
      expect(canRoleAccessRoute('Coordenador', route)).toBe(false);
      expect(canRoleAccessRoute('Técnico', route)).toBe(false);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  // #1228: Coordenador may mint Técnico accounts via user management.
  it('allows Coordenador on user-management routes', () => {
    for (const route of ['/system-management', '/users', '/users/new', '/access']) {
      expect(canRoleAccessRoute('Administrador', route)).toBe(true);
      expect(canRoleAccessRoute('Coordenador', route)).toBe(true);
      expect(canRoleAccessRoute('Técnico', route)).toBe(false);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  it('keeps /logs to Administrador and Coordenador', () => {
    for (const route of ['/logs', '/logs/123']) {
      expect(canRoleAccessRoute('Administrador', route)).toBe(true);
      expect(canRoleAccessRoute('Coordenador', route)).toBe(true);
      expect(canRoleAccessRoute('Técnico', route)).toBe(false);
      expect(canRoleAccessRoute('Usuário Externo', route)).toBe(false);
    }
  });

  // #825: /reports widened to include Usuário Externo (declared on its
  // <Route> all along), but /reports/templates -- narrower, RF008 AC#6 --
  // must stay Administrador+Coordenador even though it sits under /reports.
  it('keeps /reports to Administrador, Coordenador, and Usuário Externo', () => {
    expect(canRoleAccessRoute('Administrador', '/reports')).toBe(true);
    expect(canRoleAccessRoute('Coordenador', '/reports')).toBe(true);
    expect(canRoleAccessRoute('Usuário Externo', '/reports')).toBe(true);
    expect(canRoleAccessRoute('Técnico', '/reports')).toBe(false);
  });

  it('keeps /reports/templates to Administrador and Coordenador only', () => {
    expect(canRoleAccessRoute('Administrador', '/reports/templates')).toBe(true);
    expect(canRoleAccessRoute('Coordenador', '/reports/templates')).toBe(true);
    expect(canRoleAccessRoute('Técnico', '/reports/templates')).toBe(false);
    expect(canRoleAccessRoute('Usuário Externo', '/reports/templates')).toBe(false);
  });

  it('grants Coordenador the TCLE builder but keeps the rest of /admin Administrador-only', () => {
    expect(canRoleAccessRoute('Coordenador', '/admin/tcle/new')).toBe(true);
    expect(canRoleAccessRoute('Coordenador', '/admin/tcle/edit/abc')).toBe(true);
    expect(canRoleAccessRoute('Administrador', '/admin/tcle/new')).toBe(true);
    expect(canRoleAccessRoute('Administrador', '/admin/dicionario')).toBe(true);
    expect(canRoleAccessRoute('Coordenador', '/admin/dicionario')).toBe(false);
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
    expect(canRoleAccessRoute('Usuário Externo', '/reports/query/auditoria')).toBe(true);
    expect(canRoleAccessRoute('Usuário Externo', '/reports/507f1f77bcf86cd799439011')).toBe(true);
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

  // #825: "reachable by at least one role" passed even while the table denied
  // a role the <Route> itself granted, because ProtectedRoute's own
  // requiredRole prop and canRoleAccessRoute intersect -- the table's silent
  // narrowing never showed up as an unreachable route, only as a role that
  // could see the sidebar link but hit "Acesso Negado" on it. Every role
  // named in a <Route>'s own requiredRole array must therefore be granted by
  // the table too, not just some role.
  it('grants every role in a <Route>\'s own requiredRole array, not just one', () => {
    const routeBlocks = Array.from(appSource.matchAll(/<Route\b[\s\S]*?\/>/g)).map((m) => m[0]);

    const disagreements: string[] = [];

    for (const block of routeBlocks) {
      const pathMatch = block.match(/path="([^"]+)"/);
      if (!pathMatch) continue;
      const route = pathMatch[1];
      if (PUBLIC_ROUTES.includes(route)) continue;

      // Only routes declaring requiredRole as an array are in scope here --
      // a single string (e.g. requiredRole="Administrador") has only one
      // role to begin with, so "every role" is already covered by the
      // at-least-one-role test above.
      const roleArrayMatch = block.match(/requiredRole=\{\[([^\]]+)\]\}/);
      if (!roleArrayMatch) continue;

      const roles = Array.from(roleArrayMatch[1].matchAll(/'([^']+)'/g)).map(
        (m) => m[1] as RoleName
      );
      const concrete = (route.startsWith('/') ? route : `/${route}`).replace(/:[^/]+/g, 'x');

      for (const role of roles) {
        if (!canRoleAccessRoute(role, concrete)) {
          disagreements.push(`${role} denied ${concrete} (declared on <Route path="${route}">)`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});

// #1110: the assistant feature was deleted in 5e571099, and RF012 AC#10
// excludes IA/Assistente from the current scope outright ("Nao introduzir
// IA, Assistente Inteligente ou XAI no escopo atual"). This copy went on
// telling Usuario Externo they had assistant access, and security.service.js's
// useAssistant default -- the only thing that could have backed the claim --
// granted nothing and is removed in the same change. getRoleDescription had
// no test at all, which is how the copy outlived the feature.
describe('getRoleDescription — no role is promised a deleted feature (#1110)', () => {
  it('does not offer Usuário Externo an assistant', () => {
    expect(getRoleDescription('Usuário Externo')).toBe('Acesso limitado a relatórios');
  });

  it('mentions no assistant for any role', () => {
    for (const role of ROLES) {
      expect(getRoleDescription(role).toLowerCase()).not.toContain('assistente');
    }
  });
});
