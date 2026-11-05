import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The password-reset page (/reset-password?token=...) over a mocked
// authService: the missing-token screen, the form's checks against the
// server's password policy (#1246), the reset call, its error precedence and
// the redirect to /login three seconds after a success.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  getPasswordPolicy: vi.fn(),
  resetPassword: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/services/api', () => ({
  authService: {
    getPasswordPolicy: h.getPasswordPolicy,
    resetPassword: h.resetPassword,
  },
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: h.t }),
}));

import ResetPasswordPage from '@/views/ResetPasswordPage';

// minLength 10 with upper case and numbers on, lower case and symbols off.
const POLICY = {
  data: {
    data: {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: false,
      requireNumbers: true,
      requireSpecialChars: false,
    },
  },
};
const STRONG = 'Abcdefghi1';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>
  );
}

// Waits for the policy's own rules to replace the default checklist.
async function renderForm() {
  const view = renderAt('/reset-password?token=tok-123');
  await screen.findByText('password.requirements.upper');
  return view;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
}

function errorBox(container: HTMLElement) {
  return container.querySelector('.error-message');
}

function marks() {
  return screen.getAllByRole('listitem').map((li) => li.textContent);
}

beforeEach(() => {
  h.navigate.mockReset();
  h.getPasswordPolicy.mockReset().mockResolvedValue(POLICY);
  h.resetPassword.mockReset();
  h.t.mockReset().mockImplementation((key: string) => key);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ResetPasswordPage without a token', () => {
  it('shows the invalid-link screen and no form', () => {
    const { container } = renderAt('/reset-password');
    expect(screen.getByRole('heading', { name: 'Token Inválido' })).toBeInTheDocument();
    expect(screen.getByText('O link de recuperação de senha é inválido ou expirou.')).toBeInTheDocument();
    expect(container.querySelector('form')).toBeNull();
  });

  it('goes back to /login from the invalid-link screen', () => {
    renderAt('/reset-password?token=');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Login' }));
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });
});

describe('ResetPasswordPage form', () => {
  it('renders the checklist and minimum length from the server policy', async () => {
    await renderForm();
    expect(screen.getByRole('heading', { name: 'Redefinir Senha' })).toBeInTheDocument();
    expect(marks()).toEqual([
      '•password.requirements.minLengthN',
      '•password.requirements.upper',
      '•password.requirements.number',
    ]);
    expect(screen.queryByText('password.requirements.lower')).toBeNull();
    expect(screen.getByLabelText('Nova Senha')).toHaveAttribute('minlength', '10');
    expect(screen.getByLabelText('Confirmar Nova Senha')).toHaveAttribute('minlength', '10');
  });

  it('ticks each rule the typed password meets', async () => {
    await renderForm();
    fill('Nova Senha', 'abcdefghij');
    expect(marks()).toEqual([
      '✓password.requirements.minLengthN',
      '•password.requirements.upper',
      '•password.requirements.number',
    ]);
    fill('Nova Senha', STRONG);
    expect(marks()).toEqual([
      '✓password.requirements.minLengthN',
      '✓password.requirements.upper',
      '✓password.requirements.number',
    ]);
  });

  it('flags a confirmation that differs only once both fields hold text', async () => {
    await renderForm();
    fill('Nova Senha', STRONG);
    expect(screen.queryByText('password.mismatch')).toBeNull();
    fill('Confirmar Nova Senha', 'Abcdefghi2');
    expect(screen.getByText('password.mismatch')).toBeInTheDocument();
    fill('Confirmar Nova Senha', STRONG);
    expect(screen.queryByText('password.mismatch')).toBeNull();
  });

  it('refuses a submit with an empty field', async () => {
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    submit(container);
    expect(errorBox(container)).toHaveTextContent('password.error.requiredFields');
    expect(h.resetPassword).not.toHaveBeenCalled();
  });

  it('refuses a password the policy rejects, naming each unmet rule', async () => {
    const { container } = await renderForm();
    fill('Nova Senha', 'abcdefghij');
    fill('Confirmar Nova Senha', 'abcdefghij');
    submit(container);
    expect(errorBox(container)).toHaveTextContent(
      'A senha deve conter pelo menos uma letra maiúscula. A senha deve conter pelo menos um número'
    );
    expect(h.resetPassword).not.toHaveBeenCalled();
  });

  it('refuses a confirmation that does not match', async () => {
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', 'Abcdefghi2');
    submit(container);
    expect(errorBox(container)).toHaveTextContent('password.mismatch');
    expect(h.resetPassword).not.toHaveBeenCalled();
  });

  it('goes back to /login from the form', async () => {
    await renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Login' }));
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });
});

