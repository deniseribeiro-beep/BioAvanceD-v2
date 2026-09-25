import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ingestRecord } = require('../../../src/ingestion/ingestionGateway');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ingestionGateway item 8 residual guard branches', () => {
  it('requires db and entityType before any idempotency work', async () => {
    await expect(ingestRecord({ entityType: 'Specimen', payload: {} }))
      .rejects.toThrow('ingestRecord: db é obrigatório');
    await expect(ingestRecord({ db: {}, payload: {} }))
      .rejects.toThrow('ingestRecord: entityType é obrigatório');
  });

  it('returns null resultRef on idempotent replay when the stored claim has no resultRef', async () => {
    const claimIdempotencyKey = vi.fn(async () => ({
      idempotent: true,
      existing: {},
    }));
    const idempotencyPath = require.resolve('../../../src/ingestion/idempotency');
    const original = require.cache[idempotencyPath];
    require.cache[idempotencyPath] = {
      id: idempotencyPath,
      filename: idempotencyPath,
      loaded: true,
      exports: {
        ...(original?.exports || {}),
        claimIdempotencyKey,
        recordIdempotentResult: vi.fn(),
      },
    };
    const gatewayPath = require.resolve('../../../src/ingestion/ingestionGateway');
    delete require.cache[gatewayPath];
    const { ingestRecord: ingest } = require('../../../src/ingestion/ingestionGateway');

    try {
      const result = await ingest({
        db: {},
        entityType: 'Specimen',
        payload: {},
        provenance: {},
        idempotencyKey: 'key-1',
      });
      expect(result).toEqual({
        status: 'idempotent_replay',
        entityType: 'Specimen',
        idempotencyKey: 'key-1',
        resultRef: null,
        violations: [],
      });
    } finally {
      require.cache[idempotencyPath] = original;
      delete require.cache[gatewayPath];
    }
  });
});
