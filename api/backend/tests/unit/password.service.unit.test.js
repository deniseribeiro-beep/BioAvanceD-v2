import { describe, it, expect, vi } from 'vitest';
const bcrypt = require('bcryptjs');
const {
  validateStrength, validateReuse, isPasswordExpired, nextPasswordHistory, resolvePasswordPolicy, isPasswordResetAllowed,
  DEFAULT_REUSE_POLICY, DEFAULT_PASSWORD_POLICY, publicStrengthRules,
} = require('../../src/services/password.service');

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
    expect(() => validateStrength('password1!')).toThrow();
  });

  it('throws when password has no lowercase letter', () => {
    expect(() => validateStrength('PASSWORD1!')).toThrow();
  });

  it('throws when password has no digit', () => {
    expect(() => validateStrength('Password!')).toThrow();
  });

  it('throws when password has no special character', () => {
    expect(() => validateStrength('Password1')).toThrow();
  });

  it('does not throw for strong password', () => {
    expect(() => validateStrength('SecurePass123!')).not.toThrow();
  });

  it('does not throw for minimum-length strong password', () => {
    expect(() => validateStrength('Secure1!')).not.toThrow();
  });

  // #1246: the rules come from passwordRules (dict-02 P1X-0284..0288).
  it('#1246: a policy minLength of 12 refuses an 11-character password and names 12', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 12 };
    expect(() => validateStrength('Secure1!abc', policy)).toThrow('pelo menos 12 caracteres');
    expect(() => validateStrength('Secure1!abcd', policy)).not.toThrow();
  });

  it('#1246: a class the policy turns off is not required', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, requireNumbers: false, requireSpecialChars: false };
    expect(() => validateStrength('Password', policy)).not.toThrow();
    expect(() => validateStrength('password', policy)).toThrow('letra maiúscula e letra minúscula');
  });

  it('#1246: the default message is unchanged', () => {
    expect(() => validateStrength('short')).toThrow(
      'Senha deve ter pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo'
    );
  });

  it('#1246: an out-of-range policy minLength falls back to 8', () => {
    expect(() => validateStrength('Secure1!', { ...DEFAULT_PASSWORD_POLICY, minLength: 2 })).not.toThrow();
    expect(() => validateStrength('Secur1!', { ...DEFAULT_PASSWORD_POLICY, minLength: 2 })).toThrow();
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

  it('#1244: preventReuse false checks nothing, the current password included', async () => {
    const user = { password: await bcrypt.hash('Current1!', 4), passwordHistory: await historyOf(1) };
    const policy = { preventReuse: false, maxReuseHistory: 5 };
    await expect(validateReuse('Current1!', user, policy)).resolves.toBeUndefined();
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
    await expect(resolvePasswordPolicy(db)).resolves.toEqual({ ...DEFAULT_PASSWORD_POLICY, preventReuse: true, maxReuseHistory: 8 });
    expect(collection).toHaveBeenCalledWith('security_config');
    expect(findOne).toHaveBeenCalledWith({ _id: 'main' });
  });

  it('only an explicit false relaxes preventReuse', async () => {
    const off = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: false } }));
    expect((await resolvePasswordPolicy(off.db)).preventReuse).toBe(false);
    const truthy = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: 0 } }));
    expect((await resolvePasswordPolicy(truthy.db)).preventReuse).toBe(true);
  });

  it('fails closed to the default when no config exists or the read throws', async () => {
    const missing = dbWith(vi.fn().mockResolvedValue(null));
    await expect(resolvePasswordPolicy(missing.db)).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
    const broken = dbWith(vi.fn().mockRejectedValue(new Error('down')));
    await expect(resolvePasswordPolicy(broken.db)).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
    expect(DEFAULT_REUSE_POLICY).toEqual({ preventReuse: true, maxReuseHistory: 5 });
    // #1246: getDefaultConfig()'s strength values.
    expect(DEFAULT_PASSWORD_POLICY).toMatchObject({
      minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
    });
  });

  it('#1246: reads the strength keys, and an out-of-range minLength falls back to 8', async () => {
    const custom = dbWith(vi.fn().mockResolvedValue({
      passwordRules: { minLength: 12, requireUppercase: false, requireLowercase: true, requireNumbers: false, requireSpecialChars: false },
    }));
    await expect(resolvePasswordPolicy(custom.db)).resolves.toMatchObject({
      minLength: 12, requireUppercase: false, requireLowercase: true, requireNumbers: false, requireSpecialChars: false,
    });
    for (const minLength of [5, 129, 7.5, 'x']) {
      const bad = dbWith(vi.fn().mockResolvedValue({ passwordRules: { minLength } }));
      expect((await resolvePasswordPolicy(bad.db)).minLength).toBe(8);
    }
  });

  it('#1246: publicStrengthRules exposes the strength keys and never the reuse keys', () => {
    expect(publicStrengthRules(DEFAULT_PASSWORD_POLICY)).toEqual({
      minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
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

  it('defaults to 90 days on passwordChangedAt', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(10) })).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(91) })).toBe(true);
  });

  it('falls back to the pre-rename lastPasswordChange, then createdAt', () => {
    expect(isPasswordExpired({ lastPasswordChange: daysAgo(91).toISOString() })).toBe(true);
    expect(isPasswordExpired({ createdAt: daysAgo(91) })).toBe(true);
    // passwordChangedAt wins over an older createdAt.
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(1), createdAt: daysAgo(400) })).toBe(false);
  });

  it('follows the policy expirationDays, and 0 means never', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(31) }, { expirationDays: 30 })).toBe(true);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(29) }, { expirationDays: 30 })).toBe(false);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(4000) }, { expirationDays: 0 })).toBe(false);
  });

  it('an out-of-range expirationDays falls back to 90', () => {
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(91) }, { expirationDays: 400 })).toBe(true);
    expect(isPasswordExpired({ passwordChangedAt: daysAgo(89) }, { expirationDays: -1 })).toBe(false);
  });

  it('resolvePasswordPolicy reads expirationDays', async () => {
    const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue({ passwordRules: { expirationDays: 0 } }) })) };
    expect((await resolvePasswordPolicy(db)).expirationDays).toBe(0);
  });
});
