import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// useUserSecurity's reading of the security endpoints: the response envelopes,
// the session field names, the error messages and the stale-response guard.
const h = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getMFAStatus: vi.fn(),
  getPasswordStatus: vi.fn(),
  getSessions: vi.fn(),
  updatePassword: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
}));

vi.mock('@/services/api', () => ({ userSecurityService: h }));

import { useUserSecurity } from '@/hooks/useUserSecurity';

const env = (data: unknown) => ({ data: { data } });

function serve(status: unknown, mfa: unknown, password: unknown, sessions: unknown) {
  h.getStatus.mockResolvedValue(status);
  h.getMFAStatus.mockResolvedValue(mfa);
  h.getPasswordStatus.mockResolvedValue(password);
  h.getSessions.mockResolvedValue(sessions);
}

async function loaded() {
  const hook = renderHook(() => useUserSecurity());
  await act(async () => {
    await hook.result.current.refreshData();
  });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useUserSecurity refreshData', () => {
  it('starts loading with nothing read', () => {
    const { result } = renderHook(() => useUserSecurity());
    expect(result.current.loading).toBe(true);
    expect(result.current.securityStatus).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('reads the { data: { data } } envelope and the bare { data } one', async () => {
    serve(
      env({ securityScore: 70, overallLevel: 'medium', alternativeMethodsCount: 1 }),
      { data: { primaryEnabled: true } },
      env({ strength: 'strong' }),
      env([]),
    );
    const { result } = await loaded();
    expect(result.current.securityStatus).toEqual({ securityScore: 70, overallLevel: 'medium', alternativeMethodsCount: 1 });
    expect(result.current.mfaStatus).toEqual({ primaryEnabled: true });
    expect(result.current.passwordStatus).toEqual({ strength: 'strong' });
    expect(result.current.loading).toBe(false);
  });

  it('reads a non-object response as nothing', async () => {
    serve(null, undefined, 'x', 42);
    const { result } = await loaded();
    expect(result.current.securityStatus).toBeNull();
    expect(result.current.mfaStatus).toBeNull();
    expect(result.current.passwordStatus).toBeNull();
    expect(result.current.sessions).toEqual([]);
  });

  it('reads a null payload inside the envelope as nothing, not as a record (#1434)', async () => {
    serve(env(null), env(null), env(null), env(null));
    const { result } = await loaded();
    expect(result.current.securityStatus).toBeNull();
    expect(result.current.mfaStatus).toBeNull();
    expect(result.current.passwordStatus).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('maps each session field from its alternative names', async () => {
    serve(env(null), env(null), env(null), env([
      { id: 'a', deviceName: 'Laptop', browser: 'Firefox', os: 'Linux', location: 'Campinas', ipAddress: '10.0.0.1', lastAccess: 'L', isCurrent: true },
      { sessionID: 'b', deviceInfo: { deviceName: 'Phone', browser: 'Chrome', os: 'Android' }, geoLocation: 'Recife', lastActivity: 'A', currentSession: false },
      { sessionID: 'c', deviceInfo: { type: 'tablet' }, ipLocation: 'Natal', createdAt: 'C', current: true },
      { sessionID: 'd', ipAddress: '10.0.0.4', createdAt: 'D' },
    ]));
    const { result } = await loaded();
    expect(result.current.sessions).toEqual([
      { id: 'a', deviceName: 'Laptop', browser: 'Firefox', os: 'Linux', location: 'Campinas', ipAddress: '10.0.0.1', lastAccess: 'L', isCurrent: true },
      { id: 'b', deviceName: 'Phone', browser: 'Chrome', os: 'Android', location: 'Recife', ipAddress: undefined, lastAccess: 'A', isCurrent: false },
      { id: 'c', deviceName: 'tablet', browser: undefined, os: undefined, location: 'Natal', ipAddress: undefined, lastAccess: 'C', isCurrent: true },
      { id: 'd', deviceName: undefined, browser: undefined, os: undefined, location: '10.0.0.4', ipAddress: '10.0.0.4', lastAccess: 'D', isCurrent: false },
    ]);
  });

  it("records the server's message when a load fails", async () => {
    serve(env(null), env(null), env(null), env([]));
    h.getStatus.mockRejectedValue({ response: { data: { message: 'Sessão expirada' } } });
    const { result } = await loaded();
    expect(result.current.error).toBe('Sessão expirada');
    expect(result.current.loading).toBe(false);
  });

  it('falls back to its own message for a non-object failure', async () => {
    serve(env(null), env(null), env(null), env([]));
    h.getSessions.mockRejectedValue('boom');
    const { result } = await loaded();
    expect(result.current.error).toBe('Erro ao carregar dados de segurança');
  });

  it('drops an older load that resolves after a newer one', async () => {
    let resolveOld!: (v: unknown) => void;
    h.getStatus
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r; }))
      .mockResolvedValue(env({ securityScore: 95, overallLevel: 'strong', alternativeMethodsCount: 0 }));
    h.getMFAStatus.mockResolvedValue(env(null));
    h.getPasswordStatus.mockResolvedValue(env(null));
    h.getSessions.mockResolvedValue(env([]));
    const { result } = renderHook(() => useUserSecurity());
    let older!: Promise<void>;
    act(() => {
      older = result.current.refreshData();
    });
    await act(async () => {
      await result.current.refreshData();
    });
    await act(async () => {
      resolveOld(env({ securityScore: 10, overallLevel: 'weak', alternativeMethodsCount: 0 }));
      await older;
    });
    expect(result.current.securityStatus?.securityScore).toBe(95);
    expect(result.current.loading).toBe(false);
  });

  it('drops an older failure that lands after a newer load', async () => {
    let rejectOld!: (e: unknown) => void;
    h.getStatus
      .mockReturnValueOnce(new Promise((_r, j) => { rejectOld = j; }))
      .mockResolvedValue(env({ securityScore: 95, overallLevel: 'strong', alternativeMethodsCount: 0 }));
    h.getMFAStatus.mockResolvedValue(env(null));
    h.getPasswordStatus.mockResolvedValue(env(null));
    h.getSessions.mockResolvedValue(env([]));
    const { result } = renderHook(() => useUserSecurity());
    let older!: Promise<void>;
    act(() => {
      older = result.current.refreshData();
    });
    await act(async () => {
      await result.current.refreshData();
    });
    await act(async () => {
      rejectOld(new Error('late'));
      await older;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.securityStatus?.securityScore).toBe(95);
  });
});

describe('useUserSecurity mutations', () => {
  beforeEach(() => {
    serve(env({ securityScore: 50, overallLevel: 'medium', alternativeMethodsCount: 0 }),
      env({ primaryEnabled: true, recoveryCodes: { remaining: 1 } }), env(null),
      env([{ id: 'cur', isCurrent: true, lastAccess: 'x' }, { id: 'other', isCurrent: false, lastAccess: 'y' }]));
  });

  it('updatePassword sends both passwords and reloads', async () => {
    const { result } = await loaded();
    h.updatePassword.mockResolvedValue({});
    const before = h.getStatus.mock.calls.length;
    await act(async () => {
      await result.current.updatePassword('old', 'new');
    });
    expect(h.updatePassword).toHaveBeenCalledWith('old', 'new');
    expect(h.getStatus.mock.calls.length).toBe(before + 1);
  });

  it("updatePassword rethrows the server's error, else its own message", async () => {
    const { result } = await loaded();
    h.updatePassword.mockRejectedValueOnce({ response: { data: { error: 'Senha atual incorreta' } } });
    await expect(result.current.updatePassword('a', 'b')).rejects.toThrow('Senha atual incorreta');
    h.updatePassword.mockRejectedValueOnce(42);
    await expect(result.current.updatePassword('a', 'b')).rejects.toThrow('Erro ao atualizar senha');
  });

  it('generateRecoveryCodes keeps the clear-text codes over a load still in flight', async () => {
    const { result } = await loaded();
    let resolveLoad!: (v: unknown) => void;
    h.getMFAStatus.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    let inFlight!: Promise<void>;
    act(() => {
      inFlight = result.current.refreshData();
    });
    h.generateRecoveryCodes.mockResolvedValue({ data: { codes: ['X1', 'X2', 'X3'] } });
    let codes: string[] = [];
    await act(async () => {
      codes = await result.current.generateRecoveryCodes();
    });
    await act(async () => {
      resolveLoad(env({ primaryEnabled: true, recoveryCodes: { remaining: 3 } }));
      await inFlight;
    });
    expect(codes).toEqual(['X1', 'X2', 'X3']);
    expect(result.current.mfaStatus?.recoveryCodes).toEqual({ remaining: 3, codes: ['X1', 'X2', 'X3'] });
  });

  it('generateRecoveryCodes writes no codes into a null MFA payload (#1434)', async () => {
    h.getMFAStatus.mockResolvedValue(env(null));
    const { result } = await loaded();
    h.generateRecoveryCodes.mockResolvedValue({ data: { codes: ['Z1', 'Z2'] } });
    await act(async () => {
      await result.current.generateRecoveryCodes();
    });
    expect(result.current.mfaStatus).toBeNull();
  });

  it('generateRecoveryCodes throws when the server sends no codes, or fails', async () => {
    const { result } = await loaded();
    h.generateRecoveryCodes.mockResolvedValueOnce(env({}));
    await expect(result.current.generateRecoveryCodes()).rejects.toThrow('Nenhum código foi gerado');
    h.generateRecoveryCodes.mockRejectedValueOnce(null);
    await expect(result.current.generateRecoveryCodes()).rejects.toThrow('Erro ao gerar códigos de recuperação');
  });

  it('revokeSession drops the session and reloads; a failure rethrows', async () => {
    const { result } = await loaded();
    h.revokeSession.mockResolvedValue({});
    h.getSessions.mockResolvedValue(env([{ id: 'cur', isCurrent: true, lastAccess: 'x' }]));
    await act(async () => {
      await result.current.revokeSession('other');
    });
    expect(h.revokeSession).toHaveBeenCalledWith('other');
    expect(result.current.sessions.map((s) => s.id)).toEqual(['cur']);
    h.revokeSession.mockRejectedValueOnce(new Error('não encontrada'));
    await expect(result.current.revokeSession('cur')).rejects.toThrow('não encontrada');
    h.revokeSession.mockRejectedValueOnce(undefined);
    await expect(result.current.revokeSession('cur')).rejects.toThrow('Erro ao revogar sessão');
  });

  it('revokeAllSessions keeps only the current session; a failure rethrows', async () => {
    const { result } = await loaded();
    let resolveLoad!: (v: unknown) => void;
    h.revokeAllSessions.mockResolvedValue({});
    h.getSessions.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.revokeAllSessions();
    });
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(['cur']));
    await act(async () => {
      resolveLoad(env([{ id: 'cur', isCurrent: true, lastAccess: 'x' }]));
      await pending;
    });
    expect(h.revokeAllSessions).toHaveBeenCalledTimes(1);
    h.revokeAllSessions.mockRejectedValueOnce('x');
    await expect(result.current.revokeAllSessions()).rejects.toThrow('Erro ao revogar todas as sessões');
  });
});
