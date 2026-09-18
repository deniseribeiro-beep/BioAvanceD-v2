import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/import-lgpd.service');

afterEach(() => {
  vi.restoreAllMocks();
});

function cursor(rows) {
  const c = {
    sort: vi.fn(() => c),
    skip: vi.fn(() => c),
    limit: vi.fn(() => c),
    toArray: vi.fn(async () => rows),
  };
  return c;
}

describe('ImportLGPDService item 8 branch closure - storage helpers', () => {
  it('resolves direct rack hierarchy and drawer hierarchy', async () => {
    const docs = new Map([
      ['rack-1', { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' }],
      ['drawer-1', { _id: 'drawer-1', containerType: 'DRAWER', parent_id: 'rack-2' }],
      ['rack-2', { _id: 'rack-2', containerType: 'RACK', parent_id: 'shelf-2' }],
      ['shelf-1', { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' }],
      ['shelf-2', { _id: 'shelf-2', containerType: 'SHELF', parent_id: 'freezer-2' }],
      ['freezer-1', { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' }],
      ['freezer-2', { _id: 'freezer-2', containerType: 'FREEZER', containerID: 'EQ-2' }],
    ]);
    const storageContainers = { findOne: vi.fn(async ({ _id }) => docs.get(String(_id)) || null) };
    const db = { collection: vi.fn(() => storageContainers) };

    await expect(service.resolveStorageHierarchyForBox(db, { parent_id: 'rack-1' }))
      .resolves.toMatchObject({ rack: { _id: 'rack-1' }, shelf: { _id: 'shelf-1' }, freezer: { _id: 'freezer-1' } });
    await expect(service.resolveStorageHierarchyForBox(db, { parent_id: 'drawer-1' }))
      .resolves.toMatchObject({ rack: { _id: 'rack-2' }, shelf: { _id: 'shelf-2' }, freezer: { _id: 'freezer-2' } });
    await expect(service.resolveStorageHierarchyForBox(db, {}))
      .resolves.toEqual({ rack: null, shelf: null, freezer: null });
  });

  it('finds positions in object and Map grids and returns null when unavailable', () => {
    expect(service.findFirstAvailablePositionInBox({ dimension: { rows: 0, cols: 2 } })).toBeNull();
    expect(service.findFirstAvailablePositionInBox({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: true, A2: false }
    })).toBe('A2');

    const grid = new Map([['A1', true], ['A2', false]]);
    expect(service.findFirstAvailablePositionInBox({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: grid
    })).toBe('A2');

    expect(service.findFirstAvailablePositionInBox({
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: { A1: true }
    })).toBeNull();
  });

  it('checks equipment and sensor readiness outcomes', async () => {
    const equipment = { findOne: vi.fn() };
    const sensors = { find: vi.fn(() => cursor([])) };
    const db = { collection: vi.fn((name) => name === 'equipment' ? equipment : sensors) };

    await expect(service.isPlacementReady(db, null)).resolves.toBe(false);

    equipment.findOne.mockResolvedValueOnce(null);
    await expect(service.isPlacementReady(db, { containerID: 'EQ-1' })).resolves.toBe(false);

    equipment.findOne.mockResolvedValueOnce({ equipmentID: 'EQ-1', status: 'Inactive' });
    await expect(service.isPlacementReady(db, { containerID: 'EQ-1' })).resolves.toBe(false);

    equipment.findOne.mockResolvedValueOnce({ equipmentID: 'EQ-1', status: 'Active' });
    sensors.find.mockReturnValueOnce(cursor([{ status: 'offline' }, { maintenanceStatus: 'maintenance' }]));
    await expect(service.isPlacementReady(db, { containerID: 'EQ-1' })).resolves.toBe(false);

    equipment.findOne.mockResolvedValueOnce({ equipmentID: 42, status: 'Active' });
    sensors.find.mockReturnValueOnce(cursor([{ operationalStatus: 'Active' }]));
    await expect(service.isPlacementReady(db, { containerID: 42 })).resolves.toBe(true);
  });

  it('covers box availability gates', () => {
    expect(service.isBoxAvailable({ status: 'FULL', dimension: { rows: 1, cols: 1 } })).toBe(false);
    expect(service.isBoxAvailable({ status: '', dimension: { rows: 0, cols: 1 } })).toBe(false);
    expect(service.isBoxAvailable({ status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 1 })).toBe(false);
    expect(service.isBoxAvailable({ status: 'ACTIVE', dimension: { rows: 1, cols: 2 }, currentOccupancy: 1, occupancyGrid: { A1: true } })).toBe(true);
    expect(service.isBoxAvailable({ status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: { A1: true } })).toBe(false);
  });
});

describe('ImportLGPDService item 8 branch closure - quarantine helpers', () => {
  it('validates malformed and missing quarantine batches', async () => {
    const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) };
    await expect(service.getQuarantineBatch(db, 'bad-id')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.getQuarantineBatch(db, '64b7f9c2e4b0a1d2c3e4f5a6')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('normalizes list pagination bounds and zero totals', async () => {
    const c = {
      find: vi.fn(() => cursor([])),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const db = { collection: vi.fn(() => c) };
    const result = await service.listQuarantineBatches(db, { limit: 1000, page: -4, types: ['UNKNOWN'] });
    expect(result).toMatchObject({ page: 1, limit: 100, totalPages: 1, total: 0 });
  });

  it('sanitizes import options and ignores unsafe group fields', () => {
    expect(service.sanitizeImportOptions()).toEqual({
      startBoxId: null,
      autoIncrement: false,
      groupFields: {},
    });
    expect(service.sanitizeImportOptions({
      startBoxId: 123,
      autoIncrement: 1,
      groupFields: {
        ok: 'x',
        number: 2,
        enabled: false,
        nil: null,
        nested: { x: 1 },
        '$where': 'bad',
        'a.b': 'bad',
      }
    })).toEqual({
      startBoxId: '123',
      autoIncrement: true,
      groupFields: { ok: 'x', number: 2, enabled: false },
    });
  });

  it('returns null when no rejected rows exist and stages rejected rows when present', async () => {
    const batches = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'batch-1' }) };
    const records = { insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }) };
    const db = { collection: vi.fn((name) => name === 'import_batches' ? batches : records) };

    await expect(service.quarantineRejectedSampleRows(db, {
      rows: [],
      results: { total: 0, success: 0, errors: [] }
    })).resolves.toBeNull();

    const rows = [{ sampleType: 'PLASMA' }];
    const result = await service.quarantineRejectedSampleRows(db, {
      fileName: 'x.csv',
      rows,
      results: { total: 1, success: 0, errors: [{ index: 0, row: 2, errors: ['bad'], data: null }] },
      actor: { userId: 'u-1' },
      importOptions: { groupFields: { consentTemplateId: 't-1' } },
      type: 'LGPD_SAMPLE_CSV',
    });
    expect(result).toBe('batch-1');
    expect(records.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ batchId: 'batch-1', rowNumber: 2, row: rows[0], normalized: null })
    ]);
  });

  it('fails quarantine best-effort and records failed batches with fallback error text', async () => {
    const failingDb = { collection: vi.fn(() => ({ insertOne: vi.fn().mockRejectedValue(new Error('db down')) })) };
    await expect(service.quarantineRejectedSampleRows(failingDb, {
      rows: [{}],
      results: { total: 1, success: 0, errors: [{ index: 0, row: 2, errors: [] }] }
    })).resolves.toBeNull();

    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'failed-1' });
    const db = { collection: vi.fn(() => ({ insertOne })) };
    await expect(service.recordFailedImportBatch(db, {
      error: null,
      actor: { userID: 'u-1' }
    })).resolves.toBe('failed-1');
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAILED',
      error: 'Erro desconhecido',
      createdBy: 'u-1',
      fileName: null
    }));
  });
});

