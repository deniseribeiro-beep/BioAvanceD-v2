import { describe, it, expect } from 'vitest';

const { redact, redactString } = require('../../../src/utils/logRedaction');

// #1308: RNF007 C5, RNF020 C6 -- secrets and direct identifiers never reach
// a log line, whichever call site hands them to the logger.
describe('logRedaction', () => {
  describe('strings', () => {
    it.each([
      ['a JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc_DEF-123 used', 'token [REDACTED_JWT] used'],
      ['a Bearer credential', 'header Bearer abc.def-123', 'header Bearer [REDACTED]'],
      ['URI credentials', 'connect mongodb://root:s3cr3t@mongo:27017/db', 'connect mongodb://[REDACTED]@mongo:27017/db'],
      ['a password pair', 'login password=hunter2 ok', 'login password=[REDACTED] ok'],
      ['a senha pair', 'senha: "abc 123"', 'senha: [REDACTED]'],
      ['a formatted CPF', 'paciente 123.456.789-09 criado', 'paciente [REDACTED_CPF] criado'],
      ['an e-mail', 'enviado para maria.silva@example.org', 'enviado para [REDACTED_EMAIL]'],
    ])('masks %s', (_name, input, expected) => {
      expect(redactString(input)).toBe(expected);
    });

    it('leaves pseudonyms, ids and hashes alone', () => {
      const line = 'USR-0A1B2C3D read sample 65f1a2b3c4d5e6f708192a3b, hash 9f86d081884c7d659a2feaa0c55ad015';
      expect(redactString(line)).toBe(line);
    });
  });

  describe('objects', () => {
    it('replaces a sensitive field whole, at any depth', () => {
      const out = redact({
        user: { username: 'admin', password: 'p', email: 'a@b.co', cpf: '12345678909' },
        headers: { authorization: 'Bearer x', cookie: 'sid=1' },
        refreshToken: 'r',
        apiKey: 'k',
      });
      expect(out).toEqual({
        user: { username: 'admin', password: '[REDACTED]', email: '[REDACTED]', cpf: '[REDACTED]' },
        headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' },
        refreshToken: '[REDACTED]',
        apiKey: '[REDACTED]',
      });
    });

    it('masks shapes inside the values of other fields, and in arrays', () => {
      expect(redact({ note: 'from x@y.io', list: ['password=1', 2] })).toEqual({ note: 'from [REDACTED_EMAIL]', list: ['password=[REDACTED]', 2] });
    });

    it('keeps an empty or absent sensitive field as it is, so a log still shows it was missing', () => {
      expect(redact({ password: '', token: null })).toEqual({ password: '', token: null });
    });

    it('does not mutate its input, and survives a cycle', () => {
      const input = { password: 'p' };
      input.self = input;
      const out = redact(input);
      expect(input.password).toBe('p');
      expect(out).toEqual({ password: '[REDACTED]', self: '[Circular]' });
    });

    it('redacts an Error\'s message and stack and keeps its code', () => {
      const error = new Error('auth failed for maria@example.org');
      error.code = 'E_AUTH';
      const out = redact(error);
      expect(out).toBeInstanceOf(Error);
      expect(out.message).toBe('auth failed for [REDACTED_EMAIL]');
      expect(out.stack).not.toContain('maria@example.org');
      expect(out.code).toBe('E_AUTH');
    });
  });
});
