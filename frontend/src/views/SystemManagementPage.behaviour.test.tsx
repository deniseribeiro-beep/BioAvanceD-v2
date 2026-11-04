import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SystemManagementPage from './SystemManagementPage';
import { userService } from '../services/api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string, fb?: string) => fb ?? k, language: 'pt-BR' }),
}));

const auth: { user: any } = { user: null };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

const usersHook = {
  users: [] as any[],
  loading: false,
  error: null as string | null,
  validateUserStatus: vi.fn(),
  deleteUser: vi.fn(),
  loadUsers: vi.fn(),
};
vi.mock('../hooks/useUsers', () => ({
  useUsers: () => usersHook,
}));

const orgsHook = {
  organizations: [] as any[],
  loading: false,
  error: null as string | null,
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
};
vi.mock('../hooks/useOrganizations', () => ({
  useOrganizations: () => orgsHook,
}));

const collectionsHook = {
  collections: [] as any[],
  loading: false,
  error: null as string | null,
  loadCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
};
vi.mock('../hooks/useCollections', () => ({
  useCollections: () => collectionsHook,
}));

vi.mock('../services/api', () => ({
  userService: {
    resetMFA: vi.fn(),
    disableMFA: vi.fn(),
    forcePasswordReset: vi.fn(),
    revokeSessions: vi.fn(),
  },
}));

// Both have their own hooks and services; the stubs keep this file on this page.
vi.mock('./SecurityPage', () => ({
  default: () => <div data-testid="security-page-stub" />,
}));
vi.mock('./CollectionGovernancePanel', () => ({
  default: ({ collection }: { collection: { collectionName: string } }) => (
    <div data-testid="governance-panel-stub">{collection.collectionName}</div>
  ),
}));

const service = vi.mocked(userService);
const ADMIN = { roleName: 'Administrador', accessType: 4 };
const COORDINATOR = { roleName: 'Coordenador', accessType: 3 };
const ORG = { organizationId: 'org-1', officialName: 'Hospital Central', countryCode: 'BR' };

const TECH_USER = {
  _id: 'u-1',
  name: 'Ana Técnica',
  email: 'ana@example.org',
  username: 'ana',
  roleName: 'Técnico',
  organizationId: 'org-1',
  status: 'Ativo',
  mfaEnabled: true,
};
const ADMIN_USER = {
  _id: 'u-9',
  name: 'Bruno Admin',
  email: 'bruno@example.org',
  username: 'bruno',
  roleName: 'Administrador',
  status: 'Ativo',
  mfaEnabled: true,
};

function renderPage(path = '/system') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SystemManagementPage />
    </MemoryRouter>
  );
}

// One paste per field instead of a keystroke per character keeps the form cases
// fast on a loaded machine; each onChange still sees the whole value.
async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input);
  await user.paste(value);
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement;
}

