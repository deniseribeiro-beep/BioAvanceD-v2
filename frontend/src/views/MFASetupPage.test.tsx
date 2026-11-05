import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The 2FA enrolment page (/mfa-setup and /security/mfa-setup) over a mocked
// authService: the normal (signed-in) flow, the first-login flow, and #1250's
// forced password change after a first-login enrolment.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { state: null as unknown },
  generateTwoFactorQR: vi.fn(),
  generateTwoFactorQRFirstLogin: vi.fn(),
  enableTwoFactor: vi.fn(),
  enableTwoFactorFirstLogin: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
  useLocation: () => h.location,
}));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  authService: {
    generateTwoFactorQR: h.generateTwoFactorQR,
    generateTwoFactorQRFirstLogin: h.generateTwoFactorQRFirstLogin,
    enableTwoFactor: h.enableTwoFactor,
    enableTwoFactorFirstLogin: h.enableTwoFactorFirstLogin,
  },
}));

import MFASetupPage from '@/views/MFASetupPage';

const QR = 'data:image/png;base64,QRDATA';
const FIRST = { isFirstLogin: true, username: 'ana', password: 'pw' };

function at(state: unknown) {
  h.location = { state };
}

async function renderAtVerify() {
  render(<MFASetupPage />);
  return screen.findByAltText('QR Code');
}

function typeCode(value: string) {
  fireEvent.change(screen.getByLabelText('Código de Verificação (6 dígitos)'), { target: { value } });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  at(null);
  h.generateTwoFactorQR.mockResolvedValue({ data: { qrCode: QR, secret: 'SECRET1' } });
  h.generateTwoFactorQRFirstLogin.mockResolvedValue({ data: { qrCode: QR, secret: 'SECRET1' } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'referrer', { value: '', configurable: true });
});

describe('MFASetupPage: QR generation', () => {
  it('generates the QR on load through the signed-in endpoint and shows the secret', async () => {
    const img = await renderAtVerify();
    expect(img).toHaveAttribute('src', QR);
    expect(h.generateTwoFactorQR).toHaveBeenCalledTimes(1);
    expect(h.generateTwoFactorQRFirstLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Configurar 2FA');
    expect(screen.getByText('Adicione segurança extra à sua conta')).toBeInTheDocument();
    expect(screen.getByText('SECRET1')).toBeInTheDocument();
  });

  it('reads the QR and the manual-entry key from the nested envelope', async () => {
    h.generateTwoFactorQR.mockResolvedValue({ data: { data: { qrCode: QR, manualEntryKey: 'MANUAL9' } } });
    await renderAtVerify();
    expect(screen.getByText('MANUAL9')).toBeInTheDocument();
  });

  it('shows no manual-entry block when the response carries no secret', async () => {
    h.generateTwoFactorQR.mockResolvedValue({ data: { qrCode: QR } });
    await renderAtVerify();
    expect(screen.queryByText('Ou digite manualmente:')).not.toBeInTheDocument();
  });

  it('shows a loading line while the QR request is pending', async () => {
    h.generateTwoFactorQR.mockReturnValue(new Promise(() => {}));
    render(<MFASetupPage />);
    expect(await screen.findByText('Gerando QR Code...')).toBeInTheDocument();
  });

  it('reports a response without a QR and retries from the button', async () => {
    h.generateTwoFactorQR.mockResolvedValueOnce({ data: {} });
    render(<MFASetupPage />);
    expect(await screen.findByText('Não foi possível gerar o QR code. Tente novamente.')).toBeInTheDocument();
    expect(screen.queryByAltText('QR Code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Gerar QR Code/ }));
    expect(await screen.findByAltText('QR Code')).toBeInTheDocument();
    expect(h.generateTwoFactorQR).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Não foi possível gerar o QR code. Tente novamente.')).not.toBeInTheDocument();
  });

  it.each([
    ['the response error', { response: { data: { error: 'rate limited' } } }, 'rate limited'],
    ['the response message', { response: { data: { message: 'no session' } } }, 'no session'],
    ['the error message', new Error('network down'), 'network down'],
    ['the fallback', {}, 'Erro ao gerar QR code. Tente novamente.'],
  ])('shows %s when the QR request fails', async (_label, err, shown) => {
    h.generateTwoFactorQR.mockRejectedValue(err);
    render(<MFASetupPage />);
    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar QR Code/ })).toBeInTheDocument();
  });
});

