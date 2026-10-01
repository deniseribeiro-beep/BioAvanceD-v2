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