describe('ImportLGPDService item 8 branch closure - parsers and mappings', () => {
  it('covers parsePatientRow record and height fallbacks', () => {
    expect(service.parsePatientRow({ recordNumber: ' null ', heightCm: 'abc' }).recordNumber).toBeNull();
    expect(service.parsePatientRow({ recordNumber: '12A' }).recordNumber).toBe(12);
    expect(service.parsePatientRow({ recordNumber: 'ABC' }).recordNumber).toBe('ABC');
    expect(service.parsePatientRow({ height: 'abc' }).heightCm).toBeNull();
    expect(service.parsePatientRow({ heightCm: '2.1' }).heightCm).toBe(210);
  });

  it('covers parseSampleRow alias and empty-field fallbacks', () => {
    const nowish = service.parseSampleRow({});
    expect(nowish.participantId).toBeNull();
    expect(nowish.patientName).toBeNull();
    expect(nowish.sampleType).toBeNull();
    expect(nowish.quantity).toBeNull();
    expect(nowish.consentTemplateId).toBeNull();

    const mapped = service.parseSampleRow({
      participantId: ' 12345678 ',
      nomePaciente: ' Nome Alternativo ',
      dataNascimento: '01/02/2000',
      gender: 'female',
      responsavelNome: ' Resp ',
      sampleType: ' PLASMA ',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      barcode: 1234,
      quantity: '2.5',
      consentTemplateId: 77,
      boxID: 'box-1',
      position: 'A1',
      lifecycleStatus: 'available',
      sprecMatrixType: 'PLASMA',
      sprecSampleTypeCode: 'ST',
      orpha: 'ORPHA:1',
      omim: '123',
      cidCode: 'X',
      treatmentStatus: 'treated',
      atcCode: 'ATC:A01',
      medicationName: 'Drug',
      atcClass: '',
      rcsScore: '10',
      scoreBasedGrade: 'b',
      merkleRoot: ' root ',
    });
    expect(mapped).toMatchObject({
      participantId: '12345678',
      patientName: 'Nome Alternativo',
      patientSex: 'F',
      representativeName: 'Resp',
      barcode: '1234',
      quantity: 2.5,
      consentTemplateId: '77',
      boxId: 'box-1',
      positionCode: 'A1',
    });
  });

  it('covers normalizeText default and uppercase branches', () => {
    expect(service.normalizeText(' abc ')).toBe('abc');
    expect(service.normalizeText(' abc ', { uppercase: true })).toBe('ABC');
    expect(service.normalizeText('   ')).toBeNull();
    expect(service.normalizeText(undefined)).toBeNull();
  });

  it('maps explicit, canonical and accented headers without overwriting explicit mapping', () => {
    const raw = {
      sourceName: 'Explicit Name',
      patientName: 'Canonical Name',
      'Nome Paciente': 'Alias Name',
      'Data Nascimento': '01/01/2000',
      responsavelNome: 'Resp',
      responsavelEmail: 'resp@example.test',
      Empty: '   ',
      '   ': 'ignored'
    };
    const mapped = service.buildMappedPatientRow(raw, { sourceName: 'patientName', Empty: '' });
    expect(mapped.patientName).toBe('Explicit Name');
    expect(mapped.birthDate).toBe('01/01/2000');
    expect(mapped.representativeName).toBe('Resp');
    expect(mapped.representativeEmail).toBe('resp@example.test');
  });
});