describe('MFASetupPage: verification, signed-in flow', () => {
  it('keeps only digits, at most six, and enables submit only at six', async () => {
    await renderAtVerify();
    const submit = screen.getByRole('button', { name: 'Verificar e Habilitar' });
    typeCode('12a3');
    expect(screen.getByLabelText('Código de Verificação (6 dígitos)')).toHaveValue('123');
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(h.enableTwoFactor).not.toHaveBeenCalled();

    typeCode('12-34 5678');
    expect(screen.getByLabelText('Código de Verificação (6 dígitos)')).toHaveValue('123456');
    expect(submit).toBeEnabled();
  });

  it('enables 2FA, lists the backup codes and returns to the dashboard', async () => {
    h.enableTwoFactor.mockResolvedValue({ data: { backupCodes: ['AAAA-1111', 'BBBB-2222'] } });
    await renderAtVerify();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));

    expect(await screen.findByText('2FA Configurado com Sucesso!')).toBeInTheDocument();
    expect(h.enableTwoFactor).toHaveBeenCalledWith('123456');
    expect(screen.getByText('Códigos de Backup')).toBeInTheDocument();
    expect(screen.getByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('BBBB-2222')).toBeInTheDocument();
    expect(screen.getByText(/Use o código do Google Authenticator no próximo login/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(h.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('completes without a backup-code block when none come back', async () => {
    h.enableTwoFactor.mockResolvedValue({ data: {} });
    await renderAtVerify();
    typeCode('654321');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText('2FA Configurado com Sucesso!')).toBeInTheDocument();
    expect(screen.queryByText('Códigos de Backup')).not.toBeInTheDocument();
  });

  it('shows a verifying label while the enable request is pending', async () => {
    h.enableTwoFactor.mockReturnValue(new Promise(() => {}));
    await renderAtVerify();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByRole('button', { name: 'Verificando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });

  it.each([
    ['the response error', { response: { data: { error: 'Código inválido' } } }, 'Código inválido'],
    ['the response message', { response: { data: { message: 'expired' } } }, 'expired'],
    ['the error message', new Error('timeout'), 'timeout'],
    ['the fallback', {}, 'Erro ao habilitar 2FA. Verifique o código.'],
  ])('shows %s when enabling fails and stays on the code step', async (_label, err, shown) => {
    h.enableTwoFactor.mockRejectedValue(err);
    await renderAtVerify();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar e Habilitar' })).toBeEnabled();
    expect(screen.queryByText('2FA Configurado com Sucesso!')).not.toBeInTheDocument();
  });

  it('cancels to the dashboard when not opened from the security page', async () => {
    await renderAtVerify();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(h.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('returns to /user/security when the route state says it came from there', async () => {
    at({ from: '/user/security' });
    h.enableTwoFactor.mockResolvedValue({ data: {} });
    await renderAtVerify();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(h.navigate).toHaveBeenLastCalledWith('/user/security');

    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(h.navigate).toHaveBeenLastCalledWith('/user/security', { replace: true });
  });

  it('treats a /user/security referrer as coming from the security page', async () => {
    Object.defineProperty(document, 'referrer', { value: 'http://localhost/user/security', configurable: true });
    await renderAtVerify();
    // The header's back arrow is the first button and runs the same cancel.
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(h.navigate).toHaveBeenCalledWith('/user/security');
  });
});

describe('MFASetupPage: first login', () => {
  it('uses the first-login endpoints, stores the token and continues to the dashboard', async () => {
    at(FIRST);
    localStorage.setItem('tempUsername', 'ana');
    localStorage.setItem('tempPassword', 'pw');
    h.enableTwoFactorFirstLogin.mockResolvedValue({ data: { data: { token: 'tok-1', user: { id: 1 } } } });
    await renderAtVerify();

    expect(h.generateTwoFactorQRFirstLogin).toHaveBeenCalledWith('ana', 'pw');
    expect(h.generateTwoFactorQR).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Configuração Obrigatória de 2FA');
    expect(screen.getByText('Obrigatório no primeiro acesso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText(/Redirecionando\.\.\./)).toBeInTheDocument();
    expect(h.enableTwoFactorFirstLogin).toHaveBeenCalledWith('123456', 'ana', 'pw');
    expect(localStorage.getItem('token')).toBe('tok-1');
    expect(localStorage.getItem('tempUsername')).toBeNull();
    expect(localStorage.getItem('tempPassword')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(h.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('reads the credentials from the temporary storage and the flat token envelope', async () => {
    at({ isFirstLogin: true });
    localStorage.setItem('tempUsername', 'bia');
    localStorage.setItem('tempPassword', 'pw2');
    h.enableTwoFactorFirstLogin.mockResolvedValue({ data: { token: 'tok-2', user: { id: 2 } } });
    await renderAtVerify();
    expect(h.generateTwoFactorQRFirstLogin).toHaveBeenCalledWith('bia', 'pw2');

    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText('2FA Configurado com Sucesso!')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('tok-2');
  });

  it('stores no token when the enable response carries none', async () => {
    at(FIRST);
    localStorage.setItem('tempUsername', 'ana');
    h.enableTwoFactorFirstLogin.mockResolvedValue({ data: { data: {} } });
    await renderAtVerify();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText('2FA Configurado com Sucesso!')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('tempUsername')).toBe('ana');
  });

  it('sends a forced password change back to the login form (#1250)', async () => {
    at(FIRST);
    localStorage.setItem('tempUsername', 'ana');
    localStorage.setItem('tempPassword', 'pw');
    h.enableTwoFactorFirstLogin.mockResolvedValue({ data: { data: { requiresPasswordChange: true } } });
    await renderAtVerify();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: { username: 'ana', notice: 'mfaEnrolledPasswordChange' },
      }),
    );
    expect(localStorage.getItem('tempUsername')).toBeNull();
    expect(localStorage.getItem('tempPassword')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(screen.queryByText('2FA Configurado com Sucesso!')).not.toBeInTheDocument();
  });

  it('shows the mandatory-setup notice when the first-login QR fails', async () => {
    at(FIRST);
    h.generateTwoFactorQRFirstLogin.mockResolvedValue({ data: {} });
    render(<MFASetupPage />);
    expect(await screen.findByText('Configuração Obrigatória')).toBeInTheDocument();
    expect(screen.getByText(/O 2FA é obrigatório no primeiro login/)).toBeInTheDocument();
  });

  it('falls back to the signed-in endpoints when first login has no credentials', async () => {
    at({ isFirstLogin: true });
    h.enableTwoFactor.mockResolvedValue({ data: { backupCodes: [] } });
    await renderAtVerify();
    expect(h.generateTwoFactorQR).toHaveBeenCalledTimes(1);
    expect(h.generateTwoFactorQRFirstLogin).not.toHaveBeenCalled();

    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar e Habilitar' }));
    expect(await screen.findByText('2FA Configurado com Sucesso!')).toBeInTheDocument();
    expect(h.enableTwoFactor).toHaveBeenCalledWith('123456');
    expect(screen.queryByText('Códigos de Backup')).not.toBeInTheDocument();
  });
});
