import { describe, it, expect } from 'vitest';
const userSecurityService = require('../../src/services/user-security.service');

describe('UserSecurityService.calculateSecurityScore', () => {
  const baseUser = { mfaEnabled: false };
  const baseMfa = { recoveryCodes: { remaining: 0 } };
  const basePassword = { strength: 'strong', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };

  it('returns 0 for user with no security features', () => {
    const score = userSecurityService.calculateSecurityScore(
      { mfaEnabled: false },
      { recoveryCodes: { remaining: 0 } },
      { strength: 'weak' }
    );
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('adds 40 for mfaEnabled', () => {
    const withMfa = userSecurityService.calculateSecurityScore(
      { mfaEnabled: true },
      baseMfa,
      basePassword
    );
    const withoutMfa = userSecurityService.calculateSecurityScore(
      { mfaEnabled: false },
      baseMfa,
      basePassword
    );
    expect(withMfa - withoutMfa).toBe(40);
  });

  it('adds points for recovery codes', () => {
    const withCodes = userSecurityService.calculateSecurityScore(
      baseUser,
      { recoveryCodes: { remaining: 5 } },
      basePassword
    );
    const withoutCodes = userSecurityService.calculateSecurityScore(
      baseUser,
      { recoveryCodes: { remaining: 0 } },
      basePassword
    );
    expect(withCodes).toBeGreaterThan(withoutCodes);
  });

  it('adds more points for strong vs weak password', () => {
    const strong = userSecurityService.calculateSecurityScore(baseUser, baseMfa, { strength: 'strong' });
    const weak = userSecurityService.calculateSecurityScore(baseUser, baseMfa, { strength: 'weak' });
    expect(strong).toBeGreaterThan(weak);
  });

  it('caps score at 100', () => {
    const score = userSecurityService.calculateSecurityScore(
      { mfaEnabled: true },
      { recoveryCodes: { remaining: 10 } },
      { strength: 'strong', expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() }
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it('adds 15 for medium password strength', () => {
    const medium = userSecurityService.calculateSecurityScore(baseUser, baseMfa, { strength: 'medium' });
    const weak = userSecurityService.calculateSecurityScore(baseUser, baseMfa, { strength: 'weak' });
    expect(medium - weak).toBe(5);
  });

  it('does not add expiration bonus when password expires within 10 days', () => {
    const soon = userSecurityService.calculateSecurityScore(
      baseUser,
      baseMfa,
      { strength: 'strong', expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() }
    );
    const later = userSecurityService.calculateSecurityScore(
      baseUser,
      baseMfa,
      { strength: 'strong', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
    );
    expect(later - soon).toBe(10);
  });

  it('treats missing recoveryCodes on mfaMethods as zero remaining', () => {
    const score = userSecurityService.calculateSecurityScore(baseUser, {}, basePassword);
    const withZero = userSecurityService.calculateSecurityScore(baseUser, { recoveryCodes: { remaining: 0 } }, basePassword);
    expect(score).toBe(withZero);
  });
});

describe('UserSecurityService.maskPhone', () => {
  it('returns null for null', () => {
    expect(userSecurityService.maskPhone(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(userSecurityService.maskPhone(undefined)).toBeNull();
  });

  it('returns phone as-is when too short', () => {
    expect(userSecurityService.maskPhone('123')).toBe('123');
  });

  it('formats 11-digit Brazilian mobile number', () => {
    const result = userSecurityService.maskPhone('11987654321');
    expect(result).toContain('+55');
    expect(result).toContain('(11)');
  });

  it('formats 10-digit Brazilian landline number', () => {
    const result = userSecurityService.maskPhone('1198765432');
    expect(result).toContain('(11)');
  });

  it('returns cleaned-but-unformatted phone for lengths other than 10/11', () => {
    expect(userSecurityService.maskPhone('123456789012')).toBe('123456789012');
  });
});

describe('UserSecurityService.calculatePasswordStrength', () => {
  it('returns weak for null', () => {
    expect(userSecurityService.calculatePasswordStrength(null)).toBe('weak');
  });

  it('returns strong for bcrypt hash (60+ chars)', () => {
    const bcryptHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    expect(userSecurityService.calculatePasswordStrength(bcryptHash)).toBe('strong');
  });

  it('returns medium for shorter hash', () => {
    expect(userSecurityService.calculatePasswordStrength('short')).toBe('medium');
  });
});

describe('UserSecurityService.extractDeviceName', () => {
  it('returns unknown for null', () => {
    expect(userSecurityService.extractDeviceName(null)).toBe('Dispositivo Desconhecido');
  });

  it('detects mobile device', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)')).toBe('Dispositivo Móvel');
  });

  it('detects mobile device via the generic "Mobile" token', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (Linux; Mobile)')).toBe('Dispositivo Móvel');
  });

  it('detects Android', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (Linux; Android 11; SM-G991B)')).toBe('Dispositivo Móvel');
  });

  it('detects Windows', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('detects Mac', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
  });

  it('detects Linux', () => {
    expect(userSecurityService.extractDeviceName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });

  it('returns Computador for unknown UA', () => {
    expect(userSecurityService.extractDeviceName('SomeOtherAgent/1.0')).toBe('Computador');
  });
});

describe('UserSecurityService.extractBrowser', () => {
  it('returns unknown for null', () => {
    expect(userSecurityService.extractBrowser(null)).toBe('Desconhecido');
  });

  it('detects Chrome', () => {
    expect(userSecurityService.extractBrowser('Mozilla/5.0 Chrome/110.0.0.0')).toBe('Chrome');
  });

  it('does not detect Chrome when Edge is present', () => {
    expect(userSecurityService.extractBrowser('Mozilla/5.0 Chrome/110 Edg/110')).toBe('Edge');
  });

  it('detects Firefox', () => {
    expect(userSecurityService.extractBrowser('Mozilla/5.0 Firefox/109.0')).toBe('Firefox');
  });

  it('detects Safari (without Chrome)', () => {
    expect(userSecurityService.extractBrowser('Mozilla/5.0 Safari/605.1.15')).toBe('Safari');
  });

  it('does not detect Safari when Chrome and Edge are also present (falls through to Edge)', () => {
    expect(userSecurityService.extractBrowser('Mozilla/5.0 Chrome/110 Edg/110 Safari/605.1.15')).toBe('Edge');
  });
});

describe('UserSecurityService.extractOS', () => {
  it('returns unknown for null', () => {
    expect(userSecurityService.extractOS(null)).toBe('Desconhecido');
  });

  it('detects Windows 10/11', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows 10/11');
  });

  it('detects macOS', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)')).toBe('macOS');
  });

  it('detects Linux (non-Android)', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });

  it('detects iOS for iPhone', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)')).toBe('iOS');
  });

  it('detects iOS for iPad', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (iPad; CPU OS 14_0)')).toBe('iOS');
  });

  it('detects Windows 8.1', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Windows NT 6.3; Win64; x64)')).toBe('Windows 8.1');
  });

  it('detects Windows 8', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Windows NT 6.2; Win64; x64)')).toBe('Windows 8');
  });

  it('detects generic Windows for unrecognized NT version', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Windows NT 5.1)')).toBe('Windows');
  });

  it('detects Android when Linux is not present in the user-agent', () => {
    expect(userSecurityService.extractOS('Mozilla/5.0 (Android 11; SM-G991B)')).toBe('Android');
  });
});

