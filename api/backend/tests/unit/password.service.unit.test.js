import { describe, it, expect } from 'vitest';
const bcrypt = require('bcryptjs');
const { validateStrength, validateReuse, isPasswordExpired } = require('../../src/services/password.service');

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

  it('limits check to 3 history entries', async () => {
    const hashes = await Promise.all([
      bcrypt.hash('Pass1!Aa', 10),
      bcrypt.hash('Pass2!Aa', 10),
      bcrypt.hash('Pass3!Aa', 10),
      bcrypt.hash('Pass4!Aa', 10),
    ]);
    const user = { passwordHistory: hashes };
    // Pass4 is 4th entry (index 3), should NOT be checked
    await expect(validateReuse('Pass4!Aa', user)).resolves.toBeUndefined();
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
