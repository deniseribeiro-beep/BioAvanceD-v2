import { afterEach, describe, expect, it, vi } from 'vitest';

const logger = require('../../src/utils/logger');
const {
  probeTopology,
  isTransactionCapable,
} = require('../../src/utils/mongoTransaction');
const {
  decryptValue,
} = require('../../src/utils/fieldEncryption');
const { generateUniqueBarcode } = require('../../src/utils/barcodeGenerator');
const {
  computeMovementChainHash,
  enforceAppendOnlyCollection,
} = require('../../src/utils/sampleMovementLedger');
const { iso8601DurationToMs } = require('../../src/utils/iso8601Duration');
const { stripScannerPrefix } = require('../../src/utils/barcodeSymbology');
const { ensureParticipantIdentityIndexes } = require('../../src/utils/participantIdentityIndexes');
const { ensureSampleIndexes } = require('../../src/utils/sampleIndexes');
const { ensureStagingImportIndexes } = require('../../src/utils/stagingImportIndexes');
const { anonymizeLogUser } = require('../../src/utils/userAnonymization');
const { buildUserFilterById } = require('../../src/utils/userFilter');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item 8 branch-95 utility behaviors', () => {
  it('probes Mongo through the db.s.client fallback and handles an empty hello reply', async () => {
    const client = {
      db: vi.fn(() => ({
        command: vi.fn().mockResolvedValue(null),
      })),
    };
    const db = { s: { client } };

    await expect(probeTopology(db)).resolves.toBe('unknown');
    await expect(isTransactionCapable({
      s: {
        client: {
          db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) })),
        },
      },
    })).resolves.toBe(true);
  });

  it('returns null for invalid encrypted payloads and fails closed on an unknown key id', () => {
    expect(decryptValue(null)).toBeNull();
    expect(decryptValue('not-an-envelope')).toBeNull();
    expect(decryptValue({ keyId: 'definitely-unknown', iv: '', tag: '', data: '' })).toBeNull();
  });

  it('covers barcode counter seeding with a null scan result and missing counter sequence', async () => {
    const samples = {
      createIndex: vi.fn().mockResolvedValue('idx'),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(null) })),
      findOne: vi.fn().mockResolvedValue(null),
    };
    const counters = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({}),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'specimens') return samples;
        if (name === 'counters') return counters;
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    await expect(generateUniqueBarcode(db))
      .rejects.toThrow('Não foi possível gerar um código de barras único');
    expect(counters.updateOne).toHaveBeenCalled();
  });

  it('covers movement-chain empty specimen normalization and inert bulk entries', async () => {
    expect(computeMovementChainHash({}, null)).toMatch(/^[a-f0-9]{64}$/);

    const originalBulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
    const collection = {
      bulkWrite: originalBulkWrite,
    };
    enforceAppendOnlyCollection(collection, 'sample_movements');

    await expect(collection.bulkWrite([null, undefined], {})).resolves.toEqual({ ok: 1 });
    expect(originalBulkWrite).toHaveBeenCalled();
  });

  it('covers absent ISO day component and canonical Data Matrix scanner prefix', () => {
    expect(iso8601DurationToMs('P1Y')).toBe(365 * 24 * 60 * 60 * 1000);
    expect(stripScannerPrefix(' ]d2SPEC-001 ')).toBe('SPEC-001');
  });

  it('emits debug output only in the documented development mode branch', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logger.debug('branch-95');
      expect(log).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('logs participant identity index failures even when a non-Error value is rejected', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = {
      createIndex: vi.fn().mockRejectedValue('index-refused'),
    };
    await ensureParticipantIdentityIndexes(collection);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('index-refused'));
  });

  it('logs sample index failure fallback text for a non-Error rejection', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await ensureSampleIndexes({
      createIndex: vi.fn().mockRejectedValue('sample-index-refused'),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sample-index-refused'));
  });

  it('logs staging-import index failure fallback text for a non-Error rejection', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await ensureStagingImportIndexes({
      collectionName: `stagingImports-branch95-${Date.now()}`,
      createIndex: vi.fn().mockRejectedValue('staging-index-refused'),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('staging-index-refused'));
  });

  it('keeps null log input unchanged and rejects numeric legacy account identifiers', async () => {
    await expect(anonymizeLogUser(null)).resolves.toBeNull();
    expect(buildUserFilterById('42')).toEqual({ userAccountId: { $in: [] } });
  });
});
