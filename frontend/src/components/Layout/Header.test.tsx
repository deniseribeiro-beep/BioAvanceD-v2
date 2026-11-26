import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Header from './Header';

let user: { name?: string; roleName?: string; accessType?: number } | null = null;
const logout = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user, logout }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    language: 'pt-BR',
    setLanguage: vi.fn(),
  }),
}));

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Header />
      <Routes>
        <Route path="/security" element={<div>security-page</div>} />
        <Route path="/system-management" element={<div>settings-page</div>} />
        <Route path="/next/intake" element={<div>intake-page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Header account menu', () => {
  beforeEach(() => {
    user = null;
  });

  it('shows a menu cue on the administrator name', () => {
    user = { name: 'E2E Test Admin', roleName: 'Administrador', accessType: 4 };
    renderHeader();
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger).toHaveTextContent('E2E Test Admin');
    expect(trigger.querySelector('[data-testid="account-menu-chevron"]')).not.toBeNull();
  });

  it('names the account menu by its own text, with no aria-label to contradict it (RNF027, #1544)', () => {
    user = { name: 'Ana Costa', roleName: 'Administrador', accessType: 4 };
    renderHeader();
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger).not.toHaveAttribute('aria-label');
    expect(trigger).toHaveAccessibleName(/^AC Ana Costa/);
  });

  it('leaves the other profile as a static name', () => {
    user = { name: 'Tecnico Local', roleName: 'Técnico', accessType: 2 };
    renderHeader();
    expect(screen.queryByTestId('account-menu-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-menu-chevron')).not.toBeInTheDocument();
    expect(screen.getByText('Tecnico Local')).toBeInTheDocument();
    expect(screen.getByText('roles.access: roles.technician')).toBeInTheDocument();
  });

  it('opens security and settings from the administrator menu and signs out', async () => {
    user = { name: 'Ana Costa', roleName: 'Administrador', accessType: 4 };
    const actor = userEvent.setup();
    renderHeader();

    expect(screen.getByText('AC')).toBeInTheDocument();
    await actor.click(screen.getByTestId('account-menu-trigger'));
    await actor.click(await screen.findByTestId('account-menu-security'));
    expect(screen.getByText('security-page')).toBeInTheDocument();

    await actor.click(screen.getByTestId('account-menu-trigger'));
    await actor.click(await screen.findByTestId('account-menu-settings'));
    expect(screen.getByText('settings-page')).toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: 'auth.logout' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('opens the intake for a coordinator and labels each access type', async () => {
    const actor = userEvent.setup();
    user = { name: 'Coordenacao', roleName: 'Coordenador', accessType: 3 };
    const { unmount } = renderHeader();
    await actor.click(screen.getByRole('button', { name: 'navigation.newIntake' }));
    expect(screen.getByText('intake-page')).toBeInTheDocument();
    expect(screen.getByText('roles.access: roles.coordinator')).toBeInTheDocument();
    unmount();

    user = { name: 'Visitante', roleName: 'Usuário Externo', accessType: 1 };
    renderHeader();
    expect(screen.queryByRole('button', { name: 'navigation.newIntake' })).not.toBeInTheDocument();
    expect(screen.getByText('roles.access: roles.externalUser')).toBeInTheDocument();
  });

  it('falls back to the access type, an unknown role and a blank name', () => {
    user = { accessType: 1 };
    const { unmount } = renderHeader();
    expect(screen.getByText('roles.access: roles.basic')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
    unmount();

    user = { name: 'Pessoa', roleName: 'Auditor', accessType: 2 };
    const second = renderHeader();
    expect(screen.getByText('roles.access: Auditor')).toBeInTheDocument();
    second.unmount();

    user = { name: 'Pessoa', accessType: 3 };
    const third = renderHeader();
    expect(screen.getByText('roles.access: roles.complete')).toBeInTheDocument();
    third.unmount();

    user = { name: 'Pessoa', accessType: 9 };
    const fourth = renderHeader();
    expect(screen.getByText('roles.access: roles.unknown')).toBeInTheDocument();
    fourth.unmount();

    user = null;
    renderHeader();
    expect(screen.queryByTestId('account-menu-trigger')).not.toBeInTheDocument();
  });
});
