import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1252: the code accepted before a required password change rides along
// with the change submit, so an MFA-enrolled user types one code, not two.
const login = vi.fn();
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  requestPasswordReset: vi.fn(),
  auth: { isAuthenticated: false, user: null as null | { roleName?: string; accessType?: number } },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login, isAuthenticated: h.auth.isAuthenticated, user: h.auth.user }),
}));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../components/LanguageSelector', () => ({ default: () => null }));
const getPasswordPolicy = vi.fn();
vi.mock('../services/api', () => ({
  authService: {
    getPasswordPolicy: () => getPasswordPolicy(),
    requestPasswordReset: (email: string) => h.requestPasswordReset(email),
  },
}));

import LoginPage from './LoginPage';

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function submit() {
  fireEvent.click(screen.getByTestId('login-submit-button'));
  await waitFor(() => expect(screen.getByTestId('login-submit-button')).not.toBeDisabled());
}

describe('LoginPage MFA code across a required password change (#1252)', () => {
  beforeEach(() => {
    login.mockReset();
    getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: true } } });
  });

  async function reachPasswordChange() {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    login.mockResolvedValueOnce({ requiresTwoFactor: true });
    fill('login-username-input', 'tecnico');
    fill('login-password-input', 'Old@pass1234');
    await submit();

    login.mockResolvedValueOnce({ requiresPasswordChange: true });
    fill('login-mfa-code-input', '123456');
    await submit();
    expect(screen.getByTestId('force-password-change-section')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-section')).toBeNull();

    fill('login-new-password-input', 'New@pass12345');
    fill('login-confirm-new-password-input', 'New@pass12345');
  }

  it('sends the accepted code with the new password', async () => {
    await reachPasswordChange();
    login.mockResolvedValueOnce({ user: { roleName: 'Técnico', accessType: 2 } });
    await submit();

    expect(login).toHaveBeenLastCalledWith('tecnico', 'Old@pass1234', '123456', 'New@pass12345');
  });

  it('asks again with an empty field when the carried code has expired', async () => {
    await reachPasswordChange();
    login.mockResolvedValueOnce({ requiresTwoFactor: true });
    await submit();

    expect(screen.getByTestId('two-factor-section')).toBeTruthy();
    expect((screen.getByTestId('login-mfa-code-input') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('force-password-change-section')).toBeTruthy();
  });

  it('sends no code for an unenrolled user whose change is forced', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    login.mockResolvedValueOnce({ requiresPasswordChange: true });
    fill('login-username-input', 'admin2');
    fill('login-password-input', 'Old@pass1234');
    await submit();
    fill('login-new-password-input', 'New@pass12345');
    fill('login-confirm-new-password-input', 'New@pass12345');
    login.mockResolvedValueOnce({ user: { roleName: 'Administrador', accessType: 4 } });
    await submit();

    expect(login).toHaveBeenLastCalledWith('admin2', 'Old@pass1234', undefined, 'New@pass12345');
  });
});

// #1249: authentication.allowPasswordReset, served by the public password-policy route.
describe('LoginPage forgot-password link (#1249)', () => {
  function renderPage() {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
  }

  it('is hidden while the policy turns the reset flow off', async () => {
    getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: false } } });
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('login-forgot-password-button')).toBeNull());
  });

  it('shows by default, and when the policy cannot be read', async () => {
    getPasswordPolicy.mockRejectedValue(new Error('offline'));
    renderPage();
    await waitFor(() => expect(getPasswordPolicy).toHaveBeenCalled());
    expect(screen.getByTestId('login-forgot-password-button')).toBeTruthy();
  });
});

// #1291: only an administrator's forceReset is the administrator's request.
describe('LoginPage forced-change reason (#1291)', () => {
  beforeEach(() => {
    login.mockReset();
    getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: true } } });
  });

  async function reachWith(result: Record<string, unknown>) {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    login.mockResolvedValueOnce(result);
    fill('login-username-input', 'tecnico');
    fill('login-password-input', 'Old@pass1234');
    await submit();
    return screen.getByTestId('force-password-change-reason').textContent;
  }

  it.each([
    [undefined, 'auth.passwordChangeRequired'],
    ['expired', 'auth.passwordChangeRequiredExpired'],
    ['below_policy', 'auth.passwordChangeRequiredBelowPolicy'],
  ])('reason %s shows %s', async (reason, key) => {
    const text = await reachWith({ requiresPasswordChange: true, ...(reason ? { passwordChangeReason: reason } : {}) });
    expect(text).toBe(key);
  });
});

