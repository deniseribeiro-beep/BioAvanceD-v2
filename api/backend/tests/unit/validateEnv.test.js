import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateRedisEnv,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
  validateEncryptionEnv,
  validateEncryptionAndHalt,
  validateKeyRotationEnv,
  validateAuditSigningEnv,
  validateAuditSigningAndWarn,
} = require('../../src/config/validateEnv');

const logger = require('../../src/utils/logger');

describe('validateEnv', () => {
  let envSnapshot;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  describe('validateRedisEnv', () => {
    it('returns no errors for a valid REDIS_URL happy path (local env)', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_PASSWORD;

      const { errors } = validateRedisEnv();

      expect(errors).toEqual([]);
    });

    it('errors when REDIS_URL is not a valid URL', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'not-a-valid-url';

      const { errors } = validateRedisEnv();

      expect(errors).toContain('REDIS_URL inválida');
    });

    it('errors when REDIS_HOST is missing and no REDIS_URL is set', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      process.env.REDIS_PORT = '6379';

      const { errors } = validateRedisEnv();

      expect(errors).toContain('REDIS_HOST não está definido no .env');
    });

    it('errors when REDIS_PORT is missing and no REDIS_URL is set', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      delete process.env.REDIS_PORT;

      const { errors } = validateRedisEnv();

      expect(errors).toContain('REDIS_PORT não está definido no .env');
    });

    it('errors when REDIS_PORT is out of the 1-65535 range', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '70000';

      const { errors } = validateRedisEnv();

      expect(errors).toContain('REDIS_PORT deve ser um número válido entre 1 e 65535');
    });

    it('errors when REDIS_PASSWORD is missing, host is remote, and NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'remote-redis.example.com';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_PASSWORD;

      const { errors } = validateRedisEnv();

      expect(errors).toContain('REDIS_PASSWORD não está definido no .env');
    });

    it('does not hard-error but warns REDIS_PASSWORD is missing against a non-local host when isLocalEnv (NODE_ENV=development) (issue #20)', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'remote-redis.example.com';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_PASSWORD;

      const { errors, warnings } = validateRedisEnv();

      expect(errors).not.toContain('REDIS_PASSWORD não está definido no .env');
      expect(warnings.some((w) => w.includes('REDIS_PASSWORD') && w.includes('remote-redis.example.com'))).toBe(true);
    });

    it('does not hard-error but warns REDIS_PASSWORD is missing against a non-local host when isLocalEnv (NODE_ENV=test) (issue #20)', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'remote-redis.example.com';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_PASSWORD;

      const { errors, warnings } = validateRedisEnv();

      expect(errors).not.toContain('REDIS_PASSWORD não está definido no .env');
      expect(warnings.some((w) => w.includes('REDIS_PASSWORD') && w.includes('remote-redis.example.com'))).toBe(true);
    });

    it('does not warn about REDIS_PASSWORD when isLocalEnv and host is a docker-network service name matching docker-compose.test.yml (REDIS_HOST=redis)', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'redis';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_PASSWORD;

      const { errors, warnings } = validateRedisEnv();

      expect(errors).not.toContain('REDIS_PASSWORD não está definido no .env');
      // 'redis' isn't isLocalHost either, so this documents that the warning still fires
      // for the docker-compose case — it's advisory only, so it doesn't break that startup.
      expect(warnings.some((w) => w.includes('REDIS_PASSWORD'))).toBe(true);
    });

    it('does not require REDIS_PASSWORD when isLocalHost even if NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_PASSWORD;

      const { errors } = validateRedisEnv();

      expect(errors).not.toContain('REDIS_PASSWORD não está definido no .env');
    });

    it('warns when no REDIS_URL is set and not in a local env', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';

      const { warnings } = validateRedisEnv();

      expect(warnings).toContain('REDIS_URL não está definido; usando host/porta separados');
    });

    it('does not warn about missing REDIS_URL when in a local env', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';

      const { warnings } = validateRedisEnv();

      expect(warnings).not.toContain('REDIS_URL não está definido; usando host/porta separados');
    });
  });

  describe('validateAllEnv', () => {
    it('merges Redis errors into its own errors list', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';

      const { errors, isValid } = validateAllEnv();

      expect(errors).toContain('REDIS_HOST não está definido no .env');
      expect(isValid).toBe(false);
    });

    it('adds a MONGO_URI warning when it is missing', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      delete process.env.MONGO_URI;

      const { warnings } = validateAllEnv();

      expect(warnings).toContain('MONGO_URI não está definido (algumas funcionalidades podem não funcionar)');
    });

    it('reports isValid=true when there are no errors', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';

      const { isValid, errors } = validateAllEnv();

      expect(errors).toEqual([]);
      expect(isValid).toBe(true);
    });

    // #1085: nothing validated ENCRYPTION_KEY and nothing warned when either
    // plaintext-storage opt-out was set, so a stack could be configured to
    // store everything in the clear and say nothing. Direction 3 (Dennis,
    // 2026-09-07): warn in every environment, fatal in production.
    it('#1085: warns when ENCRYPTION_KEY is absent, in a non-production environment', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      delete process.env.ENCRYPTION_KEY;
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

      const { warnings, errors, isValid } = validateAllEnv();

      expect(warnings.some((w) => /\[SECURITY\].*ENCRYPTION_KEY/.test(w))).toBe(true);
      expect(errors).toEqual([]);
      expect(isValid).toBe(true);
    });

    it('#1085: warns when ALLOW_UNENCRYPTED_FILE_STORAGE is exactly "true"', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

      const { warnings } = validateAllEnv();

      expect(warnings.some((w) => /\[SECURITY\].*ALLOW_UNENCRYPTED_FILE_STORAGE/.test(w))).toBe(true);
    });

    it('#1085: warns when ALLOW_UNENCRYPTED_FIELD_STORAGE is exactly "true"', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';

      const { warnings } = validateAllEnv();

      expect(warnings.some((w) => /\[SECURITY\].*ALLOW_UNENCRYPTED_FIELD_STORAGE/.test(w))).toBe(true);
    });

    it('#1085: promotes every insecure-storage condition to a fatal error in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.REDIS_PASSWORD = 'pass';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      delete process.env.ENCRYPTION_KEY;
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';

      const { errors, warnings, isValid } = validateAllEnv();

      expect(errors.some((e) => /\[SECURITY\].*ENCRYPTION_KEY/.test(e))).toBe(true);
      expect(errors.some((e) => /\[SECURITY\].*ALLOW_UNENCRYPTED_FILE_STORAGE/.test(e))).toBe(true);
      expect(errors.some((e) => /\[SECURITY\].*ALLOW_UNENCRYPTED_FIELD_STORAGE/.test(e))).toBe(true);
      expect(warnings.filter((w) => /\[SECURITY\]/.test(w))).toEqual([]);
      expect(isValid).toBe(false);
    });

    // Control case: same expectation before and after the fix, so a red here
    // is the fixture, not the bug (#695).
    it('#1085 control: says nothing about encryption when a key is set and neither opt-out is enabled', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

      const { warnings, errors, isValid } = validateAllEnv();

      expect(warnings.filter((w) => /\[SECURITY\]/.test(w))).toEqual([]);
      expect(errors).toEqual([]);
      expect(isValid).toBe(true);
    });

    // Control case: the opt-outs are deliberately exact-string checks, not
    // truthy ones, matching fileCrypto.js and fieldEncryption.js -- a stray
    // '1'/'yes' must not read as consent to plaintext storage.
    it('#1085 control: a non-"true" opt-out value is not treated as enabled', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = '1';
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'yes';

      const { warnings, errors } = validateAllEnv();

      expect(warnings.filter((w) => /\[SECURITY\]/.test(w))).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

  describe('validateAndHalt', () => {
    it('throws in production when there are errors', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      expect(() => validateAndHalt(true)).toThrow(
        /Variáveis de ambiente obrigatórias não configuradas/
      );
    });

    it('returns false without throwing in development with errors when allowDevelopment=true', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = validateAndHalt(true);

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns true when there are no errors and no warnings', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.REDIS_PASSWORD = 'pass';
      process.env.MONGO_URI = 'mongodb://localhost:27017/db';

      const result = validateAndHalt(true);

      expect(result).toBe(true);
    });

    it('logs warnings via logger.warn when there are no errors but warnings exist', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      delete process.env.MONGO_URI;
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = validateAndHalt(true);

      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // #1085: the boot-path entry point. validateAllEnv/validateAndHalt had NO
  // production caller at all, so "add a warning to validateEnv.js" would have
  // produced no observable output -- this is the callable server.js and
  // worker.js actually invoke, and it is deliberately NOT a caller of
  // validateAndHalt (that would newly make a bad Redis config fatal for the
  // backend in production, inverting #977's documented posture).
  describe('validateEncryptionEnv / validateEncryptionAndHalt (#1085)', () => {
    function clearEncryptionEnv() {
      delete process.env.ENCRYPTION_KEY;
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
    }

    it('reports nothing at all when a key is set and neither opt-out is enabled', () => {
      process.env.NODE_ENV = 'production';
      clearEncryptionEnv();
      process.env.ENCRYPTION_KEY = 'chave-de-teste';

      expect(validateEncryptionEnv()).toEqual({ errors: [], warnings: [] });
    });

    it('routes every finding to warnings outside production', () => {
      process.env.NODE_ENV = 'development';
      clearEncryptionEnv();
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';

      const { errors, warnings } = validateEncryptionEnv();

      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(3);
      expect(warnings.every((w) => w.startsWith('[SECURITY]'))).toBe(true);
    });

    it('routes the same findings to errors in production', () => {
      process.env.NODE_ENV = 'production';
      clearEncryptionEnv();
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';

      const { errors, warnings } = validateEncryptionEnv();

      expect(warnings).toEqual([]);
      expect(errors).toHaveLength(3);
      expect(errors.every((e) => e.startsWith('[SECURITY]'))).toBe(true);
    });

    it('treats an unset NODE_ENV as development, not production', () => {
      delete process.env.NODE_ENV;
      clearEncryptionEnv();

      const { errors, warnings } = validateEncryptionEnv();

      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
    });

    it('logs a loud [SECURITY] warning and returns true outside production', () => {
      process.env.NODE_ENV = 'development';
      clearEncryptionEnv();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(validateEncryptionAndHalt()).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SECURITY]'));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('throws in production when ENCRYPTION_KEY is blank, after logging it via logger.error', () => {
      process.env.NODE_ENV = 'production';
      clearEncryptionEnv();
      process.env.ENCRYPTION_KEY = '   ';
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(() => validateEncryptionAndHalt()).toThrow(
        /Configuração de criptografia inaceitável em produção/
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
    });

    it('throws in production when an opt-out is enabled even though a key IS configured', () => {
      process.env.NODE_ENV = 'production';
      clearEncryptionEnv();
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(() => validateEncryptionAndHalt()).toThrow(
        /ALLOW_UNENCRYPTED_FIELD_STORAGE/
      );
    });

    it('returns true in production once a key is set and both opt-outs are absent', () => {
      process.env.NODE_ENV = 'production';
      clearEncryptionEnv();
      process.env.ENCRYPTION_KEY = 'chave-de-teste';
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(validateEncryptionAndHalt()).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // #1086: keyRegistry silently DISCARDS a previous-key slot it cannot use
  // (no id of its own, or an id equal to the active one). Silence is the
  // defect there, so the boot gate announces it. Always a warning, never
  // fatal -- a broken slot is a data-availability problem, not a
  // confidentiality one, and refusing the boot would punish the operator
  // mid-rotation, who is exactly who the slot exists to help.
  describe('validateKeyRotationEnv (#1086)', () => {
    function clearRotationEnv() {
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;
      delete process.env.ENCRYPTION_KEY_ID;
    }

    it('says nothing when no previous slot is configured at all', () => {
      clearRotationEnv();

      expect(validateKeyRotationEnv()).toEqual([]);
    });

    it('says nothing about a correctly configured rotation', () => {
      clearRotationEnv();
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(validateKeyRotationEnv()).toEqual([]);
    });

    it('warns when the previous key has no id of its own', () => {
      clearRotationEnv();
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';

      const warnings = validateKeyRotationEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/ENCRYPTION_KEY_PREVIOUS_ID/);
    });

    it('warns about an orphan previous id with no key behind it', () => {
      clearRotationEnv();
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      const warnings = validateKeyRotationEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/id órfão/);
    });

    it('warns when the previous id collides with the active id', () => {
      clearRotationEnv();
      process.env.ENCRYPTION_KEY_ID = 'key-unica';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-unica';

      const warnings = validateKeyRotationEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/igual a ENCRYPTION_KEY_ID/);
    });

    it('compares against the "default" active id when ENCRYPTION_KEY_ID is unset', () => {
      clearRotationEnv();
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'default';

      expect(validateKeyRotationEnv()).toHaveLength(1);
    });

    it('stays a WARNING in production rather than becoming a fatal error', () => {
      clearRotationEnv();
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-unica';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-unica';
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

      const { errors, warnings } = validateEncryptionEnv();

      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/#1086/);
    });

    it('does not stop a production boot on its own', () => {
      clearRotationEnv();
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-unica';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-unica';
      delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(validateEncryptionAndHalt()).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('#1086'));
    });
  });

  describe('validateRedisOnly', () => {
    it('throws in production when there are Redis errors', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(() => validateRedisOnly(true, false)).toThrow(
        /Redis configurado incorretamente/
      );
    });

    it('returns false without throwing in development with errors when allowDevelopment=true', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = validateRedisOnly(true, false);

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns true when Redis config is clean', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://:pass@redis-host:6379';
      process.env.REDIS_PASSWORD = 'pass';

      const result = validateRedisOnly(true, false);

      expect(result).toBe(true);
    });

    it('suppresses logger.error and logger.warn calls when silent=true, in production with errors', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      expect(() => validateRedisOnly(true, true)).toThrow(
        /Redis configurado incorretamente/
      );
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('suppresses logger calls when silent=true, in development with errors, and still returns false', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = validateRedisOnly(true, true);

      expect(result).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('suppresses logger.warn for warnings-only case when silent=true', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = validateRedisOnly(true, true);

      expect(result).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // #1154: the boot check for the audit signing config. Direction 1 of the
  // three the issue listed -- ALWAYS a warning, never fatal, because #989
  // requires the nightly job not to reject and #979 owns the open
  // fatal-vs-degrade call. The coverage is direction 3's (a full sign/verify
  // round trip), because the failure that looks healthiest is the worst: a
  // readable private key whose id has no match in the registry signs fine and
  // makes processTimestampBacklog stamp every root FAILED.
  //
  // These mutate the `env` MODULE rather than process.env, unlike every other
  // block in this file: the validator asks audit-signing.provider, which reads
  // config/env, so that is the surface a test has to move. The provider's own
  // test file does the same.
  describe('validateAuditSigningEnv / validateAuditSigningAndWarn (#1154)', () => {
    const env = require('../../src/config/env');
    let tmpFiles = [];
    let auditSnapshot;

    beforeEach(() => {
      auditSnapshot = {
        key: env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE,
        id: env.AUDIT_MERKLE_SIGN_KEY_ID,
        json: env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON,
        file: env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE,
      };
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '';
      env.AUDIT_MERKLE_SIGN_KEY_ID = '';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = '';
    });

    afterEach(() => {
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = auditSnapshot.key;
      env.AUDIT_MERKLE_SIGN_KEY_ID = auditSnapshot.id;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = auditSnapshot.json;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = auditSnapshot.file;
      tmpFiles.forEach((f) => fs.rmSync(f, { force: true }));
      tmpFiles = [];
    });

    function writeTmp(name, contents) {
      const p = path.join(os.tmpdir(), 'validate-audit-' + name + '-' + Date.now() + '-' + Math.random());
      fs.writeFileSync(p, contents, 'utf8');
      tmpFiles.push(p);
      return p;
    }

    function configureWorkingKey() {
      const pair = crypto.generateKeyPairSync('ed25519');
      const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = writeTmp('key', privatePem);
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-boot-1';
      return { privatePem, publicPem };
    }

    it('warns when AUDIT_MERKLE_SIGN_KEY_ID is unset', async () => {
      const warnings = await validateAuditSigningEnv();
      expect(warnings.some((w) => w.includes('AUDIT_MERKLE_SIGN_KEY_ID'))).toBe(true);
    });

    it('warns when the private key file cannot be read', async () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-boot-1';
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = path.join(os.tmpdir(), 'nao-existe-1154.pem');

      const warnings = await validateAuditSigningEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('chave privada');
      expect(warnings[0]).toContain('ENOENT');
    });

    // The failure that looks healthiest: signing works, verification cannot.
    it('warns when the key signs but has no entry in the registry', async () => {
      configureWorkingKey();

      const warnings = await validateAuditSigningEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('unknown_key_id');
      expect(warnings[0]).toContain('key-boot-1');
    });

    it('warns when the registry holds a DIFFERENT key for the active id', async () => {
      configureWorkingKey();
      const other = crypto.generateKeyPairSync('ed25519');
      const otherPublic = other.publicKey.export({ format: 'pem', type: 'spki' }).toString();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-boot-1': otherPublic });

      const warnings = await validateAuditSigningEnv();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('signature_verification_failed');
    });

    it('reports nothing when the key round-trips against the registry', async () => {
      const { publicPem } = configureWorkingKey();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-boot-1': publicPem });

      expect(await validateAuditSigningEnv()).toEqual([]);
    });

    // #1157's file form has to satisfy the same check, or the boot gate would
    // contradict the stack it is meant to validate.
    it('reports nothing when the registry comes from a FILE (#1157)', async () => {
      const { publicPem } = configureWorkingKey();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = writeTmp(
        'registry',
        JSON.stringify({ 'key-boot-1': publicPem })
      );

      expect(await validateAuditSigningEnv()).toEqual([]);
    });

    it('logs every warning through logger.warn and returns false', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      expect(await validateAuditSigningAndWarn()).toBe(false);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AUDIT]'));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns true and logs nothing when the config is sound', async () => {
      const { publicPem } = configureWorkingKey();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-boot-1': publicPem });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      expect(await validateAuditSigningAndWarn()).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // Never fatal, in any environment -- the whole point of direction 1, and
    // what keeps it independent of #979. If this ever throws, the posture
    // changed without the decision having been made.
    it('does not throw in production, however broken the config is', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      await expect(validateAuditSigningAndWarn()).resolves.toBe(false);
    });
  });
});
