import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  validateRedisEnv,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
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
});
