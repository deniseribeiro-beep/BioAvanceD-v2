import { describe, it, expect, vi } from 'vitest';
const bcrypt = require('bcryptjs');
const {
  validateStrength, validateReuse, isPasswordExpired, nextPasswordHistory, resolveReusePolicy, DEFAULT_REUSE_POLICY,
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

describe('#1244 resolveReusePolicy', () => {
  function dbWith(findOne) {
    const collection = vi.fn(() => ({ findOne }));
    return { db: { collection }, collection };
  }

  it('reads passwordRules from security_config main', async () => {
    const findOne = vi.fn().mockResolvedValue({ passwordRules: { preventReuse: true, maxReuseHistory: 8 } });
    const { db, collection } = dbWith(findOne);
    await expect(resolveReusePolicy(db)).resolves.toEqual({ preventReuse: true, maxReuseHistory: 8 });
    expect(collection).toHaveBeenCalledWith('security_config');
    expect(findOne).toHaveBeenCalledWith({ _id: 'main' });
  });

  it('only an explicit false relaxes preventReuse', async () => {
    const off = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: false } }));
    expect((await resolveReusePolicy(off.db)).preventReuse).toBe(false);
    const truthy = dbWith(vi.fn().mockResolvedValue({ passwordRules: { preventReuse: 0 } }));
    expect((await resolveReusePolicy(truthy.db)).preventReuse).toBe(true);
  });

  it('fails closed to the default when no config exists or the read throws', async () => {
    const missing = dbWith(vi.fn().mockResolvedValue(null));
    await expect(resolveReusePolicy(missing.db)).resolves.toEqual(DEFAULT_REUSE_POLICY);
    const broken = dbWith(vi.fn().mockRejectedValue(new Error('down')));
    await expect(resolveReusePolicy(broken.db)).resolves.toEqual(DEFAULT_REUSE_POLICY);
    expect(DEFAULT_REUSE_POLICY).toEqual({ preventReuse: true, maxReuseHistory: 5 });
  });
});

describe('isPasswordExpired', () => {
  it('returns true when user is null', () => {
    expect(isPasswordExpired(null)).toBe(true);
  });

  it('returns true when lastPasswordChange is missing', () => {
    expect(isPasswordExpired({})).toBe(true);
  });

  it('returns true when lastPasswordChange is invalid date', () => {
    expect(isPasswordExpired({ lastPasswordChange: 'not-a-date' })).toBe(true);
  });

  it('returns false when password was changed recently', () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    expect(isPasswordExpired({ lastPasswordChange: recentDate.toISOString() })).toBe(false);
  });

  it('returns true when password was changed 91 days ago', () => {
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000); // 91 days ago
    expect(isPasswordExpired({ lastPasswordChange: oldDate.toISOString() })).toBe(true);
  });
});
