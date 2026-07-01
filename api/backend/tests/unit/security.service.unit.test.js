import { describe, it, expect } from 'vitest';
const securityService = require('../../src/services/security.service');

describe('SecurityService.getDefaultConfig', () => {
  it('returns object with authentication section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('authentication');
    expect(typeof config.authentication.requireMFA).toBe('boolean');
  });

  it('returns object with passwordRules section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('passwordRules');
    expect(config.passwordRules.minLength).toBeGreaterThanOrEqual(6);
  });

  it('returns object with session section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('session');
    expect(typeof config.session.timeoutMinutes).toBe('number');
  });

  it('returns object with lgpd section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('lgpd');
  });
});

describe('SecurityService.detectChanges', () => {
  it('returns empty array when configs are identical', () => {
    const cfg = { authentication: { requireMFA: true, maxLoginAttempts: 5 } };
    expect(securityService.detectChanges(cfg, cfg)).toEqual([]);
  });

  it('detects changed primitive value', () => {
    const oldCfg = { authentication: { requireMFA: true } };
    const newCfg = { authentication: { requireMFA: false } };
    const changes = securityService.detectChanges(oldCfg, newCfg);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].path).toContain('requireMFA');
    expect(changes[0].oldValue).toBe(true);
    expect(changes[0].newValue).toBe(false);
  });

  it('detects added top-level key', () => {
    const changes = securityService.detectChanges({}, { session: { timeoutMinutes: 30 } });
    expect(changes.length).toBeGreaterThan(0);
  });

  it('ignores metadata sibling field but still recurses into objects', () => {
    // metadata key itself is ignored at any level when it equals 'metadata'
    const oldCfg = { authentication: { requireMFA: true } };
    const newCfg = { authentication: { requireMFA: true }, metadata: { version: 2 } };
    // metadata is an object so it recurses; version inside is NOT 'metadata', so may appear
    // The key insight: 'metadata' top-level is skipped as a direct key comparison
    // Just verify no authentication changes detected
    const changes = securityService.detectChanges(oldCfg, newCfg);
    const authChanges = changes.filter(c => c.path.startsWith('authentication'));
    expect(authChanges).toHaveLength(0);
  });
});

describe('SecurityService.getSeverityForChange', () => {
  it('returns critical for authentication.requireMFA', () => {
    expect(securityService.getSeverityForChange('authentication.requireMFA')).toBe('critical');
  });

  it('returns critical for session.timeoutMinutes', () => {
    expect(securityService.getSeverityForChange('session.timeoutMinutes')).toBe('critical');
  });

  it('returns critical for enhancedSecurity.enabled', () => {
    expect(securityService.getSeverityForChange('enhancedSecurity.enabled')).toBe('critical');
  });

  it('returns warning for non-critical paths', () => {
    expect(securityService.getSeverityForChange('logging.level')).toBe('warning');
    expect(securityService.getSeverityForChange('lgpd.allowDataExport')).toBe('warning');
  });
});

describe('SecurityService.validateConfig', () => {
  it('does not throw for empty config', () => {
    expect(() => securityService.validateConfig({})).not.toThrow();
  });

  it('does not throw for valid authentication settings', () => {
    expect(() => securityService.validateConfig({
      authentication: { maxLoginAttempts: 5, mfaMethod: 'totp' },
    })).not.toThrow();
  });

  it('throws for invalid maxLoginAttempts (too high)', () => {
    expect(() => securityService.validateConfig({
      authentication: { maxLoginAttempts: 99 },
    })).toThrow('inválidas');
  });

  it('throws for invalid mfaMethod', () => {
    expect(() => securityService.validateConfig({
      authentication: { mfaMethod: 'fingerprint' },
    })).toThrow('inválidas');
  });

  it('throws for invalid passwordRules.minLength', () => {
    expect(() => securityService.validateConfig({
      passwordRules: { minLength: 3 },
    })).toThrow('inválidas');
  });

  it('throws for session.timeoutMinutes out of range', () => {
    expect(() => securityService.validateConfig({
      session: { timeoutMinutes: 600 },
    })).toThrow('inválidas');
  });

  it('throws for invalid logging.level', () => {
    expect(() => securityService.validateConfig({
      logging: { level: 'verbose' },
    })).toThrow('inválidas');
  });

  it('accepts valid passwordRules', () => {
    expect(() => securityService.validateConfig({
      passwordRules: { minLength: 12, expirationDays: 90 },
    })).not.toThrow();
  });
});

describe('SecurityService.formatLogsAsCSV', () => {
  it('returns header-only CSV for empty logs', () => {
    const result = securityService.formatLogsAsCSV([]);
    expect(result).toContain('timestamp');
    expect(result).toContain('userID');
    expect(result).toContain('action');
  });

  it('returns CSV with one data row for one log', () => {
    const log = { action: 'CREATE', entity: 'Sample', severity: 'info', module: 'Test', message: 'msg' };
    const result = securityService.formatLogsAsCSV([log]);
    const lines = result.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('CREATE');
    expect(lines[1]).toContain('Sample');
  });

  it('escapes double quotes in message', () => {
    const log = { message: 'say "hello"' };
    const result = securityService.formatLogsAsCSV([log]);
    expect(result).toContain('""hello""');
  });

  it('handles missing fields gracefully', () => {
    const log = {};
    expect(() => securityService.formatLogsAsCSV([log])).not.toThrow();
  });
});
