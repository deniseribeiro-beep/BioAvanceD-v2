import { describe, it, expect, vi } from 'vitest';
const bcrypt = require('bcryptjs');
const {
  validateStrength, validateReuse, isPasswordExpired, nextPasswordHistory, resolvePasswordPolicy, isPasswordResetAllowed,
  DEFAULT_REUSE_POLICY, DEFAULT_PASSWORD_POLICY, publicStrengthRules, belowSingleFactorFloor,
} = require('../../src/services/password.service');

// #1257: the four composition flags default off now, so the tests of those
// flags pass a policy that turns them on.
const STRICT = {
  ...DEFAULT_PASSWORD_POLICY, minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
};
// #1257: how a stored security_config document with no passwordRules keys
// reads: the values in force before the defaults moved.
const STORED_FALLBACK = {
  minLength: 8, minLengthWithMFA: 8,
  requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
  preventReuse: true, maxReuseHistory: 5, expirationDays: 90, allowPasswordReset: true,
};
const MFA_ACCOUNT = { mfaEnabled: true, mfaSecretCiphertext: 'ciphertext' };

describe('validateStrength', () => {
  it('throws when password is null', () => {
    expect(() => validateStrength(null)).toThrow('obrigatória');
  });

  it('throws when password is not a string', () => {
    expect(() => validateStrength(12345678)).toThrow('obrigatória');
  });

  it('throws when password is too short', () => {
    expect(() => validateStrength('Aa1!')).toThrow();
  });

  it('throws when password has no uppercase letter', () => {
    expect(() => validateStrength('password1!', STRICT)).toThrow();
  });

  it('throws when password has no lowercase letter', () => {
    expect(() => validateStrength('PASSWORD1!', STRICT)).toThrow();
  });

  it('throws when password has no digit', () => {
    expect(() => validateStrength('Password!', STRICT)).toThrow();
  });

  it('throws when password has no special character', () => {
    expect(() => validateStrength('Password1', STRICT)).toThrow();
  });

  it('does not throw for strong password', () => {
    expect(() => validateStrength('SecurePass123!', STRICT)).not.toThrow();
  });

  it('does not throw for minimum-length strong password', () => {
    expect(() => validateStrength('Secure1!', STRICT)).not.toThrow();
  });

  // NIST SP 800-63B-4 §3.1.1.2: each Unicode code point is one character.
  // An emoji is two UTF-16 code units, so 8 of them must not meet a floor of 15.
  it('counts code points, not UTF-16 code units, toward minLength', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 15 };
    expect(() => validateStrength('😀'.repeat(8), policy)).toThrow('15');
    expect(() => validateStrength('😀'.repeat(15), policy)).not.toThrow();
  });

  it('belowSingleFactorFloor counts code points too', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 15 };
    expect(belowSingleFactorFloor('😀'.repeat(8), policy, null)).toBe(true);
    expect(belowSingleFactorFloor('😀'.repeat(15), policy, null)).toBe(false);
  });

  // #1246: the rules come from passwordRules (dict-02 P1X-0284..0288).
  it('#1246: a policy minLength of 12 refuses an 11-character password and names 12', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 12 };
    expect(() => validateStrength('Secure1!abc', policy)).toThrow('pelo menos 12 caracteres');
    expect(() => validateStrength('Secure1!abcd', policy)).not.toThrow();
  });

  it('#1246: a class the policy turns off is not required', () => {
    const policy = { ...STRICT, requireNumbers: false, requireSpecialChars: false };
    expect(() => validateStrength('Password', policy)).not.toThrow();
    expect(() => validateStrength('password', policy)).toThrow('letra maiúscula e letra minúscula');
  });

  it('#1246: a policy with every class on names them all', () => {
    expect(() => validateStrength('short', STRICT)).toThrow(
      'Senha deve ter pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo'
    );
  });

  it('#1257: an out-of-range policy minLength falls back to the default 15', () => {
    expect(() => validateStrength('fifteen chars!!', { ...DEFAULT_PASSWORD_POLICY, minLength: 2 })).not.toThrow();
    expect(() => validateStrength('fourteen chars', { ...DEFAULT_PASSWORD_POLICY, minLength: 2 })).toThrow('pelo menos 15 caracteres');
  });

  // #1257: NIST SP 800-63B-4 §3.1.1.2.
  it('#1257: the default takes a 15-character password with no composition rule, and refuses 14', () => {
    expect(() => validateStrength('correcthorsebat')).not.toThrow();
    expect(() => validateStrength('correcthorseba')).toThrow('Senha deve ter pelo menos 15 caracteres');
  });

  it('#1257: an account enrolled in MFA takes minLengthWithMFA, 8 by default', () => {
    expect(() => validateStrength('eightchr', DEFAULT_PASSWORD_POLICY, MFA_ACCOUNT)).not.toThrow();
    expect(() => validateStrength('sevench', DEFAULT_PASSWORD_POLICY, MFA_ACCOUNT)).toThrow('pelo menos 8 caracteres');
  });

  it('#1257: MFA switched on with no secret is not enrolled, so the single-factor floor applies', () => {
    expect(() => validateStrength('eightchr', DEFAULT_PASSWORD_POLICY, { mfaEnabled: true, mfaSecretCiphertext: null }))
      .toThrow('pelo menos 15 caracteres');
    expect(() => validateStrength('eightchr', DEFAULT_PASSWORD_POLICY, { mfaEnabled: false, mfaSecretCiphertext: 'x' }))
      .toThrow('pelo menos 15 caracteres');
  });

  it('#1257: minLengthWithMFA never exceeds minLength', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 10, minLengthWithMFA: 20 };
    expect(() => validateStrength('tenchars!!', policy, MFA_ACCOUNT)).not.toThrow();
  });
});

