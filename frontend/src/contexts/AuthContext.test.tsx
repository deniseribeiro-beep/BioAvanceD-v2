import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { authService } from '../services/api';

vi.mock('../services/api', () => ({
  authService: {
    verifyToken: vi.fn(),
  },
}));

function buildToken(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.sig`;
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