describe('SystemManagementPage', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = ADMIN;
    usersHook.users = [];
    usersHook.loading = false;
    usersHook.error = null;
    usersHook.deleteUser.mockResolvedValue(undefined);
    usersHook.loadUsers.mockResolvedValue(undefined);
    orgsHook.organizations = [];
    orgsHook.loading = false;
    orgsHook.error = null;
    orgsHook.createOrganization.mockResolvedValue(undefined);
    orgsHook.updateOrganization.mockResolvedValue(undefined);
    orgsHook.deleteOrganization.mockResolvedValue(undefined);
    collectionsHook.collections = [];
    collectionsHook.loading = false;
    collectionsHook.error = null;
    collectionsHook.loadCollections.mockResolvedValue(undefined);
    collectionsHook.createCollection.mockResolvedValue(undefined);
    collectionsHook.updateCollection.mockResolvedValue(undefined);
    collectionsHook.deleteCollection.mockResolvedValue(undefined);
    service.resetMFA.mockResolvedValue({} as any);
    service.disableMFA.mockResolvedValue({} as any);
    service.forcePasswordReset.mockResolvedValue({} as any);
    service.revokeSessions.mockResolvedValue({ data: { success: true, data: { revoked: 3, reason: 'risk' } } } as any);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Modal restores the scroll position on close; jsdom does not implement it.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tabs', () => {
    it('shows the users section when no tab is given', () => {
      renderPage();
      expect(screen.getByTestId('users-table')).toBeInTheDocument();
      expect(screen.getByText('Gerenciamento do Sistema')).toBeInTheDocument();
    });

    it('opens the collections section from ?tab=collections', () => {
      renderPage('/system?tab=collections');
      expect(screen.getByTestId('collections-table')).toBeInTheDocument();
      expect(screen.queryByTestId('users-table')).not.toBeInTheDocument();
    });

    it('falls back to the users section for an unknown tab', () => {
      renderPage('/system?tab=bogus');
      expect(screen.getByTestId('users-table')).toBeInTheDocument();
    });

    it('switches to organizations and to security on click', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByTestId('system-tab-organizations'));
      expect(screen.getByTestId('organizations-table')).toBeInTheDocument();
      expect(screen.queryByTestId('users-table')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('system-tab-security'));
      expect(screen.getByTestId('security-page-stub')).toBeInTheDocument();
      expect(screen.queryByTestId('organizations-table')).not.toBeInTheDocument();
    });
  });

  describe('users table', () => {
    it('shows the loading text while users load', () => {
      usersHook.loading = true;
      renderPage();
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });

    it('shows the load error', () => {
      usersHook.error = 'falha de rede';
      renderPage();
      expect(screen.getByText('common.error: falha de rede')).toBeInTheDocument();
    });

    it("resolves the user's organization to its official name", () => {
      orgsHook.organizations = [ORG];
      usersHook.users = [TECH_USER];
      renderPage();
      expect(within(rowOf('Ana Técnica')).getByText('Hospital Central')).toBeInTheDocument();
    });

    it('labels the role from roleName, else from accessType', () => {
      usersHook.users = [
        { _id: 'r-1', name: 'Role Admin', roleName: 'Administrador' },
        { _id: 'r-2', name: 'Role Coord', roleName: 'Coordenador' },
        { _id: 'r-3', name: 'Role Tech', roleName: 'Técnico' },
        { _id: 'r-4', name: 'Role External', roleName: 'Usuário Externo' },
        { _id: 'r-5', name: 'Role Custom', roleName: 'Pesquisador' },
        { _id: 'a-4', name: 'Access 4', accessType: 4 },
        { _id: 'a-3', name: 'Access 3', accessType: 3 },
        { _id: 'a-2', name: 'Access 2', accessType: 2 },
        { _id: 'a-1', name: 'Access 1', accessType: 1 },
        { _id: 'a-0', name: 'Access none' },
      ];
      renderPage();
      expect(within(rowOf('Role Admin')).getByText('Administrador')).toBeInTheDocument();
      expect(within(rowOf('Role Coord')).getByText('Coordenador')).toBeInTheDocument();
      expect(within(rowOf('Role Tech')).getByText('Técnico')).toBeInTheDocument();
      expect(within(rowOf('Role External')).getByText('Usuário Externo')).toBeInTheDocument();
      expect(within(rowOf('Role Custom')).getByText('Pesquisador')).toBeInTheDocument();
      expect(within(rowOf('Access 4')).getByText('Administrador')).toBeInTheDocument();
      expect(within(rowOf('Access 3')).getByText('Coordenador')).toBeInTheDocument();
      expect(within(rowOf('Access 2')).getByText('Técnico')).toBeInTheDocument();
      expect(within(rowOf('Access 1')).getByText('Usuário Externo')).toBeInTheDocument();
      expect(within(rowOf('Access none')).getByText('Técnico')).toBeInTheDocument();
    });

    it('shows the auditor badge beside the main role', () => {
      usersHook.users = [{ ...TECH_USER, auditorRole: true }, { ...TECH_USER, _id: 'u-2', name: 'Sem Auditor' }];
      renderPage();
      expect(screen.getByTestId('auditor-badge-u-1')).toHaveTextContent('users.auditorBadge');
      expect(screen.queryByTestId('auditor-badge-u-2')).not.toBeInTheDocument();
    });

    it('reads an empty status as active', () => {
      usersHook.users = [{ ...TECH_USER, status: '' }];
      renderPage();
      expect(within(rowOf('Ana Técnica')).getByText('users.statusActive')).toBeInTheDocument();
    });

    it('marks MFA not applicable on an admin row and offers no reset there', () => {
      usersHook.users = [ADMIN_USER, TECH_USER];
      renderPage();
      expect(within(rowOf('Bruno Admin')).getByText('users.mfaNotApplicable')).toBeInTheDocument();
      expect(screen.queryByTestId('reset-mfa-button-u-9')).not.toBeInTheDocument();
      expect(screen.getByTestId('reset-mfa-button-u-1')).toBeInTheDocument();
      expect(within(rowOf('Ana Técnica')).getByText('users.mfaEnabled')).toBeInTheDocument();
    });

    it('offers disable MFA only to an admin, on an admin row with MFA on', () => {
      usersHook.users = [
        ADMIN_USER,
        { ...ADMIN_USER, _id: 'u-10', name: 'Admin Sem MFA', mfaEnabled: false },
        TECH_USER,
      ];
      const { unmount } = renderPage();
      expect(screen.getByTestId('disable-mfa-button-u-9')).toBeInTheDocument();
      expect(screen.queryByTestId('disable-mfa-button-u-10')).not.toBeInTheDocument();
      expect(screen.queryByTestId('disable-mfa-button-u-1')).not.toBeInTheDocument();
      unmount();

      auth.user = COORDINATOR;
      renderPage();
      expect(screen.queryByTestId('disable-mfa-button-u-9')).not.toBeInTheDocument();
    });

    it('filters the table by email substring and restores the full list when cleared', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER, ADMIN_USER];
      renderPage();
      expect(screen.getByText('Ana Técnica')).toBeInTheDocument();
      expect(screen.getByText('Bruno Admin')).toBeInTheDocument();
      expect(screen.getByTestId('reset-mfa-button-u-1')).toBeInTheDocument();

      await user.type(screen.getByTestId('users-search-input'), 'bruno@example');
      expect(screen.queryByText('Ana Técnica')).not.toBeInTheDocument();
      expect(screen.getByText('Bruno Admin')).toBeInTheDocument();
      expect(screen.queryByTestId('reset-mfa-button-u-1')).not.toBeInTheDocument();

      await user.clear(screen.getByTestId('users-search-input'));
      expect(screen.getByText('Ana Técnica')).toBeInTheDocument();
      expect(screen.getByText('Bruno Admin')).toBeInTheDocument();
      expect(screen.getByTestId('reset-mfa-button-u-1')).toBeInTheDocument();
    });

    it('shows the empty state when the query matches no user', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER, ADMIN_USER];
      renderPage();
      await user.type(screen.getByTestId('users-search-input'), 'zzz-no-match');
      expect(screen.getByTestId('users-search-empty')).toBeInTheDocument();
      expect(screen.queryByText('Ana Técnica')).not.toBeInTheDocument();
      expect(screen.queryByTestId('reset-mfa-button-u-1')).not.toBeInTheDocument();
    });
  });

  describe('MFA and password actions', () => {
    it('resets MFA with the row _id, alerts success and reloads', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      renderPage();
      await user.click(screen.getByTestId('reset-mfa-button-u-1'));
      expect(confirmSpy).toHaveBeenCalledWith('users.mfaResetConfirm');
      await waitFor(() => expect(usersHook.loadUsers).toHaveBeenCalledTimes(1));
      expect(service.resetMFA).toHaveBeenCalledWith('u-1');
      expect(alertSpy).toHaveBeenCalledWith('users.mfaResetSuccess');
    });

    it('falls back to the row id and asks the inactive confirm when MFA is off', async () => {
      const user = userEvent.setup();
      usersHook.users = [{ id: 7, name: 'Carla', roleName: 'Técnico', mfaEnabled: false }];
      renderPage();
      await user.click(screen.getByTestId('reset-mfa-button-7'));
      expect(confirmSpy).toHaveBeenCalledWith('users.mfaResetConfirmInactive');
      await waitFor(() => expect(service.resetMFA).toHaveBeenCalledWith(7));
    });

    it('resets nothing when the confirm is cancelled', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      confirmSpy.mockReturnValueOnce(false);
      renderPage();
      await user.click(screen.getByTestId('reset-mfa-button-u-1'));
      expect(service.resetMFA).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it("alerts the server's error, then the plain message, when a reset fails", async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      service.resetMFA.mockRejectedValueOnce({ response: { data: { error: 'MFA bloqueado' } } });
      renderPage();
      await user.click(screen.getByTestId('reset-mfa-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('MFA bloqueado'));
      service.resetMFA.mockRejectedValueOnce(new Error('sem rede'));
      await user.click(screen.getByTestId('reset-mfa-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('sem rede'));
      service.resetMFA.mockRejectedValueOnce({});
      await user.click(screen.getByTestId('reset-mfa-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('users.mfaResetError'));
      expect(usersHook.loadUsers).not.toHaveBeenCalled();
    });

    it('disables MFA on an admin row, alerts success and reloads', async () => {
      const user = userEvent.setup();
      usersHook.users = [ADMIN_USER];
      renderPage();
      await user.click(screen.getByTestId('disable-mfa-button-u-9'));
      expect(confirmSpy).toHaveBeenCalledWith('users.mfaDisableConfirm');
      await waitFor(() => expect(usersHook.loadUsers).toHaveBeenCalledTimes(1));
      expect(service.disableMFA).toHaveBeenCalledWith('u-9');
      expect(alertSpy).toHaveBeenCalledWith('users.mfaDisableSuccess');
    });

    it('disables nothing on cancel and alerts a failure', async () => {
      const user = userEvent.setup();
      usersHook.users = [ADMIN_USER];
      renderPage();
      confirmSpy.mockReturnValueOnce(false);
      await user.click(screen.getByTestId('disable-mfa-button-u-9'));
      expect(service.disableMFA).not.toHaveBeenCalled();
      service.disableMFA.mockRejectedValueOnce({ response: { data: { error: 'negado' } } });
      await user.click(screen.getByTestId('disable-mfa-button-u-9'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('negado'));
      service.disableMFA.mockRejectedValueOnce(new Error('caiu'));
      await user.click(screen.getByTestId('disable-mfa-button-u-9'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('caiu'));
      expect(usersHook.loadUsers).not.toHaveBeenCalled();
    });

    it('forces a password reset, alerts success and reloads', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      renderPage();
      await user.click(screen.getByTestId('force-password-reset-button-u-1'));
      expect(confirmSpy).toHaveBeenCalledWith('users.forcePasswordResetConfirm');
      await waitFor(() => expect(usersHook.loadUsers).toHaveBeenCalledTimes(1));
      expect(service.forcePasswordReset).toHaveBeenCalledWith('u-1');
      expect(alertSpy).toHaveBeenCalledWith('users.forcePasswordResetSuccess');
    });

    it('forces nothing on cancel and alerts a failure', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      renderPage();
      confirmSpy.mockReturnValueOnce(false);
      await user.click(screen.getByTestId('force-password-reset-button-u-1'));
      expect(service.forcePasswordReset).not.toHaveBeenCalled();
      service.forcePasswordReset.mockRejectedValueOnce({ response: { data: { error: 'proibido' } } });
      await user.click(screen.getByTestId('force-password-reset-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('proibido'));
      service.forcePasswordReset.mockRejectedValueOnce(new Error('timeout'));
      await user.click(screen.getByTestId('force-password-reset-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('timeout'));
      expect(usersHook.loadUsers).not.toHaveBeenCalled();
    });

    it('alerts userIdNotFound and calls nothing for a row with no id', async () => {
      const user = userEvent.setup();
      usersHook.users = [{ name: 'Sem Id', roleName: 'Técnico' }];
      renderPage();
      await user.click(screen.getByTestId('reset-mfa-button-undefined'));
      await user.click(screen.getByTestId('force-password-reset-button-undefined'));
      await user.click(screen.getByTestId('revoke-sessions-button-undefined'));
      expect(alertSpy).toHaveBeenCalledTimes(3);
      expect(alertSpy).toHaveBeenNthCalledWith(1, 'users.userIdNotFound');
      expect(alertSpy).toHaveBeenNthCalledWith(3, 'users.userIdNotFound');
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(service.resetMFA).not.toHaveBeenCalled();
      expect(service.forcePasswordReset).not.toHaveBeenCalled();
      expect(service.revokeSessions).not.toHaveBeenCalled();
    });

    it('alerts userIdNotFound on disable MFA for an admin row with no id', async () => {
      const user = userEvent.setup();
      usersHook.users = [{ name: 'Admin Sem Id', roleName: 'Administrador', mfaEnabled: true }];
      renderPage();
      await user.click(screen.getByTestId('disable-mfa-button-undefined'));
      expect(alertSpy).toHaveBeenCalledWith('users.userIdNotFound');
      expect(service.disableMFA).not.toHaveBeenCalled();
    });
  });

  describe('revoke sessions', () => {
    it('revokes nothing when the first confirm is cancelled', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      confirmSpy.mockReturnValueOnce(false);
      renderPage();
      await user.click(screen.getByTestId('revoke-sessions-button-u-1'));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith('Revogar todas as sessões ativas de Ana Técnica?');
      expect(service.revokeSessions).not.toHaveBeenCalled();
    });

    it("records 'risk' when the account is judged compromised and alerts the count", async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);
      renderPage();
      await user.click(screen.getByTestId('revoke-sessions-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('3 sessão(ões) revogada(s).'));
      expect(service.revokeSessions).toHaveBeenCalledWith('u-1', 'risk');
    });

    it("records 'admin_action' when the second confirm is cancelled", async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
      renderPage();
      await user.click(screen.getByTestId('revoke-sessions-button-u-1'));
      await waitFor(() => expect(service.revokeSessions).toHaveBeenCalledWith('u-1', 'admin_action'));
    });

    it("alerts the server's message when revoking fails", async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      service.revokeSessions.mockRejectedValueOnce({ response: { data: { message: 'Sessões indisponíveis' } } });
      renderPage();
      await user.click(screen.getByTestId('revoke-sessions-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Sessões indisponíveis'));
      service.revokeSessions.mockRejectedValueOnce({});
      await user.click(screen.getByTestId('revoke-sessions-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao revogar sessões'));
    });
  });

  describe('delete, edit and new user', () => {
    it('deletes the user on confirm and reloads', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      renderPage();
      await user.click(screen.getByTestId('delete-user-button-u-1'));
      expect(confirmSpy).toHaveBeenCalledWith('users.deleteConfirm');
      await waitFor(() => expect(usersHook.loadUsers).toHaveBeenCalledTimes(1));
      expect(usersHook.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('alerts when the delete fails', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      usersHook.deleteUser.mockRejectedValueOnce({ response: { data: { error: 'em uso' } } });
      renderPage();
      await user.click(screen.getByTestId('delete-user-button-u-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('em uso'));
      expect(usersHook.loadUsers).not.toHaveBeenCalled();
    });

    it('opens the user form for an edit and for a new user', async () => {
      const user = userEvent.setup();
      usersHook.users = [TECH_USER];
      renderPage();
      await user.click(screen.getByTestId('edit-user-button-u-1'));
      expect(navigate).toHaveBeenCalledWith('/users/new', { state: { user: TECH_USER } });
      await user.click(screen.getByTestId('new-user-button'));
      expect(navigate).toHaveBeenLastCalledWith('/users/new');
    });
  });

  describe('organizations', () => {
    const FULL_ORG = {
      organizationId: 'org-1',
      officialName: 'Hospital Central',
      acronym: 'HC',
      organizationType: 'hospital',
      countryCode: 'BR',
      website: 'https://hc.example.org',
    };

    it('shows the empty message, and the loading text while loading', () => {
      const { unmount } = renderPage('/system?tab=organizations');
      expect(screen.getByText('Nenhuma organização cadastrada')).toBeInTheDocument();
      unmount();

      orgsHook.loading = true;
      orgsHook.error = 'falhou';
      renderPage('/system?tab=organizations');
      expect(screen.getAllByText('common.loading')).toHaveLength(2);
      expect(screen.getByText('common.error: falhou')).toBeInTheDocument();
      expect(screen.queryByText('Nenhuma organização cadastrada')).not.toBeInTheDocument();
    });

    it('shows a dash for a missing acronym, type and website', () => {
      orgsHook.organizations = [ORG];
      renderPage('/system?tab=organizations');
      expect(within(rowOf('Hospital Central')).getAllByText('-')).toHaveLength(3);
    });

    it('navigates to Nova Organização page', async () => {
      const user = userEvent.setup();
      renderPage('/system?tab=organizations');
      await user.click(screen.getByTestId('new-organization-button'));
      expect(navigate).toHaveBeenCalledWith('/organizations/new');
    });

    it('navigates to Editar Organização with state', async () => {
      const user = userEvent.setup();
      orgsHook.organizations = [FULL_ORG];
      renderPage('/system?tab=organizations');
      await user.click(screen.getByTestId('edit-organization-button-org-1'));
      expect(navigate).toHaveBeenCalledWith('/organizations/org-1/edit', {
        state: { organization: FULL_ORG },
      });
    });

    it('deletes an organization on confirm and alerts a failure', async () => {
      const user = userEvent.setup();
      orgsHook.organizations = [FULL_ORG];
      renderPage('/system?tab=organizations');
      await user.click(screen.getByTestId('delete-organization-button-org-1'));
      expect(confirmSpy).toHaveBeenCalledWith('Tem certeza que deseja excluir esta organização?');
      await waitFor(() => expect(orgsHook.deleteOrganization).toHaveBeenCalledWith('org-1'));
      orgsHook.deleteOrganization.mockRejectedValueOnce(new Error('Organização em uso'));
      await user.click(screen.getByTestId('delete-organization-button-org-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Organização em uso'));
    });
  });

  describe('collections', () => {
    const GOVERNED = {
      collectionId: 'col-1',
      collectionName: 'Coleção Oncológica',
      collectionStatus: 'active',
      governanceRegime: 'biobank',
      sampleTypes: [{ text: 'plasma' }],
    };

    it('shows the empty message', () => {
      collectionsHook.error = 'erro';
      renderPage('/system?tab=collections');
      expect(screen.getByText('Nenhuma coleção cadastrada')).toBeInTheDocument();
      expect(screen.getByText('common.error: erro')).toBeInTheDocument();
    });

    it('shows the loading text while loading', () => {
      collectionsHook.loading = true;
      renderPage('/system?tab=collections');
      expect(screen.getAllByText('common.loading')).toHaveLength(2);
    });

    it('reads a missing status as active and missing sample types as a dash', () => {
      collectionsHook.collections = [{ collectionId: 'col-2', collectionName: 'Sem Status' }, GOVERNED];
      renderPage('/system?tab=collections');
      const row = rowOf('Sem Status');
      expect(within(row).getByText('active')).toBeInTheDocument();
      expect(within(row).getByText('-')).toBeInTheDocument();
      expect(within(rowOf('Coleção Oncológica')).getByText('plasma')).toBeInTheDocument();
    });

    it('navigates to Nova Coleção page', async () => {
      const user = userEvent.setup();
      renderPage('/system?tab=collections');
      await user.click(screen.getByTestId('new-collection-button'));
      expect(navigate).toHaveBeenCalledWith('/collections/new');
    });

    it('navigates to Editar Coleção with state', async () => {
      const user = userEvent.setup();
      collectionsHook.collections = [GOVERNED];
      renderPage('/system?tab=collections');
      await user.click(screen.getByTestId('edit-collection-button-col-1'));
      expect(navigate).toHaveBeenCalledWith('/collections/col-1/edit', {
        state: { collection: GOVERNED },
      });
    });

    it('deletes a collection on confirm and alerts a failure', async () => {
      const user = userEvent.setup();
      collectionsHook.collections = [GOVERNED];
      renderPage('/system?tab=collections');
      await user.click(screen.getByTestId('delete-collection-button-col-1'));
      expect(confirmSpy).toHaveBeenCalledWith('Tem certeza que deseja excluir esta coleção?');
      await waitFor(() => expect(collectionsHook.deleteCollection).toHaveBeenCalledWith('col-1'));
      collectionsHook.deleteCollection.mockRejectedValueOnce(new Error('Coleção com amostras'));
      await user.click(screen.getByTestId('delete-collection-button-col-1'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Coleção com amostras'));
    });

    it('navigates to governance page with state', async () => {
      const user = userEvent.setup();
      collectionsHook.collections = [GOVERNED];
      renderPage('/system?tab=collections');
      await user.click(screen.getByTestId('governance-collection-button-col-1'));
      expect(navigate).toHaveBeenCalledWith('/collections/col-1/governance', {
        state: { collection: GOVERNED },
      });
    });
  });
});
