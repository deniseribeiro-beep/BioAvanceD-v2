import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1252: the code accepted before a required password change rides along
// with the change submit, so an MFA-enrolled user types one code, not two.
const login = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login, isAuthenticated: false, user: null }),
}));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../components/LanguageSelector', () => ({ default: () => null }));
const getPasswordPolicy = vi.fn();
vi.mock('../services/api', () => ({ authService: { getPasswordPolicy: () => getPasswordPolicy() } }));

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