describe('validateReuse', () => {
  it('does not throw when user has no password history', async () => {
    await expect(validateReuse('NewPass1!', {})).resolves.toBeUndefined();
  });

  it('does not throw when new password not in history', async () => {
    const hash = await bcrypt.hash('OldPass1!', 10);
    const user = { password: hash };
    await expect(validateReuse('NewPass2!', user)).resolves.toBeUndefined();
  });

  it('throws when new password matches current password', async () => {
    const hash = await bcrypt.hash('CurrentPass1!', 10);
    const user = { password: hash };
    await expect(validateReuse('CurrentPass1!', user)).rejects.toThrow('utilizada recentemente');
  });

  it('throws when new password matches a history entry', async () => {
    const oldHash = await bcrypt.hash('OldPass1!', 10);
    const user = { passwordHistory: [oldHash] };
    await expect(validateReuse('OldPass1!', user)).rejects.toThrow('utilizada recentemente');
  });

  // #1244: the depth is passwordRules.maxReuseHistory (dict-02 P1X-0291), not 3.
  async function historyOf(count) {
    return Promise.all(Array.from({ length: count }, (_, i) => bcrypt.hash(`Pass${i + 1}!Aa`, 4)));
  }

  it('#1244: checks the default depth of 5 history entries when no policy is passed', async () => {
    const user = { passwordHistory: await historyOf(6) };
    await expect(validateReuse('Pass5!Aa', user)).rejects.toThrow('utilizada recentemente');
    await expect(validateReuse('Pass6!Aa', user)).resolves.toBeUndefined();
  });

  it('#1244: checks exactly maxReuseHistory entries', async () => {
    const user = { passwordHistory: await historyOf(3) };
    const policy = { preventReuse: true, maxReuseHistory: 2 };
    await expect(validateReuse('Pass2!Aa', user, policy)).rejects.toThrow('utilizada recentemente');
    await expect(validateReuse('Pass3!Aa', user, policy)).resolves.toBeUndefined();
  });

  it('#1244: still refuses the current password at depth 1', async () => {
    const user = { password: await bcrypt.hash('Current1!', 4), passwordHistory: await historyOf(2) };
    const policy = { preventReuse: true, maxReuseHistory: 1 };
    await expect(validateReuse('Current1!', user, policy)).rejects.toThrow('utilizada recentemente');
    await expect(validateReuse('Pass2!Aa', user, policy)).resolves.toBeUndefined();
  });

  // #1253: preventReuse governs the history; the current password always
  // counts, or a forced or expired change could keep the same secret.
  it('#1244/#1253: preventReuse false skips the history but still refuses the current password', async () => {
    const user = { password: await bcrypt.hash('Current1!', 4), passwordHistory: await historyOf(1) };
    const policy = { preventReuse: false, maxReuseHistory: 5 };
    await expect(validateReuse('Current1!', user, policy)).rejects.toThrow('utilizada recentemente');
    await expect(validateReuse('Pass1!Aa', user, policy)).resolves.toBeUndefined();
  });

  it('#1244: an out-of-range depth falls back to the default 5', async () => {
    const user = { passwordHistory: await historyOf(6) };
    await expect(validateReuse('Pass5!Aa', user, { preventReuse: true, maxReuseHistory: 0 })).rejects.toThrow();
    await expect(validateReuse('Pass5!Aa', user, { preventReuse: true, maxReuseHistory: 'x' })).rejects.toThrow();
    await expect(validateReuse('Pass6!Aa', user, { preventReuse: true, maxReuseHistory: 99 })).resolves.toBeUndefined();
  });
});

