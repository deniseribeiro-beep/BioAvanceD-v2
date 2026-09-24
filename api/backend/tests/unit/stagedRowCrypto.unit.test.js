/**
 * #807 (RNF020 AC#4, RNF029 AC#5): a rejected import row carries the same
 * civil identity that participantIdentities stores encrypted, so it is
 * encrypted at rest in import_staging_records too. The encryption follows
 * the class of the data, not the success or failure of the import.
 *
 * The helper seals `row` and `normalized` into one AES-GCM envelope on write
 * and restores them on read, so the quarantine API and UI see the same shape
 * as before.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const keyRegistry = require('../../src/config/keyRegistry');
const { sealStagedRecord, revealStagedRecord } = require('../../src/utils/stagedRowCrypto');

const CIVIL_ROW = { Nome: 'Maria da Silva', CPF: '12345678900', 'Data de nascimento': '1980-01-02' };
const NORMALIZED = { patientName: 'Maria da Silva', identityDocument: '12345678900' };

function stagedRecord(overrides = {}) {
  return {
    batchId: 'batch-807',
    rowNumber: 2,
    status: 'ERROR',
    errors: ['CPF invalido'],
    row: CIVIL_ROW,
    normalized: NORMALIZED,
    ...overrides,
  };
}

describe('#807: stagedRowCrypto', () => {
  const originalOptOut = process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

  afterEach(() => {
    if (originalOptOut === undefined) delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
    else process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = originalOptOut;
  });

  it('writes no civil value in plaintext when a key is configured', () => {
    const sealed = sealStagedRecord(stagedRecord());

    expect(JSON.stringify(sealed)).not.toContain('12345678900');
    expect(JSON.stringify(sealed)).not.toContain('Maria da Silva');
    expect(sealed.row).toBeNull();
    expect(sealed.normalized).toBeNull();
    expect(sealed.sealedPayload).toMatchObject({ alg: 'aes-256-gcm', keyId: 'vitest-key-001' });
  });

  it('keeps the fields a reviewer needs to see why the row was rejected', () => {
    const sealed = sealStagedRecord(stagedRecord());

    expect(sealed).toMatchObject({
      batchId: 'batch-807',
      rowNumber: 2,
      status: 'ERROR',
      errors: ['CPF invalido'],
    });
  });

  it('round-trips: reveal restores row and normalized and drops the envelope', () => {
    const revealed = revealStagedRecord(sealStagedRecord(stagedRecord()));

    expect(revealed.row).toEqual(CIVIL_ROW);
    expect(revealed.normalized).toEqual(NORMALIZED);
    expect(revealed).not.toHaveProperty('sealedPayload');
  });

  // Control case: a record staged before #807 has no envelope, and must read
  // back exactly as it was stored.
  it('reads a legacy plaintext record back unchanged', () => {
    const legacy = stagedRecord();
    expect(revealStagedRecord(legacy)).toEqual(legacy);
  });

  it('leaves a record with nothing to seal untouched', () => {
    const empty = stagedRecord({ row: null, normalized: null });
    expect(sealStagedRecord(empty)).toEqual(empty);
  });

  describe('with no key configured', () => {
    function withoutKey(fn) {
      const original = keyRegistry.getActiveKey;
      keyRegistry.getActiveKey = () => null;
      try {
        return fn();
      } finally {
        keyRegistry.getActiveKey = original;
      }
    }

    it('withholds the civil payload rather than storing it in plaintext', () => {
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
      const sealed = withoutKey(() => sealStagedRecord(stagedRecord()));

      expect(JSON.stringify(sealed)).not.toContain('12345678900');
      expect(sealed.row).toBeNull();
      expect(sealed.normalized).toBeNull();
      expect(sealed.payloadWithheld).toBe('ENCRYPTION_KEY_MISSING');
      // The rejection itself survives: RNF011 AC#4's "sem correcao silenciosa".
      expect(sealed.errors).toEqual(['CPF invalido']);
    });

    it('keeps plaintext only under the explicit ALLOW_UNENCRYPTED_FIELD_STORAGE opt-out', () => {
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';
      const sealed = withoutKey(() => sealStagedRecord(stagedRecord()));

      expect(sealed.row).toEqual(CIVIL_ROW);
      expect(sealed).not.toHaveProperty('payloadWithheld');
    });
  });
});