// #1331: the MFA step offers a saved recovery code in place of the TOTP code.
describe('LoginPage recovery code at the MFA step (#1331)', () => {
  beforeEach(() => {
    login.mockReset();
    getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: true } } });
  });

  async function reachMfaStep() {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    login.mockResolvedValueOnce({ requiresTwoFactor: true });
    fill('login-username-input', 'tecnico');
    fill('login-password-input', 'Old@pass1234');
    await submit();
  }

  it('sends the recovery code, upper-cased, in the code field', async () => {
    await reachMfaStep();
    fireEvent.click(screen.getByTestId('login-toggle-recovery-code'));
    expect(screen.queryByTestId('login-mfa-code-input')).toBeNull();
    fill('login-recovery-code-input', 'abcd-2345');
    expect((screen.getByTestId('login-recovery-code-input') as HTMLInputElement).value).toBe('ABCD-2345');

    login.mockResolvedValueOnce({ user: { roleName: 'Técnico', accessType: 2 } });
    await submit();

    expect(login).toHaveBeenLastCalledWith('tecnico', 'Old@pass1234', 'ABCD-2345', undefined);
  });

  it('switches back to the six-digit field with the field cleared', async () => {
    await reachMfaStep();
    fireEvent.click(screen.getByTestId('login-toggle-recovery-code'));
    fill('login-recovery-code-input', 'ABCD2345');
    fireEvent.click(screen.getByTestId('login-toggle-recovery-code'));

    expect(screen.queryByTestId('login-recovery-code-input')).toBeNull();
    expect((screen.getByTestId('login-mfa-code-input') as HTMLInputElement).value).toBe('');
  });
});

function renderLogin(state?: Record<string, unknown>) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <LoginPage />
    </MemoryRouter>
  );
}

async function signIn(username = 'tecnico', password = 'Old@pass1234') {
  fill('login-username-input', username);
  fill('login-password-input', password);
  await submit();
}

function resetMocks() {
  login.mockReset();
  h.navigate.mockReset();
  h.requestPasswordReset.mockReset();
  h.auth.isAuthenticated = false;
  h.auth.user = null;
  getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: true } } });
}

