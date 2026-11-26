import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { authService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  authService: {
    verifyToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

// clearClientSession navigates with window.location.replace, which jsdom does
// not implement; onClientLogout stays real so the auth:logout tests still run.
vi.mock('../utils/sessionCleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/sessionCleanup')>()),
  clearClientSession: vi.fn(),
}));

function buildToken(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.sig`;
}

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

function httpError(status: number, data: Record<string, unknown> = {}, message = `status ${status}`) {
  return Object.assign(new Error(message), { response: { status, data } });
}

describe('AuthProvider — auth:logout event', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authService.verifyToken).mockResolvedValue({
      data: { data: { user: { id: 1, roleName: 'Administrador', accessType: 4 }, valid: true } },
    } as any);
  });

  it('#614: clears user/token when api.ts dispatches auth:logout, not just other hooks', async () => {
    localStorage.setItem('token', buildToken({ id: 1, roleName: 'Administrador', accessType: 4 }));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });
});

describe('AuthProvider — token verification on mount', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(authService.verifyToken).mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('with no stored token, finishes loading signed out without calling the API', async () => {
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('keeps the user decoded from the token when verification fails', async () => {
    const token = buildToken({ id: 7, name: 'Ana', email: 'ana@lab', username: 'ana', userID: 'u7', accessType: 3 });
    localStorage.setItem('token', token);
    vi.mocked(authService.verifyToken).mockRejectedValue(new Error('offline'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual({
      id: 7, name: 'Ana', email: 'ana@lab', username: 'ana', userID: 'u7', accessType: 3, roleName: 'Coordenador',
    });
    expect(result.current.token).toBe(token);
    expect(result.current.isAuthenticated).toBe(true);
    expect(console.warn).toHaveBeenCalledWith('Erro não-401 ao verificar token, mantendo token:', 'offline');
  });

  it('fills defaults for a token payload with no user fields', async () => {
    localStorage.setItem('token', buildToken({ sub: 'subject-1', role: 9 }));
    vi.mocked(authService.verifyToken).mockRejectedValue(new Error('offline'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual({
      id: 0, name: 'Usuário', email: 'no-email@local', username: 'user', userID: 'subject-1', accessType: 9, roleName: 'Técnico',
    });
  });

  it('maps a non-numeric accessType in the token to Técnico', async () => {
    localStorage.setItem('token', buildToken({ id: 1, accessType: 'x' }));
    vi.mocked(authService.verifyToken).mockRejectedValue(new Error('offline'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.accessType).toBeNaN();
    expect(result.current.user?.roleName).toBe('Técnico');
  });

  it('logs nothing for a verification that settles after unmount', async () => {
    localStorage.setItem('token', buildToken({ id: 1 }));
    for (const settle of ['resolve', 'reject'] as const) {
      let finish!: (v: unknown) => void;
      vi.mocked(authService.verifyToken).mockReturnValue(new Promise((resolve, reject) => {
        finish = settle === 'resolve' ? resolve : reject;
      }) as any);
      const { unmount } = renderAuth();
      unmount();
      await act(async () => { finish(settle === 'resolve' ? {} : new Error('late')); });
      expect(console.warn).not.toHaveBeenCalled();
    }
  });

  it('decodes no user from a token without a payload part or with a bad one', async () => {
    for (const token of ['not-a-jwt', 'header.%%%.sig']) {
      localStorage.setItem('token', token);
      vi.mocked(authService.verifyToken).mockRejectedValue(new Error('offline'));
      const { result, unmount } = renderAuth();
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.user).toBeNull();
      expect(result.current.token).toBe(token);
      expect(result.current.isAuthenticated).toBe(false);
      unmount();
    }
  });

  it('takes the verified user from data.user and maps its role from accessType', async () => {
    localStorage.setItem('token', buildToken({ id: 1 }));
    vi.mocked(authService.verifyToken).mockResolvedValue({ data: { user: { id: 2, name: 'Bia', accessType: 1 } } } as any);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user?.name).toBe('Bia'));
    expect(result.current.user?.roleName).toBe('Usuário Externo');
  });

  it('keeps the session when the verify response carries no user', async () => {
    localStorage.setItem('token', buildToken({ id: 3, name: 'Caio', accessType: 2 }));
    vi.mocked(authService.verifyToken).mockResolvedValue({} as any);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.name).toBe('Caio');
    expect(console.warn).toHaveBeenCalledWith('Resposta de verificação de token inválida, mas mantendo sessão:', undefined);
  });

  it('skips verification right after a login', async () => {
    localStorage.setItem('token', buildToken({ id: 4 }));
    sessionStorage.setItem('lastLoginTime', String(Date.now()));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(authService.verifyToken).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Login muito recente, aguardando antes de verificar token');
  });

  it('logs a 401 within five seconds of login as recent, and a later one as a possible expiry', async () => {
    localStorage.setItem('token', buildToken({ id: 5 }));
    sessionStorage.setItem('lastLoginTime', String(Date.now() - 3000));
    vi.mocked(authService.verifyToken).mockRejectedValue(httpError(401));
    const first = renderAuth();
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(console.log).toHaveBeenCalledWith('Login recente detectado, mantendo token mesmo com erro 401');
    first.unmount();

    sessionStorage.setItem('lastLoginTime', String(Date.now() - 60000));
    const second = renderAuth();
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(console.warn).toHaveBeenCalledWith('Token pode estar expirado, mas mantendo sessão ativa');
    expect(second.result.current.token).not.toBeNull();
  });

  it('retries a rate-limited verification after fifteen seconds, and cancels the retry on unmount', async () => {
    vi.useFakeTimers();
    localStorage.setItem('token', buildToken({ id: 6 }));
    vi.mocked(authService.verifyToken).mockRejectedValue(httpError(429));

    const { unmount } = renderAuth();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(authService.verifyToken).toHaveBeenCalledTimes(2);

    unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(authService.verifyToken).toHaveBeenCalledTimes(2);
  });

  it('re-verifies when another tab stores a token, once the five-second window has passed', async () => {
    vi.useFakeTimers();
    localStorage.setItem('token', buildToken({ id: 8 }));
    vi.mocked(authService.verifyToken).mockResolvedValue({ data: { user: { id: 8, roleName: 'Técnico' } } } as any);
    renderAuth();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);

    // Inside the five-second window: no call.
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);

    // Past the window, a key other than token: no call.
    await vi.advanceTimersByTimeAsync(6000);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);

    // A login within the last two seconds: no call either.
    sessionStorage.setItem('lastLoginTime', String(Date.now()));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);

    sessionStorage.removeItem('lastLoginTime');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(authService.verifyToken).toHaveBeenCalledTimes(2);
  });

  it('does not start a second verification while one is in flight', async () => {
    localStorage.setItem('token', buildToken({ id: 9 }));
    vi.mocked(authService.verifyToken).mockReturnValue(new Promise(() => {}) as any);

    vi.useFakeTimers();
    const { result } = renderAuth();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(true);

    // Past the five-second window, so only the in-flight guard can stop a second call.
    await vi.advanceTimersByTimeAsync(6000);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('AuthProvider — login', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(authService.login).mockReset();
  });

  async function loginWith(response: unknown, args: [string, string, string?, string?] = ['ana', 'pw']) {
    vi.mocked(authService.login).mockResolvedValue(response as any);
    const view = renderAuth();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    let outcome: unknown;
    await act(async () => { outcome = await view.result.current.login(...args); });
    return { ...view, outcome };
  }

  it('signs in from data.data, stores the token and maps the role', async () => {
    const { result, outcome } = await loginWith(
      { data: { data: { token: 'tok-1', user: { id: 1, name: 'Ana', accessType: 4 } } } },
      ['ana', 'pw', '123456', 'new-pw'],
    );
    expect(authService.login).toHaveBeenCalledWith('ana', 'pw', '123456', 'new-pw');
    expect(outcome).toEqual({ requiresTwoFactor: false, user: { id: 1, name: 'Ana', accessType: 4, roleName: 'Administrador' } });
    expect(localStorage.getItem('token')).toBe('tok-1');
    expect(sessionStorage.getItem('lastLoginTime')).not.toBeNull();
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe('tok-1');
  });

  it('signs in from a top-level token and user and clears saved setup credentials', async () => {
    localStorage.setItem('tempUsername', 'ana');
    localStorage.setItem('tempPassword', 'pw');
    const { outcome } = await loginWith({ data: { token: 'tok-2', user: { id: 2, roleName: 'Técnico' } } });
    expect(outcome).toEqual({ requiresTwoFactor: false, user: { id: 2, roleName: 'Técnico' } });
    expect(localStorage.getItem('tempUsername')).toBeNull();
    expect(localStorage.getItem('tempPassword')).toBeNull();
  });

  it('asks for 2FA setup and saves the credentials for it', async () => {
    for (const data of [{ requiresTwoFactorSetup: true }, { requiresMFASetup: true }]) {
      localStorage.clear();
      const { outcome, unmount } = await loginWith({ data });
      expect(outcome).toEqual({ requiresTwoFactorSetup: true });
      expect(localStorage.getItem('tempUsername')).toBe('ana');
      expect(localStorage.getItem('tempPassword')).toBe('pw');
      unmount();
    }
  });

  it('asks for a 2FA code when none was sent, and when a code brought no token', async () => {
    for (const data of [{ requiresTwoFactor: true }, { requiresMFA: true }]) {
      const { outcome, unmount } = await loginWith({ data });
      expect(outcome).toEqual({ requiresTwoFactor: true });
      unmount();
    }
    const { outcome, result } = await loginWith({ data: { requiresTwoFactor: true } }, ['ana', 'pw', '123456']);
    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('asks for a new password, with the reason when the backend gives one', async () => {
    const withReason = await loginWith({ data: { requiresPasswordChange: true, reason: 'expired' } });
    expect(withReason.outcome).toEqual({ requiresPasswordChange: true, passwordChangeReason: 'expired' });
    withReason.unmount();

    const without = await loginWith({ data: { requiresPasswordChange: true } });
    expect(without.outcome).toEqual({ requiresPasswordChange: true });
  });

  it('treats an empty response as needing 2FA', async () => {
    const { outcome } = await loginWith({});
    expect(outcome).toEqual({ requiresTwoFactor: true });
  });

  async function loginRejecting(error: unknown) {
    vi.mocked(authService.login).mockRejectedValue(error);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let thrown: unknown;
    await act(async () => {
      try { await result.current.login('ana', 'pw'); } catch (e) { thrown = e; }
    });
    return thrown;
  }

  it('throws the backend error message on a 401', async () => {
    const thrown = await loginRejecting(httpError(401, { error: 'Credenciais inválidas' }));
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Credenciais inválidas');
  });

  it('throws a 2FA error object carrying the attempts left', async () => {
    const thrown = await loginRejecting(httpError(403, { message: 'Código inválido', requiresTwoFactor: true, attemptsRemaining: 2 }));
    expect(thrown).toEqual({ message: 'Código inválido', requiresTwoFactor: true, attemptsRemaining: 2 });
  });

  it('throws the error message, or a default one when there is none', async () => {
    expect(((await loginRejecting(new Error('Network Error'))) as Error).message).toBe('Network Error');
    expect(((await loginRejecting({})) as Error).message).toBe('Erro ao fazer login');
  });
});

describe('AuthProvider — logout', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(authService.logout).mockReset();
    vi.mocked(clearClientSession).mockClear();
    vi.mocked(authService.verifyToken).mockResolvedValue({ data: { user: { id: 1, roleName: 'Técnico' } } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the backend, clears the client session and signs out', async () => {
    localStorage.setItem('token', buildToken({ id: 1 }));
    vi.mocked(authService.logout).mockResolvedValue({} as any);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => { await result.current.logout(); });
    expect(authService.logout).toHaveBeenCalledTimes(1);
    expect(clearClientSession).toHaveBeenCalledWith({ redirectToLogin: true });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('still signs out locally when the backend call fails', async () => {
    localStorage.setItem('token', buildToken({ id: 1 }));
    const failure = new Error('down');
    vi.mocked(authService.logout).mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => { await result.current.logout(); });
    expect(consoleError).toHaveBeenCalledWith('Erro ao fazer logout:', failure);
    expect(clearClientSession).toHaveBeenCalledWith({ redirectToLogin: true });
    expect(result.current.user).toBeNull();
  });

  it('skips the backend call without a token', async () => {
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.logout(); });
    expect(authService.logout).not.toHaveBeenCalled();
    expect(clearClientSession).toHaveBeenCalledWith({ redirectToLogin: true });
  });
});

describe('AuthProvider — permission helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  async function signedInAs(user: Record<string, unknown> | null) {
    if (user) {
      localStorage.setItem('token', buildToken({ id: 1 }));
      vi.mocked(authService.verifyToken).mockResolvedValue({ data: { user } } as any);
    }
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    if (user) await waitFor(() => expect(result.current.user).toEqual(user));
    return result;
  }

  it('denies everything role-based when signed out', async () => {
    const result = await signedInAs(null);
    expect(result.current.hasAccess(1)).toBe(false);
    expect(result.current.hasRole('Técnico')).toBe(false);
    expect(result.current.canAccessRoute('/patients')).toBe(false);
    expect(result.current.canAccessRoute('/dashboard')).toBe(true);
    expect(result.current.hasReportAccess('Relatório de Amostras')).toBe(false);
    expect(result.current.getAllowedReports()).toEqual([]);
  });

  it('compares access by role name, or by accessType when there is none', async () => {
    const coordinator = await signedInAs({ id: 1, roleName: 'Coordenador' });
    expect(coordinator.current.hasAccess(3)).toBe(true);
    expect(coordinator.current.hasAccess(4)).toBe(false);
    expect(coordinator.current.hasRole('Técnico')).toBe(true);
    expect(coordinator.current.hasRole(['Administrador'])).toBe(false);

    const bare = await signedInAs({ id: 2 });
    expect(bare.current.hasAccess(1)).toBe(false);
    expect(bare.current.hasRole('Usuário Externo')).toBe(false);
    expect(bare.current.canAccessRoute('/user/security')).toBe(true);
    expect(bare.current.canAccessRoute('/patients')).toBe(false);
  });

  it('routes by role', async () => {
    const result = await signedInAs({ id: 1, roleName: 'Administrador' });
    expect(result.current.canAccessRoute('/')).toBe(true);
    expect(result.current.canAccessRoute('/no-such-page')).toBe(false);
  });

  it('gives accessType 3 every report, whatever allowedReports says', async () => {
    const result = await signedInAs({ id: 1, roleName: 'Coordenador', accessType: 3, allowedReports: ['Relatório de Amostras'] });
    expect(result.current.hasReportAccess('Relatório de Auditoria')).toBe(true);
    expect(result.current.getAllowedReports()).toHaveLength(7);
    expect(result.current.getAllowedReports()).toContain('Relatório de Auditoria');
  });

  it('limits reports to allowedReports when the backend sends them', async () => {
    const result = await signedInAs({ id: 1, roleName: 'Técnico', accessType: 2, allowedReports: ['Relatório de Amostras'] });
    expect(result.current.hasReportAccess('Relatório de Amostras')).toBe(true);
    expect(result.current.hasReportAccess('Relatório de Pacientes')).toBe(false);
    expect(result.current.getAllowedReports()).toEqual(['Relatório de Amostras']);
  });

  it('falls back to accessType 2 and above for reports without allowedReports', async () => {
    const tech = await signedInAs({ id: 1, roleName: 'Técnico', accessType: 2, allowedReports: [] });
    expect(tech.current.hasReportAccess('Relatório de Amostras')).toBe(true);
    expect(tech.current.getAllowedReports()).toEqual([]);

    const external = await signedInAs({ id: 2, roleName: 'Usuário Externo', accessType: 1 });
    expect(external.current.hasReportAccess('Relatório de Amostras')).toBe(false);

    const none = await signedInAs({ id: 3, roleName: 'Técnico' });
    expect(none.current.hasReportAccess('Relatório de Amostras')).toBe(false);
    expect(none.current.getAllowedReports()).toEqual([]);
  });
});

describe('useAuth', () => {
  it('throws outside an AuthProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth deve ser usado dentro de um AuthProvider');
    vi.restoreAllMocks();
  });
});
