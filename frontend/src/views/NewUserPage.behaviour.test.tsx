import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewUserPage from './NewUserPage';
import { userService } from '../services/api';
import { DEFAULT_PASSWORD_RULES, PasswordStrengthRules } from '../utils/passwordRules';

const navigate = vi.fn();
const routeState: { state: any } = { state: null };
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/users/new', search: '', hash: '', key: 'k', state: routeState.state }),
  };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string, fb?: string) => fb ?? k, language: 'pt-BR' }),
}));

const usersHook = {
  registerUser: vi.fn(),
  updateUser: vi.fn(),
  loadUsers: vi.fn(),
};
vi.mock('../hooks/useUsers', () => ({
  useUsers: () => usersHook,
}));

const orgsHook = { organizations: [] as any[] };
vi.mock('../hooks/useOrganizations', () => ({
  useOrganizations: () => orgsHook,
}));

const policy: { rules: PasswordStrengthRules } = { rules: DEFAULT_PASSWORD_RULES };
vi.mock('../hooks/usePasswordPolicy', () => ({
  usePasswordPolicy: () => policy.rules,
}));

vi.mock('../services/api', () => ({
  userService: { setPassword: vi.fn(), createInvite: vi.fn() },
}));

vi.mock('./UserOrganizationScopes', () => ({
  default: ({ userId, organizations }: { userId: string | number; organizations: any[] }) => (
    <div data-testid="scopes-stub">
      scopes:{String(userId)}:{organizations.length}
    </div>
  ),
}));

const STRONG = 'Senha-Longa-2026!';

const renderPage = () =>
  render(
    <MemoryRouter>
      <NewUserPage />
    </MemoryRouter>
  );

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement & HTMLSelectElement;
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });
const submit = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('new-user-form'));
  });
};
/** Direct register (legacy/lab): invite is the default create path in v2.1. */
const enableDirectRegister = () => {
  const invite = field('new-user-invite-checkbox');
  if (invite.checked) {
    fireEvent.click(invite);
  }
};

const fillValidCreate = () => {
  enableDirectRegister();
  type('new-user-name-input', 'Ana Silva');
  type('new-user-email-input', 'ana@example.com');
  type('new-user-username-input', 'ana');
  type('new-user-password-input', STRONG);
};

let alertSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigate.mockReset();
  routeState.state = null;
  usersHook.registerUser = vi.fn().mockResolvedValue(undefined);
  usersHook.updateUser = vi.fn().mockResolvedValue(undefined);
  usersHook.loadUsers = vi.fn().mockResolvedValue(undefined);
  orgsHook.organizations = [
    { organizationId: 'org-1', officialName: 'Hospital Um' },
    { organizationId: 'org-2', officialName: 'Hospital Dois' },
  ];
  policy.rules = DEFAULT_PASSWORD_RULES;
  vi.mocked(userService.setPassword).mockReset().mockResolvedValue({} as any);
  vi.mocked(userService.createInvite).mockReset().mockResolvedValue({
    data: { data: { inviteId: 'inv-1', email: 'ana@example.com', inviteLink: 'http://localhost/invite/accept?token=abc' } },
  } as any);
  alertSpy = vi.fn();
  vi.stubGlobal('alert', alertSpy);
  vi.stubGlobal('prompt', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NewUserPage: create', () => {
  it('renders the create form with invite-by-link default (v2.1 tenant-only)', () => {
    renderPage();
    expect(screen.getByText('users.newTitle')).toBeInTheDocument();
    expect(screen.getByText('users.newSubtitle')).toBeInTheDocument();
    const orgOptions = Array.from(field('new-user-organization-select').options).map((o) => o.textContent);
    expect(orgOptions).toEqual(['common.select', 'Hospital Um', 'Hospital Dois']);
    expect(field('new-user-role-select').value).toBe('Técnico');
    expect(screen.getByText('Operações básicas do sistema')).toBeInTheDocument();
    expect(field('new-user-invite-checkbox').checked).toBe(true);
    expect(screen.queryByTestId('new-user-password-input')).toBeNull();
    expect(screen.queryByTestId('new-user-status-select')).toBeNull();
    expect(screen.queryByTestId('new-user-auditor-checkbox')).toBeNull();
    expect(screen.queryByTestId('scopes-stub')).toBeNull();
  });

  it('invites the operator (no password) and surfaces the activation link', async () => {
    renderPage();
    type('new-user-name-input', 'Ana Silva');
    type('new-user-email-input', 'ana@example.com');
    type('new-user-username-input', 'ana');
    await submit();
    expect(userService.createInvite).toHaveBeenCalledTimes(1);
    expect(usersHook.registerUser).not.toHaveBeenCalled();
    expect(window.prompt).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/users');
  });

  it('lists only the policy rules in force and ticks each one the typed password meets', () => {
    policy.rules = {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
    };
    renderPage();
    enableDirectRegister();
    const items = () => Array.from(document.querySelectorAll('li')).map((li) => li.textContent);
    expect(items()).toEqual([
      '•Mínimo de 10 caracteres',
      '•password.requirements.upper',
      '•password.requirements.lower',
      '•password.requirements.number',
      '•password.requirements.symbol',
    ]);
    type('new-user-password-input', 'abcdefghijK');
    expect(items()).toEqual([
      '✓Mínimo de 10 caracteres',
      '✓password.requirements.upper',
      '✓password.requirements.lower',
      '•password.requirements.number',
      '•password.requirements.symbol',
    ]);
  });

  it('masks the phone while typing, capped at eleven digits', () => {
    renderPage();
    type('new-user-phone-input', '1');
    expect(field('new-user-phone-input').value).toBe('1');
    type('new-user-phone-input', '119');
    expect(field('new-user-phone-input').value).toBe('(11) 9');
    type('new-user-phone-input', '11987654321999');
    expect(field('new-user-phone-input').value).toBe('(11) 98765-4321');
  });

  it('registers the user with the normalized payload, reloads the list and returns to /users', async () => {
    renderPage();
    fillValidCreate();
    type('new-user-phone-input', '11987654321');
    fireEvent.change(field('new-user-organization-select'), { target: { value: 'org-2' } });
    fireEvent.change(field('new-user-status-select'), { target: { value: 'Suspenso' } });
    await submit();
    expect(usersHook.registerUser).toHaveBeenCalledTimes(1);
    const payload = usersHook.registerUser.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'Ana Silva',
      email: 'ana@example.com',
      username: 'ana',
      password: STRONG,
      phone: '11987654321',
      organizationId: 'org-2',
      roleName: 'Técnico',
      status: 'Suspenso',
    });
    expect(payload).not.toHaveProperty('accessIDs');
    expect(payload).not.toHaveProperty('mfaEnabled');
    expect(usersHook.loadUsers).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/users');
    expect(userService.setPassword).not.toHaveBeenCalled();
  });

  it('sends a cleared organization as null', async () => {
    renderPage();
    fillValidCreate();
    fireEvent.change(field('new-user-organization-select'), { target: { value: 'org-1' } });
    fireEvent.change(field('new-user-organization-select'), { target: { value: '' } });
    await submit();
    expect(usersHook.registerUser.mock.calls[0][0].organizationId).toBeNull();
  });

  it('the untouched default role registers a Técnico with access type 2 (#1464)', async () => {
    renderPage();
    fillValidCreate();
    expect(field('new-user-role-select').value).toBe('Técnico');
    await submit();
    const payload = usersHook.registerUser.mock.calls[0][0];
    expect(payload).toMatchObject({ roleName: 'Técnico', accessType: 2 });
  });

  it('switching the role to Administrador sets access type 4 and its description', async () => {
    renderPage();
    fillValidCreate();
    fireEvent.change(field('new-user-role-select'), { target: { value: 'Administrador' } });
    expect(
      screen.getByText('Acesso completo ao sistema, incluindo gerenciamento de usuários e backup')
    ).toBeInTheDocument();
    await submit();
    const payload = usersHook.registerUser.mock.calls[0][0];
    expect(payload).toMatchObject({ roleName: 'Administrador', accessType: 4 });
    expect(payload).not.toHaveProperty('mfaEnabled');
  });

  it('stops on HTML validation, focusing the first invalid field, and saves nothing', async () => {
    renderPage();
    await submit();
    expect(document.activeElement).toBe(field('new-user-name-input'));
    expect(usersHook.registerUser).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('refuses a blank-only name and username with one alert naming both', async () => {
    renderPage();
    fillValidCreate();
    type('new-user-name-input', '   ');
    type('new-user-username-input', '   ');
    await submit();
    expect(alertSpy).toHaveBeenCalledWith('users.nameRequired\nusers.usernameRequired');
    expect(usersHook.registerUser).not.toHaveBeenCalled();
  });

  it('refuses a password the policy rejects, with the policy message', async () => {
    renderPage();
    fillValidCreate();
    type('new-user-password-input', 'curta');
    await submit();
    expect(alertSpy).toHaveBeenCalledWith('A senha deve ter no mínimo 15 caracteres');
    expect(usersHook.registerUser).not.toHaveBeenCalled();
  });

  it('shows saving and disables both buttons while the save runs, ignoring a second submit', async () => {
    let resolve!: () => void;
    usersHook.registerUser = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    renderPage();
    fillValidCreate();
    await submit();
    const save = screen.getByTestId('new-user-submit-button') as HTMLButtonElement;
    expect(save).toHaveTextContent('users.saving');
    expect(save.disabled).toBe(true);
    expect((screen.getByText('common.cancel') as HTMLButtonElement).disabled).toBe(true);
    await submit();
    expect(usersHook.registerUser).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    await waitFor(() => expect(screen.getByTestId('new-user-submit-button')).toHaveTextContent('common.save'));
    expect(navigate).toHaveBeenCalledWith('/users');
  });

  it.each([
    ['the response error', { response: { data: { error: 'E-mail já cadastrado' } } }, 'E-mail já cadastrado'],
    ['the response message', { response: { data: { message: 'Usuário inválido' } } }, 'Usuário inválido'],
    ['the error message', new Error('Network Error'), 'Network Error'],
    ['users.saveError when the error says nothing', {}, 'users.saveError'],
  ])('a failed save alerts %s and stays on the page', async (_name, error, shown) => {
    usersHook.registerUser = vi.fn().mockRejectedValue(error);
    renderPage();
    fillValidCreate();
    await submit();
    expect(alertSpy).toHaveBeenCalledWith(shown);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-user-submit-button')).toHaveTextContent('common.save');
  });

  it('the back and cancel buttons return to /users', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(navigate).toHaveBeenNthCalledWith(1, '/users');
    expect(navigate).toHaveBeenNthCalledWith(2, '/users');
  });
});