describe('LoginPage routing after sign-in', () => {
  beforeEach(resetMocks);

  it('sends an already signed-in user to the route of their role', () => {
    h.auth.isAuthenticated = true;
    h.auth.user = { roleName: 'Administrador', accessType: 4 };
    renderLogin();
    expect(h.navigate).toHaveBeenCalledWith('/system-management');
  });

  it('stays on the page while nobody is signed in', () => {
    renderLogin();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('replaces the login entry with the route of the signed-in role', async () => {
    renderLogin();
    login.mockResolvedValueOnce({ user: { roleName: 'Coordenador', accessType: 3 } });
    await signIn();
    expect(login).toHaveBeenLastCalledWith('tecnico', 'Old@pass1234', undefined, undefined);
    expect(h.navigate).toHaveBeenCalledWith('/reports', { replace: true });
  });

  it('sends a first login without MFA to the enrolment page with its credentials', async () => {
    renderLogin();
    login.mockResolvedValueOnce({ requiresTwoFactorSetup: true });
    await signIn('novo', 'Temp@pass1234');
    expect(h.navigate).toHaveBeenCalledWith('/mfa-setup', {
      state: { isFirstLogin: true, username: 'novo', password: 'Temp@pass1234' },
    });
  });
});

// #1250: MFASetupPage returns here with the username and a notice.
describe('LoginPage state handed back by MFA enrolment (#1250)', () => {
  beforeEach(resetMocks);

  it('fills the username and shows the notice until an error replaces it', async () => {
    renderLogin({ username: 'ana', notice: 'mfaEnrolledPasswordChange' });
    expect((screen.getByTestId('login-username-input') as HTMLInputElement).value).toBe('ana');
    expect(screen.getByTestId('login-notice').textContent).toBe('auth.mfaEnrolledPasswordChange');

    login.mockRejectedValueOnce(new Error('Invalid credentials'));
    fill('login-password-input', 'Wrong@pass1234');
    await submit();
    expect(screen.queryByTestId('login-notice')).toBeNull();
    expect(screen.getByTestId('login-error').textContent).toBe('Invalid credentials');
  });

  it('shows no notice for any other state', () => {
    renderLogin({ notice: 'somethingElse' });
    expect(screen.queryByTestId('login-notice')).toBeNull();
    expect((screen.getByTestId('login-username-input') as HTMLInputElement).value).toBe('');
  });
});

describe('LoginPage submit errors', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('refuses a new password that does not match its confirmation, without calling login', async () => {
    renderLogin();
    login.mockResolvedValueOnce({ requiresPasswordChange: true });
    await signIn();
    fill('login-new-password-input', 'New@pass12345');
    fill('login-confirm-new-password-input', 'New@pass12346');
    await submit();
    expect(screen.getByTestId('login-error').textContent).toBe('auth.passwordsDoNotMatch');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('opens the MFA step with the attempts left when login rejects for a code', async () => {
    renderLogin();
    login.mockRejectedValueOnce(Object.assign(new Error('Código inválido'), { requiresTwoFactor: true, attemptsRemaining: 2 }));
    await signIn();
    expect(screen.getByTestId('two-factor-section').textContent).toContain('auth.attemptsRemaining: 2');
    expect(screen.getByTestId('login-error').textContent).toBe('Código inválido');
    expect(screen.getByTestId('login-submit-button').textContent).toBe('mfa.verify');
    expect(screen.getByTestId('login-password-input')).toBeDisabled();
  });

  it('falls back to the MFA-required text and hides a zero attempts count', async () => {
    renderLogin();
    login.mockRejectedValueOnce({ requiresTwoFactor: true, attemptsRemaining: 0 });
    await signIn();
    expect(screen.getByTestId('login-error').textContent).toBe('auth.mfaRequired');
    expect(screen.getByTestId('two-factor-section').textContent).not.toContain('auth.attemptsRemaining');
  });

  it('leaves the MFA step and clears the code when MFA is locked', async () => {
    renderLogin();
    login.mockResolvedValueOnce({ requiresTwoFactor: true });
    await signIn();
    fill('login-mfa-code-input', '12a3456');
    expect((screen.getByTestId('login-mfa-code-input') as HTMLInputElement).value).toBe('123456');
    login.mockRejectedValueOnce({ response: { data: { code: 'MFA_LOCKED' } } });
    await submit();
    expect(screen.getByTestId('login-error').textContent).toBe('auth.mfaLockedContactAdmin');
    expect(screen.queryByTestId('two-factor-section')).toBeNull();
    expect(screen.getByTestId('login-password-input')).not.toBeDisabled();
  });

  it.each([
    ['the response error', { response: { data: { error: 'Conta bloqueada', message: 'ignored' } } }, 'Conta bloqueada'],
    ['the response message', { response: { data: { message: 'Serviço indisponível' } } }, 'Serviço indisponível'],
    ['the error message', new Error('Network Error'), 'Network Error'],
    ['the generic text', {}, 'auth.loginError'],
  ])('shows %s on any other failure', async (_label, err, shown) => {
    renderLogin();
    login.mockRejectedValueOnce(err);
    await signIn();
    expect(screen.getByTestId('login-error').textContent).toBe(shown);
  });

  it('drops the forced password change back to the first step on another failure', async () => {
    renderLogin();
    login.mockResolvedValueOnce({ requiresPasswordChange: true });
    await signIn();
    fill('login-new-password-input', 'New@pass12345');
    fill('login-confirm-new-password-input', 'New@pass12345');
    login.mockRejectedValueOnce(new Error('Senha fraca'));
    await submit();
    expect(screen.queryByTestId('force-password-change-section')).toBeNull();
    expect(screen.getByTestId('login-password-input')).not.toBeDisabled();
    expect(screen.getByTestId('login-submit-button').textContent).toBe('auth.login');
  });

  it('warns in development on an unexpected failure, not on bad credentials', async () => {
    renderLogin();
    login.mockRejectedValueOnce(new Error('Invalid credentials'));
    await signIn();
    login.mockRejectedValueOnce({ response: { data: { error: 'Credenciais inválidas' } } });
    await submit();
    expect(warn).not.toHaveBeenCalled();

    const boom = new Error('boom');
    login.mockRejectedValueOnce(boom);
    await submit();
    expect(warn).toHaveBeenCalledWith('Falha inesperada no login:', boom);
  });

  it('shows the loading label and disables submit while login is pending', async () => {
    renderLogin();
    let finish: (value: unknown) => void = () => {};
    login.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fill('login-username-input', 'tecnico');
    fill('login-password-input', 'Old@pass1234');
    fireEvent.click(screen.getByTestId('login-submit-button'));
    await waitFor(() => expect(screen.getByTestId('login-submit-button')).toBeDisabled());
    expect(screen.getByTestId('login-submit-button').textContent).toBe('common.loading');
    finish({ user: { roleName: 'Técnico', accessType: 2 } });
    await waitFor(() => expect(screen.getByTestId('login-submit-button')).not.toBeDisabled());
  });
});

describe('LoginPage forgot-password modal', () => {
  beforeEach(resetMocks);

  function openModal() {
    renderLogin();
    fireEvent.click(screen.getByTestId('login-forgot-password-button'));
    expect(screen.getByTestId('forgot-password-modal-content')).toBeTruthy();
  }

  async function send(email = 'ana@example.org') {
    fill('forgot-password-email-input', email);
    fireEvent.click(screen.getByTestId('forgot-password-send-button'));
    await waitFor(() => expect(h.requestPasswordReset).toHaveBeenCalledWith(email));
  }

  it('keeps send disabled until an email is typed', () => {
    openModal();
    expect(screen.getByTestId('forgot-password-send-button')).toBeDisabled();
    fill('forgot-password-email-input', 'ana@example.org');
    expect(screen.getByTestId('forgot-password-send-button')).not.toBeDisabled();
  });

  it('shows the generic success text when the server returns no link', async () => {
    openModal();
    h.requestPasswordReset.mockResolvedValueOnce({ data: {} });
    await send();
    expect(await screen.findByText('auth.resetLinkGenericSuccess')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the reset link the server returns, routed in-app', async () => {
    openModal();
    const link = `${window.location.origin}/reset-password?token=abc`;
    h.requestPasswordReset.mockResolvedValueOnce({ data: { resetLink: link } });
    await send();
    const anchor = await screen.findByRole('link');
    expect(anchor.textContent).toBe(link);
    expect(anchor.getAttribute('href')).toBe('/reset-password?token=abc');
  });

  it('builds the reset link from a returned token', async () => {
    openModal();
    h.requestPasswordReset.mockResolvedValueOnce({ data: { token: 'tok123' } });
    await send();
    const anchor = await screen.findByRole('link');
    expect(anchor.textContent).toBe(`${window.location.origin}/reset-password?token=tok123`);
  });

  it.each([
    ['the server error', { response: { data: { error: 'Recuperação desativada' } } }, 'Recuperação desativada'],
    ['the generic text', new Error('offline'), 'auth.passwordResetError'],
  ])('shows %s when the request fails, and stays on the form', async (_label, err, shown) => {
    openModal();
    h.requestPasswordReset.mockRejectedValueOnce(err);
    await send();
    expect(await screen.findByText(shown)).toBeTruthy();
    expect(screen.getByTestId('forgot-password-email-input')).toBeTruthy();
  });

  it('cancel closes the modal and clears the email', async () => {
    openModal();
    fill('forgot-password-email-input', 'ana@example.org');
    fireEvent.click(screen.getByTestId('forgot-password-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('forgot-password-modal-content')).toBeNull());
    fireEvent.click(screen.getByTestId('login-forgot-password-button'));
    expect((screen.getByTestId('forgot-password-email-input') as HTMLInputElement).value).toBe('');
  });

  it('close after success reopens on an empty form', async () => {
    openModal();
    h.requestPasswordReset.mockResolvedValueOnce({ data: { token: 'tok123' } });
    await send();
    fireEvent.click(await screen.findByTestId('forgot-password-close-button'));
    await waitFor(() => expect(screen.queryByTestId('forgot-password-modal-content')).toBeNull());
    fireEvent.click(screen.getByTestId('login-forgot-password-button'));
    expect((screen.getByTestId('forgot-password-email-input') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('Escape closes the modal and clears its error', async () => {
    openModal();
    h.requestPasswordReset.mockRejectedValueOnce(new Error('offline'));
    await send();
    await screen.findByText('auth.passwordResetError');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('forgot-password-modal-content')).toBeNull());
    fireEvent.click(screen.getByTestId('login-forgot-password-button'));
    expect(screen.queryByText('auth.passwordResetError')).toBeNull();
    expect((screen.getByTestId('forgot-password-email-input') as HTMLInputElement).value).toBe('');
  });
});
