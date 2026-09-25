import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const participantIdentityService = require('../../src/services/participantIdentity.service');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('participantIdentity.service item 8 residual branches', () => {
  it('normalizes Date and string birthDate values and rejects invalid dates', () => {
    const fromDate = participantIdentityService.normalizeForHash(
      'birthDate',
      new Date(2020, 0, 15)
    );
    const fromIsoLocal = participantIdentityService.normalizeForHash(
      'birthDate',
      new Date(2020, 5, 1)
    );
    const invalid = participantIdentityService.normalizeForHash('birthDate', 'not-a-date');

    expect(fromDate).toBe('2020-01-15');
    expect(fromIsoLocal).toBe('2020-06-01');
    expect(invalid).toBeNull();
  });

  it('skips ciphertext fields when decryptValue returns null for an unknown keyId', () => {
    const result = participantIdentityService.decryptIdentity({
      participantId: '12345678',
      patientNameEncrypted: {
        keyId: 'unknown-key-id-for-residual',
        ciphertext: 'x',
        iv: 'y',
        tag: 'z',
      },
      birthDateEncrypted: {
        keyId: 'another-unknown-key',
        ciphertext: 'a',
        iv: 'b',
        tag: 'c',
      },
    });

    expect(result.patientName).toBeUndefined();
    expect(result.birthDate).toBeUndefined();
  });
});
