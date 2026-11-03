import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The user's own security page (/user/security) over the real useUserSecurity
// hook: the services are mocked, so the page reads what the hook makes of them.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  showToast: vi.fn(),
  logout: vi.fn(),
  getStatus: vi.fn(),
  getMFAStatus: vi.fn(),
  getPasswordStatus: vi.fn(),
  getSessions: vi.fn(),
  updatePassword: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  requestPasswordReset: vi.fn(),
  getPasswordPolicy: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
// The key itself, except the two slot keys the page fills in.
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string, fb?: string) => {
      if (k === 'userSecurity.status.passwordExpiresIn') return 'expires in {days}';
      if (k === 'userSecurity.mfa.alternatives.recovery.remaining') return '{count} left';
      return fb ?? k;
    },
    language: 'pt-BR',
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock('@/components/UI/ToastContainer', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  userSecurityService: {
    getStatus: h.getStatus,
    getMFAStatus: h.getMFAStatus,
    getPasswordStatus: h.getPasswordStatus,
    getSessions: h.getSessions,
    updatePassword: h.updatePassword,
    generateRecoveryCodes: h.generateRecoveryCodes,
    revokeSession: h.revokeSession,
    revokeAllSessions: h.revokeAllSessions,
    requestPasswordReset: h.requestPasswordReset,
  },
  authService: { getPasswordPolicy: h.getPasswordPolicy },
}));

import UserSecurityPage from '@/views/UserSecurityPage';

const DAY = 24 * 60 * 60 * 1000;
const env = (data: unknown) => ({ data: { data } });

type Account = {
  status?: unknown;
  mfa?: unknown;
  password?: unknown;
  sessions?: unknown[];
};

function serve(a: Account) {
  h.getStatus.mockResolvedValue(env(a.status ?? null));
  h.getMFAStatus.mockResolvedValue(env(a.mfa ?? null));
  h.getPasswordStatus.mockResolvedValue(env(a.password ?? null));
  h.getSessions.mockResolvedValue(env(a.sessions ?? []));
}

const strong: Account = {
  status: { securityScore: 90, overallLevel: 'strong', alternativeMethodsCount: 2 },
  mfa: { primaryEnabled: true, primarySetupDate: '2026-01-02T10:00:00Z', recoveryCodes: { remaining: 8 } },
  password: { lastChanged: '2026-01-05T10:00:00Z', expiresAt: new Date(Date.now() + 30 * DAY).toISOString(), strength: 'strong', strengthScore: 4 },
  sessions: [
    { id: 's1', deviceName: 'Laptop', browser: 'Firefox', os: 'Linux', location: 'Campinas', ipAddress: '10.0.0.1', lastAccess: '2026-01-06T10:00:00Z', isCurrent: true },
    { sessionID: 's2', deviceInfo: { type: 'mobile', browser: 'Chrome', os: 'Android' }, lastActivity: '2026-01-04T10:00:00Z', currentSession: false },
  ],
};

