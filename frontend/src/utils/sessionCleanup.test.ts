import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearClientSession, onClientLogout } from './sessionCleanup';

describe('sessionCleanup', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the stored session and tells listeners', () => {
    localStorage.setItem('token', 't');
    localStorage.setItem('tempUsername', 'u');
    localStorage.setItem('tempPassword', 'p');
    sessionStorage.setItem('verifyAttempts', '1');
    sessionStorage.setItem('lastLoginTime', '2');
    const listener = vi.fn();
    const stop = onClientLogout(listener);

    clearClientSession();

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('verifyAttempts')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    clearClientSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends the browser to login when asked and the page is somewhere else', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { pathname: '/patients', replace });
    clearClientSession({ redirectToLogin: true });
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('stays on the login page', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { pathname: '/login', replace });
    clearClientSession({ redirectToLogin: true });
    expect(replace).not.toHaveBeenCalled();
  });
});