describe('#1244 nextPasswordHistory', () => {
  it('prepends the current hash and keeps the policy depth', () => {
    const user = { password: 'cur', passwordHistory: ['h1', 'h2', 'h3'] };
    expect(nextPasswordHistory(user, { preventReuse: true, maxReuseHistory: 2 })).toEqual(['cur', 'h1']);
    expect(nextPasswordHistory(user, { preventReuse: true, maxReuseHistory: 5 })).toEqual(['cur', 'h1', 'h2', 'h3']);
  });

  it('keeps the depth while preventReuse is off, so re-enabling finds a history', () => {
    const user = { password: 'cur', passwordHistory: ['h1'] };
    expect(nextPasswordHistory(user, { preventReuse: false, maxReuseHistory: 5 })).toEqual(['cur', 'h1']);
  });

  it('defaults to depth 5 and tolerates a user with no password or history', () => {
    const user = { password: 'cur', passwordHistory: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] };
    expect(nextPasswordHistory(user)).toEqual(['cur', 'h1', 'h2', 'h3', 'h4']);
    expect(nextPasswordHistory({})).toEqual([]);
  });
});

describe('#1244/#1246 resolvePasswordPolicy', () => {
  function dbWith(findOne) {
    const collection = vi.fn(() => ({ findOne }));
    return { db: { collection }, collection };
  }

  it('reads passwordRules from security_config main', async () => {
    const findOne = vi.fn().mockResolvedValue({ passwordRules: { preventReuse: true, maxReuseHistory: 8 } });
    const { db, collection } = dbWith(findOne);
    await expect(resolvePasswordPolicy(db)).resolves.toEqual({ ...STORED_FALLBACK, preventReuse: true, maxReuseHistory: 8 });
    expect(collection).toHaveBeenCalledWith('security_config');
    expect(findOne).toHaveBeenCalledWith({ _id: 'main' });
  });

  it('only an explicit false relaxes preventReuse', async () => {
    const off = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: false } }));
    expect((await resolvePasswordPolicy(off.db)).preventReuse).toBe(false);
    const truthy = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: 0 } }));
    expect((await resolvePasswordPolicy(truthy.db)).preventReuse).toBe(true);
  });

  it('falls to the default when no config exists (a new deployment) or the read throws', async () => {
    const missing = dbWith(vi.fn().mockResolvedValue(null));
    await expect(resolvePasswordPolicy(missing.db)).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
    const broken = dbWith(vi.fn().mockRejectedValue(new Error('down')));
    await expect(resolvePasswordPolicy(broken.db)).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
    expect(DEFAULT_REUSE_POLICY).toEqual({ preventReuse: true, maxReuseHistory: 5 });
    // #1257: getDefaultConfig()'s values, after SP 800-63B-4.
    expect(DEFAULT_PASSWORD_POLICY).toMatchObject({
      minLength: 15, minLengthWithMFA: 8,
      requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false,
      expirationDays: 0,
    });
  });

  it('#1257: a stored document keeps reading as before, and minLengthWithMFA follows minLength until one is stored', async () => {
    const older = dbWith(vi.fn().mockResolvedValue({ passwordRules: { minLength: 10 } }));
    await expect(resolvePasswordPolicy(older.db)).resolves.toMatchObject({ minLength: 10, minLengthWithMFA: 10, expirationDays: 90 });
    const stored = dbWith(vi.fn().mockResolvedValue({ passwordRules: { minLength: 15, minLengthWithMFA: 9 } }));
    await expect(resolvePasswordPolicy(stored.db)).resolves.toMatchObject({ minLength: 15, minLengthWithMFA: 9 });
    const above = dbWith(vi.fn().mockResolvedValue({ passwordRules: { minLength: 12, minLengthWithMFA: 20 } }));
    expect((await resolvePasswordPolicy(above.db)).minLengthWithMFA).toBe(12);
  });

  it('#1246: reads the strength keys, and an out-of-range minLength falls back to 8', async () => {
    const custom = dbWith(vi.fn().mockResolvedValue({
      passwordRules: { minLength: 12, requireUppercase: false, requireLowercase: true, requireNumbers: false, requireSpecialChars: false },
    }));
    await expect(resolvePasswordPolicy(custom.db)).resolves.toMatchObject({
      minLength: 12, requireUppercase: false, requireLowercase: true, requireNumbers: false, requireSpecialChars: false,
    });
    // #1253: 6 and 7 are below NIST SP 800-63B's floor of 8.
    for (const minLength of [5, 6, 7, 129, 7.5, 'x']) {
      const bad = dbWith(vi.fn().mockResolvedValue({ passwordRules: { minLength } }));
      expect((await resolvePasswordPolicy(bad.db)).minLength).toBe(8);
    }
  });

  it('#1246: publicStrengthRules exposes the strength keys and never the reuse keys', () => {
    expect(publicStrengthRules(DEFAULT_PASSWORD_POLICY)).toEqual({
      minLength: 15, minLengthWithMFA: 8,
      requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false,
    });
  });
});

