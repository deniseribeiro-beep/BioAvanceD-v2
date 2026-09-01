/**
 * #938: with ENCRYPTION_KEY unset, every sample-file and linked-file upload
 * was stored in PLAINTEXT at rest and still returned success.
 *
 * `encryptFileBuffer` returns `null` with a single `warn` when no key is
 * configured -- correct for its backup caller, which #734 made check up
 * front and abort. The two upload callers instead read that `null` as
 * "skip encryption": the plaintext multer already wrote to disk was simply
 * left there and the request continued to a 2xx. The only trace was one log
 * line, and both shipped env templates (`.env.docker.example:31`,
 * `.env.production.example:18`) ship the key blank.
 *
 * The remedy is RNF029 AC#5's, not a taste call: "Criptografia, retenção e
 * ciclo de vida seguem a classificação do dado." Encryption is
 * policy-driven, so the fix is to fail closed when policy requires
 * encryption and it is unavailable -- #938's own "middle option", and the
 * shape #734 already set for backups. The default classification for
 * scientific files is encrypted (RNF029, #566), so the opt-out has to be
 * explicit and absent by default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const keyRegistry = require('../../src/config/keyRegistry');
const fileCrypto = require('../../src/utils/fileCrypto');

describe('#938 fileCrypto encryption-required gate', () => {
  const originalOptOut = process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
  });

  afterEach(() => {
    if (originalOptOut === undefined) delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
    else process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = originalOptOut;
  });

  it('reports encryption as unavailable when no key is configured', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    expect(fileCrypto.isFileEncryptionAvailable()).toBe(false);
  });

  it('reports encryption as available when a key is configured', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(Buffer.alloc(32, 1));

    expect(fileCrypto.isFileEncryptionAvailable()).toBe(true);
  });

  // The core of the fix: an upload must not be able to proceed to a
  // plaintext write, silently, on a keyless deployment.
  it('THROWS for a keyless deployment rather than letting the caller store plaintext', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    expect(() => fileCrypto.assertFileEncryptionConfigured()).toThrow(/ENCRYPTION_KEY/);
  });

  it('names the opt-out in the error, so the message is actionable rather than just a refusal', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    expect(() => fileCrypto.assertFileEncryptionConfigured()).toThrow(
      /ALLOW_UNENCRYPTED_FILE_STORAGE/
    );
  });

  it('carries a 500 statusCode so a controller maps it without inventing one', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    try {
      fileCrypto.assertFileEncryptionConfigured();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.statusCode).toBe(500);
    }
  });

  it('does not throw when a key is configured', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(Buffer.alloc(32, 1));

    expect(() => fileCrypto.assertFileEncryptionConfigured()).not.toThrow();
  });

  // The escape hatch has to exist -- a dev stack may legitimately run
  // without a key -- but it must be an explicit, deliberate act, not the
  // default the shipped templates fall into.
  it('allows plaintext ONLY when the opt-out is set explicitly to true', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = 'true';
    expect(() => fileCrypto.assertFileEncryptionConfigured()).not.toThrow();
  });

  it('does not accept a merely truthy opt-out value', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    for (const value of ['1', 'yes', 'TRUE ', 'false', '']) {
      process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = value;
      expect(() => fileCrypto.assertFileEncryptionConfigured()).toThrow();
    }
  });

  // encryptFileBuffer itself is deliberately unchanged: backup.service is
  // its third caller and #734 already made that path assert up front, and
  // its null return is what backup.service's own guard is written against.
  it('leaves encryptFileBuffer returning null rather than throwing', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    expect(fileCrypto.encryptFileBuffer(Buffer.from('x'))).toBeNull();
  });
});