const editUser = (overrides: Record<string, unknown> = {}) => ({
  _id: 'u-1',
  name: 'Bia Souza',
  email: 'bia@example.com',
  username: 'bia',
  phone: '11987654321',
  organizationId: 'org-1',
  roleName: 'Coordenador',
  accessType: 3,
  status: 'Ativo',
  auditorRole: false,
  ...overrides,
});

describe('NewUserPage: edit', () => {
  it('prefills the user, masks the stored phone and shows the scopes and the auditor box', () => {
    routeState.state = { user: editUser() };
    renderPage();
    expect(screen.getByText('users.editTitle')).toBeInTheDocument();
    expect(screen.getByText('users.editSubtitle')).toBeInTheDocument();
    expect(field('new-user-name-input').value).toBe('Bia Souza');
    expect(field('new-user-phone-input').value).toBe('(11) 98765-4321');
    expect(field('new-user-organization-select').value).toBe('org-1');
    expect(field('new-user-role-select').value).toBe('Coordenador');
    expect(field('new-user-password-input').required).toBe(false);
    expect(screen.getByTestId('scopes-stub')).toHaveTextContent('scopes:u-1:2');
    expect((screen.getByTestId('new-user-auditor-checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it.each([
    ['11', '11'],
    ['1198', '(11) 98'],
    ['abc', ''],
    [null, ''],
  ])('masks a stored phone %s as %s', (phone, shown) => {
    routeState.state = { user: editUser({ phone }) };
    renderPage();
    expect(field('new-user-phone-input').value).toBe(shown);
  });

  it.each([
    [4, 'Administrador'],
    [3, 'Coordenador'],
    [2, 'Técnico'],
    [1, 'Usuário Externo'],
    [7, 'Técnico'],
  ])('maps a stored access type %s with no role to %s', (accessType, roleName) => {
    routeState.state = { user: editUser({ roleName: undefined, accessType }) };
    renderPage();
    expect(field('new-user-role-select').value).toBe(roleName);
    expect(screen.getByText(`${roleName}:`)).toBeInTheDocument();
  });

  it.each([
    ['Coordenador', 3],
    ['Usuário Externo', 1],
    ['Desconhecido', 2],
  ])('maps a stored role %s with no access type to access type %s', async (roleName, accessType) => {
    routeState.state = { user: editUser({ roleName, accessType: undefined }) };
    renderPage();
    await submit();
    expect(usersHook.updateUser.mock.calls[0][1].accessType).toBe(accessType);
  });

  it('updates the user by _id with no password, auditorRole included, then reloads and returns', async () => {
    routeState.state = { user: editUser() };
    renderPage();
    fireEvent.click(screen.getByTestId('new-user-auditor-checkbox'));
    type('new-user-name-input', 'Bia S.');
    await submit();
    expect(userService.setPassword).not.toHaveBeenCalled();
    expect(usersHook.updateUser).toHaveBeenCalledTimes(1);
    const [id, payload] = usersHook.updateUser.mock.calls[0];
    expect(id).toBe('u-1');
    expect(payload).toMatchObject({ name: 'Bia S.', auditorRole: true, phone: '11987654321' });
    expect(payload).not.toHaveProperty('_id');
    expect(payload).not.toHaveProperty('password');
    expect(usersHook.loadUsers).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/users');
  });

  it('sets a typed password through its own route before the update, by id when there is no _id', async () => {
    const order: string[] = [];
    vi.mocked(userService.setPassword).mockImplementation(async () => { order.push('setPassword'); return {} as any; });
    usersHook.updateUser = vi.fn(async () => { order.push('updateUser'); });
    routeState.state = { user: editUser({ _id: undefined, id: 42 }) };
    renderPage();
    expect(screen.getByTestId('scopes-stub')).toHaveTextContent('scopes:42:2');
    type('new-user-password-input', STRONG);
    await submit();
    expect(userService.setPassword).toHaveBeenCalledWith(42, STRONG);
    expect(usersHook.updateUser.mock.calls[0][0]).toBe(42);
    expect(usersHook.updateUser.mock.calls[0][1]).not.toHaveProperty('password');
    expect(order).toEqual(['setPassword', 'updateUser']);
  });

  it('a refused password stops the save before the update', async () => {
    vi.mocked(userService.setPassword).mockRejectedValue({ response: { data: { error: 'Senha usada recentemente' } } });
    routeState.state = { user: editUser() };
    renderPage();
    type('new-user-password-input', STRONG);
    await submit();
    expect(alertSpy).toHaveBeenCalledWith('Senha usada recentemente');
    expect(usersHook.updateUser).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('alerts users.userIdNotFound for a user with no id, showing no scopes', async () => {
    routeState.state = { user: editUser({ _id: undefined }) };
    renderPage();
    expect(screen.queryByTestId('scopes-stub')).toBeNull();
    await submit();
    expect(alertSpy).toHaveBeenCalledWith('users.userIdNotFound');
    expect(usersHook.updateUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-user-submit-button')).toHaveTextContent('common.save');
  });

  it('refuses a user with no role or no status', async () => {
    routeState.state = { user: editUser({ roleName: '', accessType: 0, status: undefined }) };
    renderPage();
    await submit();
    expect(alertSpy).toHaveBeenCalledWith('users.roleRequired\nusers.statusRequired');
    expect(usersHook.updateUser).not.toHaveBeenCalled();
  });

  it('an administrator keeps mfaEnabled on edit, and re-picking Administrador resets it to false', async () => {
    routeState.state = { user: editUser({ roleName: 'Administrador', accessType: 4, mfaEnabled: true }) };
    renderPage();
    await submit();
    expect(usersHook.updateUser.mock.calls[0][1]).toMatchObject({ roleName: 'Administrador', mfaEnabled: true });

    fireEvent.change(field('new-user-role-select'), { target: { value: 'Técnico' } });
    await submit();
    expect(usersHook.updateUser.mock.calls[1][1]).toMatchObject({ roleName: 'Técnico', accessType: 2 });
    expect(usersHook.updateUser.mock.calls[1][1]).not.toHaveProperty('mfaEnabled');

    fireEvent.change(field('new-user-role-select'), { target: { value: 'Administrador' } });
    await submit();
    expect(usersHook.updateUser.mock.calls[2][1]).toMatchObject({ roleName: 'Administrador', accessType: 4, mfaEnabled: false });
  });
});