async function renderPage(a: Account) {
  serve(a);
  const view = render(<UserSecurityPage />);
  await screen.findByTestId('security-page-title');
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getPasswordPolicy.mockRejectedValue(new Error('offline'));
  // Modal restores the scroll position on close; jsdom has no scrollTo.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => cleanup());

describe('UserSecurityPage status', () => {
  it('shows the loading skeleton until the first load resolves', () => {
    h.getStatus.mockReturnValue(new Promise(() => {}));
    h.getMFAStatus.mockReturnValue(new Promise(() => {}));
    h.getPasswordStatus.mockReturnValue(new Promise(() => {}));
    h.getSessions.mockReturnValue(new Promise(() => {}));
    const { container } = render(<UserSecurityPage />);
    expect(container.querySelector('.loading-skeleton')).not.toBeNull();
    expect(screen.queryByTestId('security-page-title')).toBeNull();
  });

  it('reads a strong account: score, MFA, recovery codes and password', async () => {
    const { container } = await renderPage(strong);
    const badge = container.querySelector('.status-badge') as HTMLElement;
    expect(badge.className).toContain('status-strong');
    expect(badge.textContent).toBe('userSecurity.securityLevel.strong');
    const fill = container.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('90%');
    expect(fill.style.backgroundColor).toBe('var(--success)');
    expect(container.querySelector('.progress-text')?.textContent).toBe('90%');
    expect(screen.getByText('userSecurity.status.active')).toBeInTheDocument();
    expect(screen.getByText(/^2 userSecurity\.status\.configured$/)).toBeInTheDocument();
    expect(screen.getByText(/^userSecurity\.mfa\.primary\.setupDate: /)).toBeInTheDocument();
    expect(screen.getByText('8 left')).toBeInTheDocument();
    expect(screen.getByText('userSecurity.status.secure')).toBeInTheDocument();
    expect(container.querySelector('.status-warning')).toBeNull();
    expect(container.querySelector('.password-warning')).toBeNull();
    expect(container.querySelector('.strength-bar')?.className).toContain('strength-strong');
    expect((container.querySelector('.strength-bar') as HTMLElement).style.width).toBe('80%');
    expect(screen.queryByTestId('download-recovery-codes-button')).toBeNull();
  });

  it('sends both MFA buttons of an enrolled account to the setup page', async () => {
    await renderPage(strong);
    fireEvent.click(screen.getByText('userSecurity.mfa.primary.reconfigure'));
    fireEvent.click(screen.getByText('userSecurity.mfa.primary.viewSettings'));
    expect(h.navigate).toHaveBeenCalledTimes(2);
    expect(h.navigate).toHaveBeenCalledWith('/security/mfa-setup', { state: { from: '/user/security' } });
  });

  it('reads a medium account with a password about to expire and few codes left', async () => {
    const { container } = await renderPage({
      status: { securityScore: 60, overallLevel: 'medium', alternativeMethodsCount: 0 },
      mfa: { primaryEnabled: false, recoveryCodes: { remaining: 2 } },
      password: { expiresAt: new Date(Date.now() + 5 * DAY + 60_000).toISOString() },
    });
    expect(container.querySelector('.status-badge')?.textContent).toBe('userSecurity.securityLevel.medium');
    expect((container.querySelector('.progress-fill') as HTMLElement).style.backgroundColor).toBe('var(--warning)');
    expect(screen.getByText('expires in 6')).toBeInTheDocument();
    expect(container.querySelector('.password-warning')).not.toBeNull();
    expect(container.querySelector('.info-value.warning')?.textContent).toBe('6 userSecurity.password.days');
    expect(screen.getAllByText('userSecurity.status.never')).toHaveLength(2);
    expect(screen.getByText('userSecurity.status.needsRenewal')).toBeInTheDocument();
    expect(screen.getByText('userSecurity.status.inactive')).toBeInTheDocument();
    expect(screen.getByText('userSecurity.password.strengthWeak')).toBeInTheDocument();
  });

  it('reads an account the server sent nothing for as weak, with no codes and no sessions', async () => {
    const { container } = await renderPage({});
    expect(container.querySelector('.status-badge')?.className).toContain('status-weak');
    expect(container.querySelector('.status-badge')?.textContent).toBe('userSecurity.securityLevel.weak');
    expect((container.querySelector('.progress-fill') as HTMLElement).style.backgroundColor).toBe('var(--danger)');
    expect(container.querySelector('.progress-text')?.textContent).toBe('0%');
    expect(screen.getByText('userSecurity.status.none')).toBeInTheDocument();
    expect(screen.queryByText(/ left$/)).toBeNull();
    expect(screen.getByText('userSecurity.sessions.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-all-sessions-button')).toBeNull();
    fireEvent.click(screen.getByText('userSecurity.mfa.primary.activateNow'));
    expect(h.navigate).toHaveBeenCalledWith('/security/mfa-setup', { state: { from: '/user/security' } });
  });
});

describe('UserSecurityPage change password', () => {
  const open = () => fireEvent.click(screen.getByTestId('change-password-button'));
  const fill = (current: string, next: string, confirm: string) => {
    fireEvent.change(screen.getByTestId('current-password-input'), { target: { value: current } });
    fireEvent.change(screen.getByTestId('new-password-input'), { target: { value: next } });
    fireEvent.change(screen.getByTestId('confirm-password-input'), { target: { value: confirm } });
  };
  const submit = () => fireEvent.click(screen.getByTestId('change-password-submit-button'));

  it('asks for all three fields', async () => {
    await renderPage({});
    open();
    submit();
    expect(screen.getByText('userSecurity.password.allFieldsRequired')).toBeInTheDocument();
    expect(h.updatePassword).not.toHaveBeenCalled();
  });

  it('holds a password under the default 15-character floor for an account without MFA', async () => {
    await renderPage({});
    open();
    expect(screen.getByText('Mínimo de 15 caracteres')).toBeInTheDocument();
    fill('old-secret', 'short-pass', 'short-pass');
    submit();
    expect(screen.getByText('A senha deve ter no mínimo 15 caracteres')).toBeInTheDocument();
    expect(h.updatePassword).not.toHaveBeenCalled();
  });

  it('flags a confirmation that differs, inline and on submit', async () => {
    await renderPage({});
    open();
    fill('old-secret', 'a-long-enough-password', 'a-long-enough-passwordX');
    expect(screen.getByText('password.mismatch')).toBeInTheDocument();
    submit();
    expect(screen.getByText('userSecurity.password.mismatch')).toBeInTheDocument();
    expect(h.updatePassword).not.toHaveBeenCalled();
  });

  it('takes the 8-character MFA floor for an enrolled account, saves and reloads', async () => {
    await renderPage(strong);
    open();
    expect(screen.getByText('Mínimo de 8 caracteres')).toBeInTheDocument();
    h.updatePassword.mockResolvedValue({ data: { success: true } });
    fill('old-secret', 'ten-chars!', 'ten-chars!');
    const loadsBefore = h.getStatus.mock.calls.length;
    submit();
    await waitFor(() => expect(screen.queryByTestId('current-password-input')).toBeNull());
    expect(h.updatePassword).toHaveBeenCalledWith('old-secret', 'ten-chars!');
    await waitFor(() => expect(h.getStatus.mock.calls.length).toBeGreaterThanOrEqual(loadsBefore + 2));
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    await renderPage({});
    open();
    h.updatePassword.mockRejectedValue({ response: { data: { error: 'Senha atual incorreta' } } });
    fill('wrong', 'a-long-enough-password', 'a-long-enough-password');
    submit();
    expect(await screen.findByText('Senha atual incorreta')).toBeInTheDocument();
    expect(screen.getByTestId('current-password-input')).toBeInTheDocument();
  });

  it('toggles each field between hidden and shown', async () => {
    await renderPage({});
    open();
    const fields = ['current-password-input', 'new-password-input', 'confirm-password-input'];
    fields.forEach((id) => expect(screen.getByTestId(id)).toHaveAttribute('type', 'password'));
    fireEvent.click(screen.getByTestId('current-password-visibility-toggle'));
    fireEvent.click(screen.getByTestId('new-password-visibility-toggle'));
    const confirmToggle = screen.getByTestId('confirm-password-input').parentElement!.querySelector('button')!;
    fireEvent.click(confirmToggle);
    fields.forEach((id) => expect(screen.getByTestId(id)).toHaveAttribute('type', 'text'));
    fireEvent.click(screen.getByTestId('current-password-visibility-toggle'));
    expect(screen.getByTestId('current-password-input')).toHaveAttribute('type', 'password');
  });

  it('clears the fields and the error on cancel and on closing the dialog', async () => {
    const { container } = await renderPage({});
    open();
    fill('x', '', '');
    submit();
    expect(screen.getByText('userSecurity.password.allFieldsRequired')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('change-password-cancel-button'));
    expect(screen.queryByTestId('current-password-input')).toBeNull();
    open();
    expect(screen.getByTestId('current-password-input')).toHaveValue('');
    expect(screen.queryByText('userSecurity.password.allFieldsRequired')).toBeNull();
    fill('typed', '', '');
    fireEvent.click(container.ownerDocument.querySelector('.modal-close')!);
    expect(screen.queryByTestId('current-password-input')).toBeNull();
    open();
    expect(screen.getByTestId('current-password-input')).toHaveValue('');
  });
});

describe('UserSecurityPage recovery codes', () => {
  it('shows freshly generated codes, downloads them, and closes', async () => {
    await renderPage(strong);
    h.generateRecoveryCodes.mockResolvedValue(env({ codes: ['AAAA-1111', 'BBBB-2222'] }));
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('BBBB-2222')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();

    const createObjectURL = vi.fn(() => 'blob:codes');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('download-recovery-codes-button'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toBe('AAAA-1111\nBBBB-2222');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes');
    click.mockRestore();

    fireEvent.click(screen.getByTestId('close-recovery-codes-button'));
    expect(screen.queryByText('AAAA-1111')).toBeNull();
  });

  it('reloads the status when the codes dialog is dismissed', async () => {
    const { container } = await renderPage(strong);
    h.generateRecoveryCodes.mockResolvedValue({ data: { codes: ['CCCC-3333'] } });
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    await screen.findByText('CCCC-3333');
    const loadsBefore = h.getStatus.mock.calls.length;
    fireEvent.click(container.ownerDocument.querySelector('.modal-close')!);
    await waitFor(() => expect(h.getStatus.mock.calls.length).toBe(loadsBefore + 1));
    expect(await screen.findByText('8 left')).toBeInTheDocument();
  });

  it('clears the codes and reloads when Close is pressed (#1434)', async () => {
    await renderPage(strong);
    h.generateRecoveryCodes.mockResolvedValue(env({ codes: ['EEEE-5555'] }));
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    await screen.findByText('EEEE-5555');
    expect(screen.getByTestId('download-recovery-codes-button')).toBeInTheDocument();
    const loadsBefore = h.getMFAStatus.mock.calls.length;
    fireEvent.click(screen.getByTestId('close-recovery-codes-button'));
    await waitFor(() => expect(h.getMFAStatus.mock.calls.length).toBe(loadsBefore + 1));
    await waitFor(() => expect(screen.queryByTestId('download-recovery-codes-button')).toBeNull());
    expect(screen.getByText('8 left')).toBeInTheDocument();
  });

  it('shows the no-codes line when the account had no MFA record to hold them', async () => {
    serve({});
    // A non-object response is the one the hook reads as no MFA record at all.
    h.getMFAStatus.mockResolvedValue(null);
    render(<UserSecurityPage />);
    await screen.findByTestId('security-page-title');
    h.generateRecoveryCodes.mockResolvedValue(env({ codes: ['DDDD-4444'] }));
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    expect(await screen.findByText('userSecurity.mfa.alternatives.recovery.noCodes')).toBeInTheDocument();
    expect(screen.queryByText('DDDD-4444')).toBeNull();
  });

  it('toasts an error when the server returns no codes', async () => {
    await renderPage(strong);
    h.generateRecoveryCodes.mockResolvedValue(env({ codes: [] }));
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Nenhum código foi gerado', 'error'));
    expect(screen.queryByTestId('close-recovery-codes-button')).toBeNull();
  });

  it("toasts the server's message when generation fails", async () => {
    await renderPage(strong);
    h.generateRecoveryCodes.mockRejectedValue({ response: { data: { message: 'MFA não configurado' } } });
    fireEvent.click(screen.getByTestId('generate-recovery-codes-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('MFA não configurado', 'error'));
  });
});

describe('UserSecurityPage password reset request', () => {
  it('is hidden while the policy turns the reset flow off', async () => {
    h.getPasswordPolicy.mockResolvedValue({ data: { data: { allowPasswordReset: false } } });
    await renderPage({});
    await waitFor(() => expect(screen.queryByTestId('request-password-reset-button')).toBeNull());
  });

  it('asks first, then sends the request and toasts success', async () => {
    await renderPage({});
    h.requestPasswordReset.mockResolvedValue({ data: { success: true } });
    fireEvent.click(screen.getByTestId('request-password-reset-button'));
    expect(screen.getByText('userSecurity.password.resetRequestConfirm')).toBeInTheDocument();
    expect(h.requestPasswordReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('userSecurity.password.resetRequestSuccess', 'success'));
    expect(h.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('security-confirm-proceed-button')).toBeNull();
  });

  it('toasts the failure message', async () => {
    await renderPage({});
    h.requestPasswordReset.mockRejectedValue(new Error('limite de pedidos'));
    fireEvent.click(screen.getByTestId('request-password-reset-button'));
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('limite de pedidos', 'error'));
  });

  it('sends nothing when the confirmation is cancelled or dismissed', async () => {
    const { container } = await renderPage({});
    fireEvent.click(screen.getByTestId('request-password-reset-button'));
    fireEvent.click(screen.getByTestId('security-confirm-cancel-button'));
    expect(screen.queryByTestId('security-confirm-proceed-button')).toBeNull();
    fireEvent.click(screen.getByTestId('request-password-reset-button'));
    fireEvent.click(container.ownerDocument.querySelector('.modal-close')!);
    expect(screen.queryByTestId('security-confirm-proceed-button')).toBeNull();
    expect(h.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('UserSecurityPage sessions', () => {
  it('lists each session, mapping the alternative field names', async () => {
    await renderPage(strong);
    const items = screen.getAllByTestId('session-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('data-session-id', 's1');
    expect(items[0]).toHaveAttribute('data-session-current', 'true');
    expect(within(items[0]).getByTestId('session-current-badge')).toBeInTheDocument();
    expect(screen.getByTestId('session-device-name-0')).toHaveTextContent('Laptop');
    expect(screen.getByTestId('session-device-details-0')).toHaveTextContent('Firefox • Linux • Campinas');
    expect(screen.getByTestId('session-ip-0')).toHaveTextContent('10.0.0.1');
    expect(items[1]).toHaveAttribute('data-session-id', 's2');
    expect(items[1]).toHaveAttribute('data-session-current', 'false');
    expect(screen.getByTestId('session-device-name-1')).toHaveTextContent('mobile');
    expect(screen.getByTestId('session-device-details-1')).toHaveTextContent('Chrome • Android • userSecurity.sessions.unknownLocation');
    expect(screen.queryByTestId('revoke-session-button-0')).toBeNull();
    expect(screen.queryByTestId('logout-current-session-button-1')).toBeNull();
  });

  it('names an unknown device', async () => {
    await renderPage({ sessions: [{ id: 's9', lastAccess: '2026-01-04T10:00:00Z', isCurrent: false }] });
    expect(screen.getByTestId('session-device-name-0')).toHaveTextContent('userSecurity.sessions.unknownDevice');
    expect(screen.queryByTestId('revoke-all-sessions-button')).toBeNull();
  });

  it('revokes another session after the confirmation', async () => {
    await renderPage(strong);
    h.revokeSession.mockResolvedValue({ data: { success: true } });
    serve({ ...strong, sessions: [strong.sessions![0]] });
    fireEvent.click(screen.getByTestId('revoke-session-button-1'));
    expect(screen.getByText('userSecurity.sessions.revokeConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(1));
    expect(h.revokeSession).toHaveBeenCalledWith('s2');
  });

  it('revokes every other session after the confirmation', async () => {
    await renderPage(strong);
    h.revokeAllSessions.mockResolvedValue({ data: { success: true } });
    serve({ ...strong, sessions: [strong.sessions![0]] });
    fireEvent.click(screen.getByTestId('revoke-all-sessions-button'));
    expect(screen.getByText('userSecurity.sessions.revokeAllConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(1));
    expect(h.revokeAllSessions).toHaveBeenCalledTimes(1);
  });

  it("toasts the server's error when revoking a session fails (#1434)", async () => {
    await renderPage(strong);
    h.revokeSession.mockRejectedValue({ response: { data: { error: 'Sessão não encontrada' } } });
    fireEvent.click(screen.getByTestId('revoke-session-button-1'));
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Sessão não encontrada', 'error'));
    expect(h.revokeSession).toHaveBeenCalledWith('s2');
  });

  it('toasts an error when revoking every other session fails (#1434)', async () => {
    await renderPage(strong);
    h.revokeAllSessions.mockRejectedValue('offline');
    fireEvent.click(screen.getByTestId('revoke-all-sessions-button'));
    fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Erro ao revogar todas as sessões', 'error'));
  });

  it('logs the current session out after the confirmation', async () => {
    await renderPage(strong);
    h.logout.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId('logout-current-session-button-0'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('security-confirm-proceed-button'));
    });
    expect(h.logout).toHaveBeenCalledTimes(1);
    expect(h.revokeSession).not.toHaveBeenCalled();
  });
});
