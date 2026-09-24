import { describe, it, expect, afterEach } from 'vitest';
const { generateAnonId, maskUser, sanitizePayload, sanitizeMessage } = require('../../src/utils/userAnonymization');

describe('generateAnonId', () => {
  it('returns USR-SYSTEM when userID is null', () => {
    expect(generateAnonId(null)).toBe('USR-SYSTEM');
  });

  it('returns USR-SYSTEM when userID is undefined', () => {
    expect(generateAnonId(undefined)).toBe('USR-SYSTEM');
  });

  it('returns USR-SYSTEM when userID is empty string', () => {
    expect(generateAnonId('')).toBe('USR-SYSTEM');
  });

  it('returns string starting with USR-', () => {
    const result = generateAnonId('user-123');
    expect(result).toMatch(/^USR-[0-9A-F]{8}$/);
  });

  it('is deterministic for same input', () => {
    expect(generateAnonId('user-abc')).toBe(generateAnonId('user-abc'));
  });

  it('differs for different userIDs', () => {
    expect(generateAnonId('user-1')).not.toBe(generateAnonId('user-2'));
  });

  it('uses custom salt when provided', () => {
    const r1 = generateAnonId('user-1', 'salt-A');
    const r2 = generateAnonId('user-1', 'salt-B');
    expect(r1).not.toBe(r2);
  });

  it('accepts numeric userID (coerced to string)', () => {
    const result = generateAnonId(42);
    expect(result).toMatch(/^USR-[0-9A-F]{8}$/);
  });

  // #972: the fallback used to be the literal 'BioAdvanceD-LGPD-2024',
  // committed to this public repository. With a known salt, USR-XXXX stops
  // being a pseudonym -- sha256(userId + knownSalt) truncated to 8 hex chars
  // is computable for any candidate id, so the de-identification is
  // reversible by anyone holding the repo. Failing closed is the only safe
  // behaviour, and it matches neo4jCanonicalProjection.service.js:36, which
  // reads the same family of variables with no literal fallback.
  describe('#972: no hardcoded salt fallback', () => {
    const ORIGINAL = process.env.USER_ANON_SALT;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.USER_ANON_SALT;
      else process.env.USER_ANON_SALT = ORIGINAL;
    });

    it('throws when neither an explicit salt nor USER_ANON_SALT is configured', () => {
      delete process.env.USER_ANON_SALT;
      expect(() => generateAnonId('user-123')).toThrow(/USER_ANON_SALT/);
    });

    it('throws when USER_ANON_SALT is set but empty', () => {
      process.env.USER_ANON_SALT = '';
      expect(() => generateAnonId('user-123')).toThrow(/USER_ANON_SALT/);
    });

    it('still returns USR-SYSTEM for a falsy userID without needing a salt', () => {
      delete process.env.USER_ANON_SALT;
      expect(generateAnonId(null)).toBe('USR-SYSTEM');
    });

    it('an explicit salt argument satisfies it without the env var', () => {
      delete process.env.USER_ANON_SALT;
      expect(generateAnonId('user-123', 'explicit-salt')).toMatch(/^USR-[0-9A-F]{8}$/);
    });
  });
});

describe('maskUser', () => {
  it('returns USR-SYSTEM for null user', () => {
    expect(maskUser(null)).toBe('USR-SYSTEM');
  });

  it('returns existing anonId if present', () => {
    expect(maskUser({ anonId: 'USR-CUSTOM1' })).toBe('USR-CUSTOM1');
  });

  it('returns USR-SYSTEM when user has no id fields', () => {
    expect(maskUser({})).toBe('USR-SYSTEM');
  });

  it('generates anonId from canonical userAccountId', () => {
    const result = maskUser({ userAccountId: '11111111-1111-4111-8111-111111111111' });
    expect(result).toMatch(/^USR-[0-9A-F]{8}$/);
  });

  it('accepts a verified UUID userID claim', () => {
    const result = maskUser({ userID: '11111111-1111-4111-8111-111111111111' });
    expect(result).toMatch(/^USR-[0-9A-F]{8}$/);
  });
});

describe('sanitizePayload', () => {
  it('removes name field', () => {
    const result = sanitizePayload({ name: 'João', action: 'CREATE' });
    expect(result.name).toBeUndefined();
    expect(result.action).toBe('CREATE');
  });

  it('removes email field', () => {
    const result = sanitizePayload({ email: 'test@example.com', id: 1 });
    expect(result.email).toBeUndefined();
  });

  it('removes password and token fields', () => {
    const result = sanitizePayload({ password: 'secret', token: 'tok', id: 1 });
    expect(result.password).toBeUndefined();
    expect(result.token).toBeUndefined();
    expect(result.id).toBe(1);
  });

  it('removes cpf field', () => {
    const result = sanitizePayload({ cpf: '123.456.789-00', id: 1 });
    expect(result.cpf).toBeUndefined();
  });

  it('handles null/non-object input', () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload('string')).toBe('string');
    expect(sanitizePayload(42)).toBe(42);
  });

  it('sanitizes nested objects recursively', () => {
    const result = sanitizePayload({ data: { email: 'test@test.com', id: 1 } });
    expect(result.data.email).toBeUndefined();
    expect(result.data.id).toBe(1);
  });

  it('sanitizes objects inside arrays', () => {
    const result = sanitizePayload({ items: [{ name: 'João', id: 1 }, { id: 2 }] });
    expect(result.items[0].name).toBeUndefined();
    expect(result.items[0].id).toBe(1);
  });

  it('preserves non-sensitive fields', () => {
    const result = sanitizePayload({ action: 'UPDATE', entity: 'Sample', count: 5 });
    expect(result.action).toBe('UPDATE');
    expect(result.entity).toBe('Sample');
    expect(result.count).toBe(5);
  });

  // RF005/RNF007 (#363/#564): patientName/identityDocument are the
  // canonical ParticipantIdentity field names — 'name'/'document' predate
  // them and don't cover the fields by their actual names.
  it('removes patientName and identityDocument fields', () => {
    const result = sanitizePayload({ patientName: 'João', identityDocument: '11144477735', id: 1 });
    expect(result.patientName).toBeUndefined();
    expect(result.identityDocument).toBeUndefined();
    expect(result.id).toBe(1);
  });
});

describe('sanitizeMessage', () => {
  it('returns non-string input unchanged', () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage(42)).toBe(42);
  });

  it('replaces email addresses with [email]', () => {
    const result = sanitizeMessage('Contact user@example.com for details');
    expect(result).toContain('[email]');
    expect(result).not.toContain('user@example.com');
  });

  it('replaces CPF with [CPF]', () => {
    const result = sanitizeMessage('CPF: 123.456.789-00 is invalid');
    expect(result).toContain('[CPF]');
    expect(result).not.toContain('123.456.789-00');
  });

  it('sanitizes "usuário Name" pattern', () => {
    const result = sanitizeMessage('usuário João Silva fez login');
    expect(result).not.toContain('João Silva');
  });

  it('returns message unchanged when no sensitive data', () => {
    const msg = 'Sample SMP-001 created successfully';
    expect(sanitizeMessage(msg)).toBe(msg);
  });

  it('handles empty string', () => {
    expect(sanitizeMessage('')).toBe('');
  });
});
