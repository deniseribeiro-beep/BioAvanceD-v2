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
  const { buildRbacCollections } = require('../factories/rbac.factory');

  const fakeUser = {
    _id: { toString: () => 'user-id-123' },
    email: 'qa@example.com',
    accessType: 2,
    roleName: 'Técnico',
    name: 'QA User',
    mfaEnabled: false,
  };

  // #431: accessType is resolved fresh from the RBAC assignment
  // (rbac-assignment.service.resolveUserHierarchyLevel), not read off
  // `user.accessType` — `db` now stands in for the stale field, keyed by
  // whatever userAccountId/accessType pairs the test needs granted.
  function makeDb(grants = [{ userAccountId: 'user-id-123', accessType: 2 }]) {
    const rbac = buildRbacCollections(grants);
    return { collection: (name) => rbac[name] };
  }

  it('returns a JWT string', async () => {
    const token = await authService.issueAccessToken(makeDb(), fakeUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes userID in payload', async () => {
    const token = await authService.issueAccessToken(makeDb(), fakeUser);
    const payload = jwt.decode(token);
    expect(payload.userID).toBe('user-id-123');
  });

  it('encodes accessType resolved from the RBAC assignment in payload', async () => {
    const token = await authService.issueAccessToken(makeDb(), fakeUser);
    const payload = jwt.decode(token);
    expect(payload.accessType).toBe(2);
  });

  it('resolves accessType from the live assignment, not the stale user.accessType field', async () => {
    // fakeUser.accessType is 2, but the granted assignment is 4 (Administrador)
    // — the claim must follow the RBAC grant, not the User document field.
    const db = makeDb([{ userAccountId: 'user-id-123', accessType: 4 }]);
    const token = await authService.issueAccessToken(db, fakeUser);
    const payload = jwt.decode(token);
    expect(payload.accessType).toBe(4);
  });

  it('encodes email in payload', async () => {
    const token = await authService.issueAccessToken(makeDb(), fakeUser);
    const payload = jwt.decode(token);
    expect(payload.email).toBe('qa@example.com');
  });

  it('token expires (has exp claim)', async () => {
    const token = await authService.issueAccessToken(makeDb(), fakeUser);
    const payload = jwt.decode(token);
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('produces different tokens for different users', async () => {
    const user2 = { ...fakeUser, _id: { toString: () => 'other-user-456' } };
    const db = makeDb([
      { userAccountId: 'user-id-123', accessType: 2 },
      { userAccountId: 'other-user-456', accessType: 2 },
    ]);
    const t1 = await authService.issueAccessToken(db, fakeUser);
    const t2 = await authService.issueAccessToken(db, user2);
    expect(t1).not.toBe(t2);
  });

  it('produces distinct tokens for two logins of the same user within the same second (#338)', async () => {
    // iat/exp are second-granularity; without a per-login nonce two calls in
    // the same wall-clock second sign byte-identical JWTs, so their tokenHash
    // collides in session storage and revoking one revokes both.
    const db = makeDb();
    const t1 = await authService.issueAccessToken(db, fakeUser);
    const t2 = await authService.issueAccessToken(db, fakeUser);
    expect(t1).not.toBe(t2);
  });

  it('assigns a unique jti per token', async () => {
    const db = makeDb();
    const payload1 = jwt.decode(await authService.issueAccessToken(db, fakeUser));
    const payload2 = jwt.decode(await authService.issueAccessToken(db, fakeUser));
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

  it('has longer expiry than access token', async () => {
    const { buildRbacCollections } = require('../factories/rbac.factory');
    const rbac = buildRbacCollections([{ userAccountId: 'user-id-123', accessType: 2 }]);
    const db = { collection: (name) => rbac[name] };
    const access = await authService.issueAccessToken(db, fakeUser);
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
