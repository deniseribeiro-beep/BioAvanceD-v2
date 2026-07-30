import { describe, it, expect } from 'vitest';

const authService = require('../../src/services/auth.service');

// ── getRoleName ───────────────────────────────────────────
describe('AuthService.getRoleName', () => {
  it('returns Usuário Externo for accessType 1', () => {
    expect(authService.getRoleName(1)).toBe('Usuário Externo');
  });

  it('returns Técnico for accessType 2', () => {
    expect(authService.getRoleName(2)).toBe('Técnico');
  });

  it('returns Coordenador for accessType 3', () => {
    expect(authService.getRoleName(3)).toBe('Coordenador');
  });

  it('returns Administrador for accessType 4', () => {
    expect(authService.getRoleName(4)).toBe('Administrador');
  });

  it('returns default Técnico for unknown accessType', () => {
    expect(authService.getRoleName(99)).toBe('Técnico');
  });
});

// ── getAccessTypeForRole ──────────────────────────────────
describe('AuthService.getAccessTypeForRole', () => {
  it('returns 1 for Usuário Externo', () => {
    expect(authService.getAccessTypeForRole('Usuário Externo')).toBe(1);
  });

  it('returns 2 for Técnico', () => {
    expect(authService.getAccessTypeForRole('Técnico')).toBe(2);
  });

  it('returns 3 for Coordenador', () => {
    expect(authService.getAccessTypeForRole('Coordenador')).toBe(3);
  });

  it('returns 4 for Administrador', () => {
    expect(authService.getAccessTypeForRole('Administrador')).toBe(4);
  });

  it('returns default 2 (Técnico) for unknown role', () => {
    expect(authService.getAccessTypeForRole('UnknownRole')).toBe(2);
  });
});

// ── issueAccessToken ──────────────────────────────────────
describe('AuthService.issueAccessToken', () => {
  const jwt = require('jsonwebtoken');

  const fakeUser = {
    _id: { toString: () => 'user-id-123' },
    email: 'qa@example.com',
    accessType: 2,
    roleName: 'Técnico',
    name: 'QA User',
    mfaEnabled: false,
  };

  it('returns a JWT string', () => {
    const token = authService.issueAccessToken(fakeUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes userID in payload', () => {
    const token = authService.issueAccessToken(fakeUser);
    const payload = jwt.decode(token);
    expect(payload.userID).toBe('user-id-123');
  });

  it('encodes accessType in payload', () => {
    const token = authService.issueAccessToken(fakeUser);
    const payload = jwt.decode(token);
    expect(payload.accessType).toBe(2);
  });

  it('encodes email in payload', () => {
    const token = authService.issueAccessToken(fakeUser);
    const payload = jwt.decode(token);
    expect(payload.email).toBe('qa@example.com');
  });

  it('token expires (has exp claim)', () => {
    const token = authService.issueAccessToken(fakeUser);
    const payload = jwt.decode(token);
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('produces different tokens for different users', () => {
    const user2 = { ...fakeUser, _id: { toString: () => 'other-user-456' } };
    const t1 = authService.issueAccessToken(fakeUser);
    const t2 = authService.issueAccessToken(user2);
    expect(t1).not.toBe(t2);
  });

  it('produces distinct tokens for two logins of the same user within the same second (#338)', () => {
    // iat/exp are second-granularity; without a per-login nonce two calls in
    // the same wall-clock second sign byte-identical JWTs, so their tokenHash
    // collides in session storage and revoking one revokes both.
    const t1 = authService.issueAccessToken(fakeUser);
    const t2 = authService.issueAccessToken(fakeUser);
    expect(t1).not.toBe(t2);
  });

  it('assigns a unique jti per token', () => {
    const payload1 = jwt.decode(authService.issueAccessToken(fakeUser));
    const payload2 = jwt.decode(authService.issueAccessToken(fakeUser));
    expect(payload1.jti).toBeTruthy();
    expect(payload2.jti).toBeTruthy();
    expect(payload1.jti).not.toBe(payload2.jti);
  });
});

// ── issueRefreshToken ─────────────────────────────────────
describe('AuthService.issueRefreshToken', () => {
  const jwt = require('jsonwebtoken');

  const fakeUser = {
    _id: { toString: () => 'user-id-123' },
    email: 'qa@example.com',
    accessType: 2,
  };

  it('returns a JWT string', () => {
    const token = authService.issueRefreshToken(fakeUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes userID in payload', () => {
    const token = authService.issueRefreshToken(fakeUser);
    const payload = jwt.decode(token);
    expect(payload.userID).toBe('user-id-123');
  });

  it('includes sessionID when provided', () => {
    const token = authService.issueRefreshToken(fakeUser, 'sess-xyz');
    const payload = jwt.decode(token);
    expect(payload.sessionID).toBe('sess-xyz');
  });

  it('works without sessionID', () => {
    expect(() => authService.issueRefreshToken(fakeUser)).not.toThrow();
  });

  it('has longer expiry than access token', () => {
    const access = authService.issueAccessToken(fakeUser);
    const refresh = authService.issueRefreshToken(fakeUser);
    const aExp = jwt.decode(access).exp;
    const rExp = jwt.decode(refresh).exp;
    expect(rExp).toBeGreaterThan(aExp);
  });

  it('produces distinct tokens for two logins of the same user within the same second (#338)', () => {
    const t1 = authService.issueRefreshToken(fakeUser);
    const t2 = authService.issueRefreshToken(fakeUser);
    expect(t1).not.toBe(t2);
  });
});
