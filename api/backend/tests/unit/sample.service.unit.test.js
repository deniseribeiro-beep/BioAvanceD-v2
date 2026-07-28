import { describe, it, expect, vi, afterEach } from 'vitest';

const sampleService = require('../../src/services/sample.service');

afterEach(() => { vi.restoreAllMocks(); });

describe('SampleService.getBarcodeIndustrialAssets', () => {
  it('throws for invalid barcode (empty)', async () => {
    await expect(sampleService.getBarcodeIndustrialAssets('')).rejects.toThrow('inválido');
  });

  it('throws for null barcode', async () => {
    await expect(sampleService.getBarcodeIndustrialAssets(null)).rejects.toThrow('inválido');
  });

  it('returns assets for valid barcode value', async () => {
    const result = await sampleService.getBarcodeIndustrialAssets('SMP-001');
    expect(result).toBeDefined();
  });

  it('returns assets for Code128 prefix barcode', async () => {
    const result = await sampleService.getBarcodeIndustrialAssets(']C1SMP-001');
    expect(result).toBeDefined();
  });
});

describe('SampleService.listSamples', () => {
  function makeDb(docs = []) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    };
    return {
      collection: vi.fn().mockReturnValue({
        collectionName: 'samples',
        find: vi.fn().mockReturnValue(cursor),
        countDocuments: vi.fn().mockResolvedValue(docs.length),
        createIndex: vi.fn().mockResolvedValue(null),
        listCollections: undefined,
      }),
      listCollections: undefined,
    };
  }

  it('returns object with samples array for empty collection', async () => {
    const db = makeDb([]);
    const result = await sampleService.listSamples(db, {});
    expect(result).toHaveProperty('samples');
    expect(Array.isArray(result.samples)).toBe(true);
    expect(result).toHaveProperty('total');
  });

  it('returns samples when collection has data', async () => {
    const fakeSamples = [
      { _id: '507f1f77bcf86cd799439011', sampleID: 1234567, patientID: '12345678', currentStatus: 'AVAILABLE' },
    ];
    const db = makeDb(fakeSamples);
    const result = await sampleService.listSamples(db, {});
    expect(result.samples).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('SampleService.getSampleMovements', () => {
  it('returns empty array when no movements', async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const db = {
      collection: vi.fn().mockReturnValue({
        collectionName: 'sample_movements',
        find: vi.fn().mockReturnValue(cursor),
        findOne: vi.fn().mockResolvedValue({ _id: 'SMP-001', specimenId: 'SMP-001' }),
        createIndex: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
        deleteOne: vi.fn(),
      }),
    };

    const result = await sampleService.getSampleMovements(db, 'SMP-001');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('SampleService.getSampleResults', () => {
  it('throws when sample not found', async () => {
    const cursor = { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
    const db = {
      collection: vi.fn().mockImplementation((name) => ({
        collectionName: name,
        find: vi.fn().mockReturnValue(cursor),
        findOne: vi.fn().mockResolvedValue(null), // sample not found
        countDocuments: vi.fn().mockResolvedValue(0),
        createIndex: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
        deleteOne: vi.fn(),
      })),
    };

    await expect(sampleService.getSampleResults(db, 'SMP-001')).rejects.toThrow('não encontrada');
  });
});
