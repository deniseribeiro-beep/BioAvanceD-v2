import { describe, it, expect, vi, afterEach } from 'vitest';

// #1331: a recovery code signs in at the MFA step of processLogin, once.
//
// The recovery_codes double below honours the filter it is handed and applies
// the update operators the service sends, so "spent once" is the double's
// state, not a call assertion. The same update's behaviour on a real mongod
// is pinned by the e2e spec (tests/e2e/mfa-recovery-code.spec.ts).

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const authService = require('../../src/services/auth.service');
const auditLogger = require('../../src/utils/auditLogger');
const { encryptValue } = require('../../src/utils/fieldEncryption');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-de-teste-1072';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'key-teste';

afterEach(() => { vi.restoreAllMocks(); });

const PASSWORD = 'pw-of-at-least-15';
const OWNER = { toString: () => 'user-1' };

function sameId(a, b) {
  return a !== undefined && b !== undefined && String(a) === String(b);
}

// An honest stand-in for the one recovery_codes document a user holds.
function recoveryCodesDouble(initial) {
  const state = { doc: initial ? { ...initial } : null };
  const matches = (filter) => {
    const doc = state.doc;
    if (!doc) return false;
    if (filter.$or) return filter.$or.some((branch) => matches(branch));
    return Object.entries(filter).every(([key, want]) => {
      if (key === '_id') return doc._id === want;
      if (key === 'userAccountId' || key === 'userID') return sameId(doc[key], want);
      if (want === null) return doc[key] === null || doc[key] === undefined;
      if (Array.isArray(doc[key])) return doc[key].includes(want);
      return doc[key] === want;
    });
  };
  return {
    state,
    findOne: vi.fn(async (filter) => (matches(filter) ? { ...state.doc } : null)),
    updateOne: vi.fn(async (filter, update) => {
      if (!matches(filter)) return { matchedCount: 0, modifiedCount: 0 };
      const doc = { ...state.doc };
      for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
      for (const k of Object.keys(update.$unset || {})) delete doc[k];
      for (const [k, v] of Object.entries(update.$pull || {})) doc[k] = (doc[k] || []).filter((x) => x !== v);
      for (const [k, v] of Object.entries(update.$push || {})) doc[k] = [...(doc[k] || []), v];
      for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
      state.doc = doc;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function makeDb(recoveryCodes) {
  const users = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-1' } }),
  };
  return {
    users,
    collection: vi.fn((name) => (name === 'recovery_codes' ? recoveryCodes : users)),
  };
}

async function enrolledUser(extra = {}) {
  return {
    _id: OWNER,
    email: 'user@test.com',
    username: 'user1',
    name: 'User One',
    password: await bcrypt.hash(PASSWORD, 4),
    status: 'active',
    lastLogin: new Date('2020-01-01'),
    mfaEnabled: true,
    mfaSecretCiphertext: encryptValue('SECRET'),
    mfaFailedAttempts: 0,
    ...extra,
  };
}

async function canonicalSet(codes, extra = {}) {
  const codeHashes = await Promise.all(codes.map((code) => bcrypt.hash(code, 4)));
  return {
    _id: 'set-1',
    recoveryCodeSetId: 'set-uuid',
    userAccountId: OWNER,
    codeHashes,
    remainingCount: codeHashes.length,
    usedCodeHashes: [],
    generatedAt: new Date('2026-10-01'),
    regeneratedAt: null,
    invalidatedAt: null,
    ...extra,
  };
}

function login(db, user, code, newPassword) {
  return authService.processLogin(db, user, PASSWORD, code, db.users, {}, newPassword);
}

describe('processLogin with a recovery code (#1331)', () => {
  it('signs in with an unspent code, spends it, and audits the use', async () => {
    const auditSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const totpSpy = vi.spyOn(speakeasy.totp, 'verify');
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345', 'WXYZ6789']));
    const db = makeDb(codes);

    const result = await login(db, await enrolledUser(), 'ABCD2345');

    expect(result.token).toBeTruthy();
    expect(totpSpy).not.toHaveBeenCalled();
    expect(codes.state.doc.codeHashes).toHaveLength(1);
    expect(codes.state.doc.usedCodeHashes).toHaveLength(1);
    expect(codes.state.doc.remainingCount).toBe(1);
    expect(await bcrypt.compare('ABCD2345', codes.state.doc.usedCodeHashes[0])).toBe(true);
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MFA',
      payload: expect.objectContaining({ operation: 'recovery_code_redeemed', remainingCount: 1 }),
    }));
  });

  it('refuses the same code a second time and counts it as a failed MFA attempt', async () => {
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345', 'WXYZ6789']));
    const db = makeDb(codes);
    await login(db, await enrolledUser(), 'ABCD2345');

    await expect(login(db, await enrolledUser(), 'ABCD2345')).rejects.toThrow('Código MFA inválido');
    expect(db.users.updateOne).toHaveBeenCalledWith({ _id: OWNER }, { $set: { mfaFailedAttempts: 1 } });
    expect(codes.state.doc.remainingCount).toBe(1);
  });

  it('accepts the code typed in lower case with a separator', async () => {
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
    const db = makeDb(codes);

    const result = await login(db, await enrolledUser(), 'abcd-2345');

    expect(result.token).toBeTruthy();
    expect(codes.state.doc.remainingCount).toBe(0);
  });

  it('counts an unknown recovery-shaped code like a wrong TOTP code, without asking TOTP', async () => {
    const totpSpy = vi.spyOn(speakeasy.totp, 'verify');
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
    const db = makeDb(codes);

    await expect(login(db, await enrolledUser({ mfaFailedAttempts: 2 }), 'ZZZZ9999')).rejects.toThrow('Código MFA inválido');
    expect(totpSpy).not.toHaveBeenCalled();
    expect(db.users.updateOne).toHaveBeenCalledWith({ _id: OWNER }, { $set: { mfaFailedAttempts: 3 } });
    expect(codes.updateOne).not.toHaveBeenCalled();
  });

  it('still sends a six-digit code to TOTP and never reads the recovery set', async () => {
    const totpSpy = vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
    const db = makeDb(codes);

    const result = await login(db, await enrolledUser(), '123456');

    expect(result.token).toBeTruthy();
    expect(totpSpy).toHaveBeenCalled();
    expect(codes.findOne).not.toHaveBeenCalled();
  });

  it('refuses a code another sign-in spent between the match and the spend', async () => {
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
    const realFindOne = codes.findOne.getMockImplementation();
    // The read sees the code unspent; the store has already moved on.
    codes.findOne.mockImplementation(async (filter) => {
      const snapshot = await realFindOne(filter);
      codes.state.doc = { ...codes.state.doc, codeHashes: [], remainingCount: 0 };
      return snapshot;
    });
    const db = makeDb(codes);

    await expect(login(db, await enrolledUser(), 'ABCD2345')).rejects.toThrow('Código MFA inválido');
    expect(db.users.updateOne).toHaveBeenCalledWith({ _id: OWNER }, { $inc: { mfaFailedAttempts: 1 } });
  });

  it('redeems nothing from an invalidated set', async () => {
    const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345'], { invalidatedAt: new Date() }));
    const db = makeDb(codes);

    await expect(login(db, await enrolledUser(), 'ABCD2345')).rejects.toThrow('Código MFA inválido');
    expect(codes.updateOne).not.toHaveBeenCalled();
  });

  it('spends a legacy set\'s code and converts the document to the canonical names', async () => {
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const legacy = {
      _id: 'set-1',
      userID: OWNER,
      codes: await Promise.all(['ABCD2345', 'WXYZ6789'].map((c) => bcrypt.hash(c, 4))),
      remaining: 2,
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-01'),
    };
    const codes = recoveryCodesDouble(legacy);
    const db = makeDb(codes);

    const result = await login(db, await enrolledUser(), 'WXYZ6789');

    expect(result.token).toBeTruthy();
    const doc = codes.state.doc;
    expect(doc.codes).toBeUndefined();
    expect(doc.userID).toBeUndefined();
    expect(doc.remaining).toBeUndefined();
    expect(sameId(doc.userAccountId, OWNER)).toBe(true);
    expect(doc.recoveryCodeSetId).toEqual(expect.any(String));
    expect(doc.codeHashes).toEqual([legacy.codes[0]]);
    expect(doc.usedCodeHashes).toEqual([legacy.codes[1]]);
    expect(doc.remainingCount).toBe(1);
  });

  describe('with a password change due (#1252: the code rides along with it)', () => {
    it('does not spend the code on the answer that asks for a new password', async () => {
      const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
      const db = makeDb(codes);

      const result = await login(db, await enrolledUser({ forceReset: true }), 'ABCD2345');

      expect(result.requiresPasswordChange).toBe(true);
      expect(codes.updateOne).not.toHaveBeenCalled();
    });

    it('does not spend it when the new password fails the policy', async () => {
      const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
      const db = makeDb(codes);

      await expect(login(db, await enrolledUser({ forceReset: true }), 'ABCD2345', 'weak')).rejects.toThrow();
      expect(codes.updateOne).not.toHaveBeenCalled();
    });

    it('spends it on the submission that changes the password and signs in', async () => {
      vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const codes = recoveryCodesDouble(await canonicalSet(['ABCD2345']));
      const db = makeDb(codes);

      const result = await login(db, await enrolledUser({ forceReset: true }), 'ABCD2345', 'NewStrongPass1!');

      expect(result.token).toBeTruthy();
      expect(codes.state.doc.remainingCount).toBe(0);
    });
  });
});
