import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const userSecurityService = require('../../src/services/user-security.service');
const sessionService = require('../../src/services/session.service');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// Minimal Mongo-query matcher covering the shapes revokeAllOtherSessions
// builds (top-level equality, $and, $ne), so the mocked updateMany can
// actually filter/mutate fake documents instead of just recording calls.
function matchesMongoQuery(doc, query) {
  return Object.entries(query).every(([key, condition]) => {
    if (key === '$and') {
      return condition.every((clause) => matchesMongoQuery(doc, clause));
    }
    if (condition && typeof condition === 'object' && '$ne' in condition) {
      return doc[key] !== condition.$ne;
    }
    return doc[key] === condition;
  });
}

function buildDb(collections) {
  return {
    collection: vi.fn((name) => collections[name])
  };
}

function buildCollection(overrides = {}) {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({}),
    ...overrides
  };
}

const USER_ID = '507f1f77bcf86cd799439011';

describe('UserSecurityService DB-backed methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionService.sessions.clear();
  });

  describe('getMFAStatus', () => {
    it('returns MFA status with recovery codes info', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, mfaEnabled: true, mfaSetupDate: '2026-01-01' })
      });
      const recoveryCodes = buildCollection({
        findOne: vi.fn().mockResolvedValue({ remaining: 3 })
      });
      const db = buildDb({ users, recovery_codes: recoveryCodes });

      const result = await userSecurityService.getMFAStatus(db, USER_ID);

      expect(result).toEqual({
        primaryEnabled: true,
        primarySetupDate: '2026-01-01',
        recoveryCodes: { remaining: 3, codes: null }
      });
    });

    it('defaults recovery codes to 0 when none found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue({ _id: USER_ID }) });
      const recoveryCodes = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users, recovery_codes: recoveryCodes });

      const result = await userSecurityService.getMFAStatus(db, USER_ID);

      expect(result.primaryEnabled).toBe(false);
      expect(result.recoveryCodes.remaining).toBe(0);
    });

    it('throws when user not found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users });

      await expect(userSecurityService.getMFAStatus(db, USER_ID)).rejects.toThrow('Usuário não encontrado');
    });
  });

  describe('getPasswordStatus', () => {
    it('returns password status derived from stored password hash', async () => {
      const bcryptHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: bcryptHash,
          passwordChangedAt: new Date('2026-01-01T00:00:00.000Z')
        })
      });
      const db = buildDb({ users });

      const result = await userSecurityService.getPasswordStatus(db, USER_ID);

      expect(result.strength).toBe('strong');
      expect(result.strengthScore).toBe(5);
      expect(result.lastChanged).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(result.expiresAt.getTime()).toBe(
        new Date('2026-01-01T00:00:00.000Z').getTime() + 90 * 24 * 60 * 60 * 1000
      );
    });

    it('falls back to createdAt/now when passwordChangedAt is missing', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, password: 'short' })
      });
      const db = buildDb({ users });

      const result = await userSecurityService.getPasswordStatus(db, USER_ID);

      expect(result.strength).toBe('medium');
      expect(result.lastChanged).toBeInstanceOf(Date);
    });

    it('throws when user not found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users });

      await expect(userSecurityService.getPasswordStatus(db, USER_ID)).rejects.toThrow('Usuário não encontrado');
    });

    it('parses passwordChangedAt when stored as a non-Date value', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: 'short',
          passwordChangedAt: '2026-01-01T00:00:00.000Z'
        })
      });
      const db = buildDb({ users });

      const result = await userSecurityService.getPasswordStatus(db, USER_ID);

      expect(result.expiresAt.getTime()).toBe(
        new Date('2026-01-01T00:00:00.000Z').getTime() + 90 * 24 * 60 * 60 * 1000
      );
    });
  });

  describe('getSecurityStatus', () => {
    it('aggregates MFA and password status into an overall score/level', async () => {
      const bcryptHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          mfaEnabled: true,
          password: bcryptHash,
          passwordChangedAt: new Date()
        })
      });
      const recoveryCodes = buildCollection({ findOne: vi.fn().mockResolvedValue({ remaining: 10 }) });
      const db = buildDb({ users, recovery_codes: recoveryCodes });

      const result = await userSecurityService.getSecurityStatus(db, USER_ID);

      expect(result.overallLevel).toBe('strong');
      expect(result.securityScore).toBeGreaterThanOrEqual(80);
      expect(result.alternativeMethodsCount).toBe(1);
    });

    it('reports weak level for a bare-minimum account', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, mfaEnabled: false, password: null })
      });
      const recoveryCodes = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users, recovery_codes: recoveryCodes });

      const result = await userSecurityService.getSecurityStatus(db, USER_ID);

      expect(result.overallLevel).toBe('weak');
      expect(result.alternativeMethodsCount).toBe(0);
    });

    it('throws when user not found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users });

      await expect(userSecurityService.getSecurityStatus(db, USER_ID)).rejects.toThrow('Usuário não encontrado');
    });

    it('reports medium level for a mid-range score', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, mfaEnabled: true, password: null })
      });
      const recoveryCodes = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users, recovery_codes: recoveryCodes });

      const result = await userSecurityService.getSecurityStatus(db, USER_ID);

      expect(result.securityScore).toBeGreaterThanOrEqual(50);
      expect(result.securityScore).toBeLessThan(80);
      expect(result.overallLevel).toBe('medium');
    });
  });

  describe('updatePassword', () => {
    it('rejects an incorrect current password', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, password: await bcrypt.hash('correct-pass', 10) })
      });
      const db = buildDb({ users });

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'wrong-pass', 'NewPassw0rd!123')
      ).rejects.toThrow('Senha atual incorreta');
    });

    it('rejects a new password that fails complexity validation', async () => {
      const currentHash = await bcrypt.hash('correct-pass', 10);
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue({ _id: USER_ID, password: currentHash }) });
      const db = buildDb({ users });

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'correct-pass', 'weak')
      ).rejects.toThrow();
    });

    it('rejects reuse of a recent password', async () => {
      const currentHash = await bcrypt.hash('correct-pass', 10);
      const reusedHash = await bcrypt.hash('NewPassw0rd!123', 10);
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: currentHash,
          passwordHistory: [reusedHash]
        })
      });
      const db = buildDb({ users });

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'correct-pass', 'NewPassw0rd!123')
      ).rejects.toThrow('Você não pode reutilizar uma senha recente');
    });

    it('updates the password and rotates history on success', async () => {
      const currentHash = await bcrypt.hash('correct-pass', 10);
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, password: currentHash, passwordHistory: [] })
      });
      const db = buildDb({ users });

      await userSecurityService.updatePassword(db, USER_ID, 'correct-pass', 'NewPassw0rd!123');

      expect(users.updateOne).toHaveBeenCalledTimes(1);
      const [, update] = users.updateOne.mock.calls[0];
      expect(update.$set.passwordHistory).toEqual([currentHash]);
      expect(await bcrypt.compare('NewPassw0rd!123', update.$set.password)).toBe(true);
      // #995: this route is the fifth site verifying a user-supplied password.
      // It wrote neither lockout field, so it could only ever count up. A
      // successful change clears the counter AND the lock, the same pairing
      // processLogin's success path uses -- the gate reads accountLockedUntil
      // and never the counter, so clearing one alone leaves the user locked.
      expect(update.$set.failedLoginAttempts).toBe(0);
      expect(update.$set.accountLockedUntil).toBeNull();
    });

    // #995 (RF001 AC#2): "bloquear temporariamente a conta apos o limite
    // configurado de tentativas malsucedidas" -- the account, not one route.
    it('counts an incorrect current password toward the account lockout', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: await bcrypt.hash('correct-pass', 10),
          failedLoginAttempts: 1
        })
      });
      const db = buildDb({ users });

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'wrong-pass', 'NewPassw0rd!123')
      ).rejects.toThrow('Senha atual incorreta');

      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: USER_ID },
        expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
      );
    });

    // #995: the gate runs BEFORE the compare, as it does at the other four
    // sites -- after it, a lock denies only the eventual correct guess while
    // every wrong one still burns a bcrypt round.
    it('refuses a locked account without verifying the current password', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: await bcrypt.hash('correct-pass', 10),
          accountLockedUntil: lockedUntil
        })
      });
      const db = buildDb({ users });
      const compareSpy = vi.spyOn(bcrypt, 'compare');

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'correct-pass', 'NewPassw0rd!123')
      ).rejects.toThrow('Senha atual incorreta');

      expect(compareSpy).not.toHaveBeenCalled();
      expect(users.updateOne).not.toHaveBeenCalled();
      compareSpy.mockRestore();
    });

    // #995: the negative half of the gate. Without it the pair above cannot
    // distinguish a working expiry comparison from an unconditional refusal.
    it('allows the change when a previous lock has already expired', async () => {
      const expired = new Date(Date.now() - 60 * 1000);
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: USER_ID,
          password: await bcrypt.hash('correct-pass', 10),
          passwordHistory: [],
          accountLockedUntil: expired
        })
      });
      const db = buildDb({ users });

      await userSecurityService.updatePassword(db, USER_ID, 'correct-pass', 'NewPassw0rd!123');

      expect(users.updateOne).toHaveBeenCalledTimes(1);
      const [, update] = users.updateOne.mock.calls[0];
      expect(update.$set.accountLockedUntil).toBeNull();
    });

    it('throws when user not found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users });

      await expect(
        userSecurityService.updatePassword(db, USER_ID, 'a', 'NewPassw0rd!123')
      ).rejects.toThrow('Usuário não encontrado');
    });
  });

  describe('generateRecoveryCodes', () => {
    it('generates and persists 10 hashed recovery codes', async () => {
      const recoveryCodes = buildCollection();
      const db = buildDb({ recovery_codes: recoveryCodes });

      const codes = await userSecurityService.generateRecoveryCodes(db, USER_ID);

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(recoveryCodes.updateOne).toHaveBeenCalledTimes(1);
      const [, update, options] = recoveryCodes.updateOne.mock.calls[0];
      expect(update.$set.remaining).toBe(10);
      expect(update.$set.codes).toHaveLength(10);
      expect(options).toEqual({ upsert: true });
    });
  });

  describe('revokeSession', () => {
    it('revokes a matching session and clears it from the in-memory cache', async () => {
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const db = buildDb({ sessions });
      sessionService.sessions.set('sess-1', { sessionID: 'sess-1', userID: USER_ID });

      await userSecurityService.revokeSession(db, USER_ID, 'sess-1');

      expect(sessions.updateOne).toHaveBeenCalledTimes(1);
      expect(sessionService.sessions.has('sess-1')).toBe(false);
    });

    it('throws when no session matches', async () => {
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) });
      const db = buildDb({ sessions });

      await expect(userSecurityService.revokeSession(db, USER_ID, 'missing')).rejects.toThrow('Sessão não encontrada');
    });

    it('#974: matches the isRevoked/revocationReason/revokedBy shape the other revoke routes write', async () => {
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const db = buildDb({ sessions });

      await userSecurityService.revokeSession(db, USER_ID, 'sess-1');

      const [, update] = sessions.updateOne.mock.calls[0];
      expect(update.$set).toEqual(
        expect.objectContaining({
          isActive: false,
          isRevoked: true,
          revocationReason: 'user_request',
          revokedBy: String(USER_ID)
        })
      );
    });

    it('adds an _id clause to the query when sessionId is a valid ObjectId', async () => {
      const validObjectId = '507f1f77bcf86cd799439099';
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const db = buildDb({ sessions });

      await userSecurityService.revokeSession(db, USER_ID, validObjectId);

      const [query] = sessions.updateOne.mock.calls[0];
      expect(query.$or).toHaveLength(2);
    });

    it('falls back to matching by sessionID/_id fields when the cache key differs from sessionId', async () => {
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const db = buildDb({ sessions });
      sessionService.sessions.set('cache-key', { sessionID: 'sess-1', userID: USER_ID });

      await userSecurityService.revokeSession(db, USER_ID, 'sess-1');

      expect(sessionService.sessions.has('cache-key')).toBe(false);
    });

    it('falls back to matching by a stringified _id when neither the cache key nor sessionID match', async () => {
      const validObjectId = '507f1f77bcf86cd799439099';
      const sessions = buildCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const db = buildDb({ sessions });
      sessionService.sessions.set('cache-key', {
        userID: USER_ID,
        _id: { toString: () => validObjectId }
      });

      await userSecurityService.revokeSession(db, USER_ID, validObjectId);

      expect(sessionService.sessions.has('cache-key')).toBe(false);
    });
  });

  describe('revokeAllSessions', () => {
    it('revokes all other sessions and clears them from the cache, keeping the current one', async () => {
      const sessions = buildCollection();
      const db = buildDb({ sessions });
      sessionService.sessions.set('other', { userID: USER_ID, token: 'old-token' });
      sessionService.sessions.set('current', { userID: USER_ID, token: 'current-token' });

      await userSecurityService.revokeAllSessions(db, USER_ID, 'current-token');

      expect(sessions.updateMany).toHaveBeenCalledTimes(1);
      expect(sessionService.sessions.has('other')).toBe(false);
      expect(sessionService.sessions.has('current')).toBe(true);
    });

    it('marks revoked documents isRevoked: true and spares a session identified only by tokenHash (Refs #920)', async () => {
      const currentToken = 'current-token';
      const currentHash = hashToken(currentToken);

      // doc1 is the caller's own session -- stored (like real sessions) by
      // tokenHash only, no plaintext token field. doc2 is another session,
      // still on legacy plaintext token.
      const docs = [
        { _id: '1', userID: USER_ID, tokenHash: currentHash, isActive: true },
        { _id: '2', userID: USER_ID, token: 'other-token', isActive: true }
      ];

      const sessions = buildCollection({
        updateMany: vi.fn(async (query, update) => {
          const matched = docs.filter((doc) => matchesMongoQuery(doc, query));
          matched.forEach((doc) => Object.assign(doc, update.$set));
          return { matchedCount: matched.length };
        })
      });
      const db = buildDb({ sessions });

      await userSecurityService.revokeAllSessions(db, USER_ID, currentToken);

      // Session matched only by tokenHash must NOT be revoked -- proves the
      // exclusion isn't plaintext-`token`-only.
      expect(docs[0].isRevoked).toBeUndefined();
      expect(docs[0].isActive).toBe(true);

      // The other user's session gets revoked, and carries isRevoked: true
      // (the field session.service.js siblings set that the old
      // revokeAllSessions omitted).
      expect(docs[1].isRevoked).toBe(true);
      expect(docs[1].isActive).toBe(false);
      expect(docs[1].revokedAt).toBeInstanceOf(Date);
      expect(docs[1].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('requestPasswordReset', () => {
    it('generates and persists a reset token with the requested expiration', async () => {
      const users = buildCollection({
        findOne: vi.fn().mockResolvedValue({ _id: USER_ID, email: 'user@example.com' })
      });
      const db = buildDb({ users });

      const result = await userSecurityService.requestPasswordReset(db, USER_ID, 2);

      expect(result.expirationHours).toBe(2);
      expect(typeof result.resetToken).toBe('string');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(users.updateOne).toHaveBeenCalledTimes(1);
    });

    it('throws when user not found', async () => {
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = buildDb({ users });

      await expect(userSecurityService.requestPasswordReset(db, USER_ID)).rejects.toThrow('Usuário não encontrado');
    });
  });

  describe('getUserAnonId', () => {
    it('returns a deterministic anon id for a user', async () => {
      const db = buildDb({});
      const result = await userSecurityService.getUserAnonId(db, USER_ID);
      expect(result).toMatch(/^USR-[0-9A-F]{8}$/);
    });
  });

  describe('getActivities', () => {
    it('classifies log entries into activity types', async () => {
      const logs = [
        { message: 'Login realizado', timestamp: new Date(), ip: '10.0.0.1' },
        { entity: 'MFA', message: 'mfa updated', timestamp: new Date() },
        { entity: 'Password', message: 'senha alterada', timestamp: new Date() },
        { severity: 'critical', message: 'weird stuff', timestamp: new Date() },
        { result: 'failure', message: 'tentativa bloqueada', timestamp: new Date() }
      ];
      const auditLogs = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(logs)
        })
      });
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue({ _id: USER_ID, anonId: 'USR-TEST' }) });
      const db = buildDb({ audit_logs: auditLogs, users });

      const activities = await userSecurityService.getActivities(db, USER_ID, 5);

      expect(activities.map((a) => a.type)).toEqual([
        'login',
        'mfa_change',
        'password_change',
        'suspicious',
        'failed_attempt'
      ]);
    });

    it('falls back to a default description and derived ip/timestamp when a log entry has neither', async () => {
      const logs = [
        { metadata: { ip: '10.0.0.2' } },
        { entity: 'Password', createdAt: new Date('2026-02-01T00:00:00.000Z'), requestInfo: { ip: '10.0.0.3' } },
        {}
      ];
      const auditLogs = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(logs)
        })
      });
      const users = buildCollection({ findOne: vi.fn().mockResolvedValue({ _id: USER_ID, anonId: 'USR-TEST' }) });
      const db = buildDb({ audit_logs: auditLogs, users });

      const activities = await userSecurityService.getActivities(db, USER_ID, 5);

      expect(activities[0].description).toBe('Ação realizada');
      expect(activities[0].location).toBe('10.0.xxx.xxx');
      expect(activities[1].timestamp).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(activities[1].location).toBe('10.0.xxx.xxx');
      expect(activities[2].timestamp).toBeInstanceOf(Date);
      expect(activities[2].location).toBeNull();
    });
  });

  describe('getSessions', () => {
    it('returns sessions from the database with parsed device details', async () => {
      const dbSessions = [
        {
          sessionID: 'sess-1',
          token: 'current-token',
          sessionData: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ip: '10.0.0.5' },
          lastActivity: new Date()
        }
      ];
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(dbSessions)
        })
      });
      const db = buildDb({ sessions });

      const result = await userSecurityService.getSessions(db, USER_ID, 'current-token');

      expect(result).toHaveLength(1);
      expect(result[0].isCurrent).toBe(true);
      expect(result[0].os).toBe('Windows 10/11');
      expect(result[0].location).toBe('10.0.xxx.xxx');
    });

    it('falls back to a synthetic current session when nothing is stored', async () => {
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([])
        })
      });
      const db = buildDb({ sessions });
      sessionService.sessions.clear();

      const result = await userSecurityService.getSessions(db, USER_ID, 'current-token', { userAgent: null, ip: null });

      expect(result).toEqual([
        expect.objectContaining({ id: 'current', isCurrent: true, deviceName: 'Dispositivo Desconhecido' })
      ]);
    });

    it('returns an empty list when there are no db/cache sessions and no currentToken', async () => {
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([])
        })
      });
      const db = buildDb({ sessions });
      sessionService.sessions.clear();

      const result = await userSecurityService.getSessions(db, USER_ID, null);

      expect(result).toEqual([]);
    });

    it('marks non-matching sessions as not current and falls back through metadata/requestInfo fields', async () => {
      const dbSessions = [
        {
          _id: { toString: () => 'raw-id' },
          token: 'other-token',
          metadata: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', ip: '10.0.0.9' },
          createdAt: new Date('2026-01-01T00:00:00.000Z')
        }
      ];
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(dbSessions)
        })
      });
      const db = buildDb({ sessions });

      const result = await userSecurityService.getSessions(db, USER_ID, 'current-token');

      expect(result[0].isCurrent).toBe(false);
      expect(result[0].id).toBe('raw-id');
      expect(result[0].os).toBe('macOS');
      expect(result[0].location).toBe('10.0.xxx.xxx');
      expect(result[0].lastAccess).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    it('falls back to plain userAgent/ip fields and a generated id when no other source is present', async () => {
      const dbSessions = [
        {
          token: 'other-token',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
          ip: '172.16.0.5'
        }
      ];
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(dbSessions)
        })
      });
      const db = buildDb({ sessions });

      const result = await userSecurityService.getSessions(db, USER_ID, 'current-token');

      expect(result[0].id).toMatch(/^session_\d+$/);
      expect(result[0].os).toBe('Linux');
      expect(result[0].location).toBe('172.16.xxx.xxx');
      expect(result[0].lastAccess).toBeInstanceOf(Date);
    });

    it('falls back to requestInfo for userAgent/ip when the session carries neither', async () => {
      const dbSessions = [{ token: 'other-token' }];
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(dbSessions)
        })
      });
      const db = buildDb({ sessions });

      const result = await userSecurityService.getSessions(
        db,
        USER_ID,
        'current-token',
        { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ip: '8.8.8.8' }
      );

      expect(result[0].os).toBe('Windows 10/11');
      expect(result[0].location).toBe('8.8.xxx.xxx');
    });

    it('reads from the in-memory session cache when there are no db sessions', async () => {
      const sessions = buildCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([])
        })
      });
      const db = buildDb({ sessions });
      sessionService.sessions.clear();
      sessionService.sessions.set('cached-1', {
        userID: USER_ID,
        isActive: true,
        token: 'current-token',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'
      });

      const result = await userSecurityService.getSessions(db, USER_ID, 'current-token');

      expect(result).toHaveLength(1);
      expect(result[0].isCurrent).toBe(true);
      expect(result[0].os).toBe('Linux');
    });
  });
});
