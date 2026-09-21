import { afterEach, describe, expect, it, vi } from 'vitest';

const logger = require('../../src/utils/logger');
const {
  validateRedisEnv,
  validateEncryptionEnv,
  validateKeyRotationEnv,
  validateEncryptionAndHalt,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
} = require('../../src/config/validateEnv');

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function cleanRedis() {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_PASSWORD;
}

function cleanEncryption() {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_ID;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;
  delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
  delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
}

describe('validateEnv item 8 canonical branch coverage', () => {
  it('validates Redis URL, host/port and password postures', () => {
    cleanRedis();
    process.env.NODE_ENV = 'test';
    let result = validateRedisEnv();
    expect(result.errors).toEqual(expect.arrayContaining([
      'REDIS_HOST não está definido no .env',
      'REDIS_PORT não está definido no .env',
    ]));

    cleanRedis();
    process.env.REDIS_URL = 'not-a-url';
    result = validateRedisEnv();
    expect(result.errors).toContain('REDIS_URL inválida');

    cleanRedis();
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = 'bad';
    result = validateRedisEnv();
    expect(result.errors).toContain('REDIS_PORT deve ser um número válido entre 1 e 65535');

    process.env.REDIS_PORT = '70000';
    expect(validateRedisEnv().errors).toContain('REDIS_PORT deve ser um número válido entre 1 e 65535');

    process.env.REDIS_PORT = '6379';
    expect(validateRedisEnv().errors).not.toContain('REDIS_PORT deve ser um número válido entre 1 e 65535');

    cleanRedis();
    process.env.NODE_ENV = 'production';
    process.env.REDIS_HOST = 'redis.example.test';
    process.env.REDIS_PORT = '6379';
    result = validateRedisEnv();
    expect(result.errors).toContain('REDIS_PASSWORD não está definido no .env');
    expect(result.warnings).toContain('REDIS_URL não está definido; usando host/porta separados');

    cleanRedis();
    process.env.NODE_ENV = 'development';
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6379';
    result = validateRedisEnv();
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toMatch(/host Redis .* não é local/);

    cleanRedis();
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://:secret@redis.example.test:6379';
    process.env.REDIS_PASSWORD = 'secret';
    expect(validateRedisEnv()).toEqual({ errors: [], warnings: [] });
  });

  it('reports all previous-key rotation misconfigurations independently', () => {
    cleanEncryption();
    process.env.ENCRYPTION_KEY = 'active';
    process.env.ENCRYPTION_KEY_PREVIOUS = 'previous';
    expect(validateKeyRotationEnv()[0]).toMatch(/PREVIOUS_ID/);

    cleanEncryption();
    process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'old';
    expect(validateKeyRotationEnv()[0]).toMatch(/id órfão/);

    cleanEncryption();
    process.env.ENCRYPTION_KEY_ID = 'same';
    process.env.ENCRYPTION_KEY_PREVIOUS = 'previous';
    process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'same';
    expect(validateKeyRotationEnv()[0]).toMatch(/igual a ENCRYPTION_KEY_ID/);

    cleanEncryption();
    process.env.ENCRYPTION_KEY_ID = 'active';
    process.env.ENCRYPTION_KEY_PREVIOUS = 'previous';
    process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'old';
    expect(validateKeyRotationEnv()).toEqual([]);
  });

  it('keeps encryption posture as warnings outside production and fatal errors in production', () => {
    cleanEncryption();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
    process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';
    let result = validateEncryptionEnv();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(3);

    process.env.NODE_ENV = 'production';
    result = validateEncryptionEnv();
    expect(result.errors).toHaveLength(3);

    process.env.ENCRYPTION_KEY = 'configured';
    delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
    delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
    result = validateEncryptionEnv();
    expect(result.errors).toEqual([]);
  });

  it('aggregates Mongo warning and reports overall validity', () => {
    cleanRedis();
    cleanEncryption();
    process.env.NODE_ENV = 'test';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
    process.env.ENCRYPTION_KEY = 'configured';
    delete process.env.MONGO_URI;

    const result = validateAllEnv();
    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain('MONGO_URI não está definido (algumas funcionalidades podem não funcionar)');
  });

  it('allows development continuation, throws outside it, and logs warning-only configurations', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    cleanRedis();
    cleanEncryption();
    process.env.NODE_ENV = 'development';
    expect(validateAndHalt(true)).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    cleanRedis();
    cleanEncryption();
    process.env.NODE_ENV = 'production';
    expect(() => validateAndHalt(false)).toThrow(/Variáveis de ambiente obrigatórias/);

    cleanRedis();
    cleanEncryption();
    process.env.NODE_ENV = 'test';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
    process.env.ENCRYPTION_KEY = 'configured';
    delete process.env.MONGO_URI;
    expect(validateAndHalt()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('covers Redis-only silent, development and fatal branches', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    cleanRedis();
    process.env.NODE_ENV = 'development';
    expect(validateRedisOnly(true, true)).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();

    cleanRedis();
    process.env.NODE_ENV = 'development';
    expect(validateRedisOnly(true, false)).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    cleanRedis();
    process.env.NODE_ENV = 'production';
    expect(() => validateRedisOnly(false, true)).toThrow(/Redis configurado incorretamente/);

    cleanRedis();
    process.env.NODE_ENV = 'test';
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6379';
    expect(validateRedisOnly(true, false)).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('logs rotation warnings and blocks insecure production encryption boot', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    cleanEncryption();
    process.env.NODE_ENV = 'test';
    process.env.ENCRYPTION_KEY = 'configured';
    process.env.ENCRYPTION_KEY_PREVIOUS = 'old-key';
    expect(validateEncryptionAndHalt()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    cleanEncryption();
    process.env.NODE_ENV = 'production';
    expect(() => validateEncryptionAndHalt()).toThrow(/Configuração de criptografia inaceitável/);
    expect(errorSpy).toHaveBeenCalled();
  });
});