describe('ResetPasswordPage reset call', () => {
  it('sends the token and new password, shows success and redirects after three seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.resetPassword.mockResolvedValue({ data: { success: true } });
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', STRONG);
    submit(container);

    expect(await screen.findByRole('heading', { name: 'Senha Redefinida com Sucesso!' })).toBeInTheDocument();
    expect(h.resetPassword).toHaveBeenCalledWith('tok-123', STRONG);
    expect(container.querySelector('form')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(h.navigate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });

  it('disables the button while the reset is pending', async () => {
    let finish: (value: unknown) => void = () => {};
    h.resetPassword.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', STRONG);
    submit(container);

    const pending = screen.getByRole('button', { name: 'Redefinindo...' });
    expect(pending).toBeDisabled();
    await act(async () => {
      finish({ data: {} });
    });
    expect(screen.getByRole('heading', { name: 'Senha Redefinida com Sucesso!' })).toBeInTheDocument();
  });

  it.each([
    ['the response error', { response: { data: { error: 'Token expirado', message: 'other' } } }, 'Token expirado'],
    ['the response message', { response: { data: { message: 'Token já utilizado' } } }, 'Token já utilizado'],
    ['the translated fallback', new Error('Network Error'), 'auth.passwordResetError'],
  ])('shows %s when the reset fails and re-enables the button', async (_name, failure, shown) => {
    h.resetPassword.mockRejectedValue(failure);
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', STRONG);
    submit(container);

    await waitFor(() => expect(errorBox(container)).toHaveTextContent(shown));
    expect(screen.getByRole('button', { name: 'Redefinir Senha' })).not.toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Senha Redefinida com Sucesso!' })).toBeNull();
  });

  it('clears an earlier error when the form is submitted again', async () => {
    let finish: (value: unknown) => void = () => {};
    h.resetPassword
      .mockRejectedValueOnce(new Error('x'))
      .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { container } = await renderForm();
    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', STRONG);
    submit(container);
    await waitFor(() => expect(errorBox(container)).toHaveTextContent('auth.passwordResetError'));

    // The second reset stays pending, so the form is still on screen.
    submit(container);
    expect(screen.getByRole('button', { name: 'Redefinindo...' })).toBeDisabled();
    expect(errorBox(container)).toBeNull();
    await act(async () => {
      finish({ data: {} });
    });
    expect(screen.getByRole('heading', { name: 'Senha Redefinida com Sucesso!' })).toBeInTheDocument();
  });
});

describe('ResetPasswordPage without translations', () => {
  beforeEach(() => {
    h.t.mockImplementation(() => '');
  });

  it('falls back to its Portuguese texts for the placeholder and each error', async () => {
    h.resetPassword.mockRejectedValue({});
    const { container } = renderAt('/reset-password?token=tok-123');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(screen.getByLabelText('Nova Senha')).toHaveAttribute(
      'placeholder',
      'Mínimo 8 caracteres com maiúscula, minúscula, número e símbolo'
    );

    submit(container);
    expect(errorBox(container)).toHaveTextContent('Preencha todos os campos');

    fill('Nova Senha', STRONG);
    fill('Confirmar Nova Senha', 'Abcdefghi2');
    submit(container);
    expect(errorBox(container)).toHaveTextContent('As senhas não coincidem');

    fill('Confirmar Nova Senha', STRONG);
    submit(container);
    await waitFor(() => expect(errorBox(container)).toHaveTextContent('Erro ao redefinir senha'));
  });
});
