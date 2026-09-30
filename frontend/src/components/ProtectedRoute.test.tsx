import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1239: requireAuditReader follows the backend's audit-trail rule through the
// user's isAuditReader flag, whatever the base role.
const authState: { user: Record<string, unknown> | null } = { user: null };

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: authState.user,
    hasAccess: () => true,
    hasRole: () => true,
    canAccessRoute: () => true,
  }),
}));

import ProtectedRoute from './ProtectedRoute';

function renderLogs() {
  return render(
    <MemoryRouter initialEntries={['/logs']}>
      <ProtectedRoute requireAuditReader>
        <p>logs content</p>
      </ProtectedRoute>
    </MemoryRouter>
  );
}

describe('ProtectedRoute requireAuditReader (#1239)', () => {
  beforeEach(() => {
    authState.user = null;
  });

  it('admits a Técnico holding the auditor role', () => {
    authState.user = { roleName: 'Técnico', isAuditReader: true };
    renderLogs();
    expect(screen.getByText('logs content')).toBeTruthy();
  });

  it('refuses a Coordenador without it', () => {
    authState.user = { roleName: 'Coordenador', isAuditReader: false };
    renderLogs();
    expect(screen.queryByText('logs content')).toBeNull();
    expect(screen.getByText('Acesso Negado')).toBeTruthy();
  });

  it('refuses when the flag is absent, e.g. a user object cached before the field existed', () => {
    authState.user = { roleName: 'Administrador' };
    renderLogs();
    expect(screen.queryByText('logs content')).toBeNull();
  });
});