// #1251: expirationDays (dict-02 P1X-0289) anchored on passwordChangedAt
// (P1X-0204). An account that cannot be dated is NOT expired: the old reading
// (no date means expired) would force a change on every such account.
describe('#1249 authentication keys in resolvePasswordPolicy', () => {
  const dbWith = (config) => ({ collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(config) })) });

  it('requireStrongPassword false turns the four composition flags off and keeps minLength', async () => {
    const policy = await resolvePasswordPolicy(dbWith({ authentication: { requireStrongPassword: false }, passwordRules: { minLength: 10 } }));
    expect(policy).toMatchObject({ minLength: 10, requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false });
    expect(() => validateStrength('alllowercase', policy)).not.toThrow();
    expect(() => validateStrength('short', policy)).toThrow();
  });

  it('requireStrongPassword true leaves each passwordRules flag in charge', async () => {
    const policy = await resolvePasswordPolicy(dbWith({ authentication: { requireStrongPassword: true }, passwordRules: { requireNumbers: false } }));
    expect(policy).toMatchObject({ requireUppercase: true, requireNumbers: false });
  });

  it('allowPasswordReset follows the stored key, true unless explicitly false', async () => {
    expect((await resolvePasswordPolicy(dbWith({ authentication: { allowPasswordReset: false } }))).allowPasswordReset).toBe(false);
    expect((await resolvePasswordPolicy(dbWith({ authentication: { allowPasswordReset: 'no' } }))).allowPasswordReset).toBe(true);
    expect((await resolvePasswordPolicy(dbWith(null))).allowPasswordReset).toBe(true);
    expect(await isPasswordResetAllowed(dbWith({ authentication: { allowPasswordReset: false } }))).toBe(false);
  });
});

describe('#1247 enhancedSecurity.strictPasswordPolicy', () => {
  const dbWith = (config) => ({ collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(config) })) });
  const RELAXED = { authentication: { requireStrongPassword: false }, passwordRules: { requireNumbers: false } };

  it('holds every composition flag on while the mode is on', async () => {
    const policy = await resolvePasswordPolicy(dbWith({ ...RELAXED, enhancedSecurity: { enabled: true, strictPasswordPolicy: true } }));
    expect(policy).toMatchObject({ requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true });
  });

  it('changes nothing while the mode is off', async () => {
    const policy = await resolvePasswordPolicy(dbWith({ ...RELAXED, enhancedSecurity: { enabled: false, strictPasswordPolicy: true } }));
    expect(policy).toMatchObject({ requireUppercase: false, requireNumbers: false });
  });
});

describe('isPasswordExpired (#1251)', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('an account with no usable date is not expired', () => {
    expect(isPasswordExpired(null)).toBe(false);
    expect(isPasswordExpired({})).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: 'not-a-date' })).toBe(false);
  });

  // #1257: SP 800-63B-4 forbids periodic change, so the default is 0.
  it('#1257: with no policy the default 0 never expires', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(4000) })).toBe(false);
  });

  it('counts the days on passwordChangedAt', () => {
    const policy = { expirationDays: 90 };
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(10) }, policy)).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(91) }, policy)).toBe(true);
  });

  it('falls back to the pre-rename lastPasswordChange, then createdAt', () => {
    const policy = { expirationDays: 90 };
    expect(isPasswordExpired({ lastPasswordChange: daysAgo(91).toISOString() }, policy)).toBe(true);
    expect(isPasswordExpired({ createdAt: daysAgo(91) }, policy)).toBe(true);
    // passwordChangedAt wins over an older createdAt.
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(1), createdAt: daysAgo(400) }, policy)).toBe(false);
  });

  it('follows the policy expirationDays, and 0 means never', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(31) }, { expirationDays: 30 })).toBe(true);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(29) }, { expirationDays: 30 })).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(4000) }, { expirationDays: 0 })).toBe(false);
  });

  it('#1257: an out-of-range expirationDays falls back to the default 0', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(4000) }, { expirationDays: 400 })).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(4000) }, { expirationDays: -1 })).toBe(false);
  });

  it('#1257: a stored document with no expirationDays still reads 90', async () => {
    const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue({ passwordRules: {} }) })) };
    expect((await resolvePasswordPolicy(db)).expirationDays).toBe(90);
  });

  it('resolvePasswordPolicy reads expirationDays', async () => {
    const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue({ passwordRules: { expirationDays: 0 } }) })) };
    expect((await resolvePasswordPolicy(db)).expirationDays).toBe(0);
  });
});