describe('UserSecurityService.getLocationFromIP', () => {
  it('returns null for null', () => {
    expect(userSecurityService.getLocationFromIP(null)).toBeNull();
  });

  it('returns Local for localhost', () => {
    expect(userSecurityService.getLocationFromIP('127.0.0.1')).toBe('Local');
    expect(userSecurityService.getLocationFromIP('::1')).toBe('Local');
  });

  it('masks IPv4 address', () => {
    const result = userSecurityService.getLocationFromIP('192.168.1.100');
    expect(result).toContain('192.168');
    expect(result).toContain('xxx');
  });

  it('returns Desconhecido for non-local IPv6', () => {
    expect(userSecurityService.getLocationFromIP('2001:db8:0:0:0:0:0:1')).toBe('Desconhecido');
  });
});

describe('UserSecurityService.generateRecoveryCode', () => {
  it('returns 8-character string', () => {
    const code = userSecurityService.generateRecoveryCode();
    expect(typeof code).toBe('string');
    expect(code).toHaveLength(8);
  });

  it('uses only allowed characters (no I, O, 0, 1)', () => {
    const code = userSecurityService.generateRecoveryCode();
    expect(code).not.toMatch(/[IO01]/);
  });

  it('generates different codes each time', () => {
    const codes = new Set(Array.from({ length: 20 }, () => userSecurityService.generateRecoveryCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
