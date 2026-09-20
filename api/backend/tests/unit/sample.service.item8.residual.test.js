import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const sampleService = require('../../src/services/sample.service');
const participantIdentityService = require('../../src/services/participantIdentity.service');

const h = sampleService._test;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sample.service helper and lookup residual branches', () => {
  it('finds samples by ObjectId first and falls back to canonical specimenId', async () => {
    const id = new ObjectId();
    const collection = {
      findOne: vi.fn()
        .mockResolvedValueOnce({ _id: id, specimenId: 'S1' }),
    };

    await expect(h.findSampleByAnyId(collection, id)).resolves.toMatchObject({ specimenId: 'S1' });
    expect(collection.findOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne.mock.calls[0][0]._id.toString()).toBe(id.toString());

    collection.findOne
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ specimenId: id.toString() });
    await expect(h.findSampleByAnyId(collection, id.toString()))
      .resolves.toMatchObject({ specimenId: id.toString() });
    expect(collection.findOne).toHaveBeenCalledTimes(2);

    collection.findOne.mockReset().mockResolvedValueOnce({ specimenId: 'SPEC-1' });
    await expect(h.findSampleByAnyId(collection, 'SPEC-1'))
      .resolves.toMatchObject({ specimenId: 'SPEC-1' });
    expect(collection.findOne).toHaveBeenCalledWith({ specimenId: 'SPEC-1' });
  });

  it('creates validation errors with default and custom status codes', () => {
    const defaultError = h.createSampleValidationError('bad');
    expect(defaultError.message).toBe('bad');
    expect(defaultError.statusCode).toBe(422);

    const custom = h.createSampleValidationError('bad request', 400);
    expect(custom.statusCode).toBe(400);
  });

  it('validates required storage box and position inputs across all guards', () => {
    for (const value of [undefined, null, '']) {
      expect(() => h.normalizeRequiredStorageBoxAssignment(value, 'A1'))
        .toThrow(/Localização física obrigatória/);
    }

    expect(() => h.normalizeRequiredStorageBoxAssignment('not-an-object-id', 'A1'))
      .toThrow(/boxId deve ser um identificador válido/);

    const id = new ObjectId();
    expect(() => h.normalizeRequiredStorageBoxAssignment(id, null))
      .toThrow(/positionCode é obrigatório/);
    expect(() => h.normalizeRequiredStorageBoxAssignment(id, 123))
      .toThrow(/positionCode é obrigatório/);
    expect(() => h.normalizeRequiredStorageBoxAssignment(id, '   '))
      .toThrow(/positionCode é obrigatório/);

    const result = h.normalizeRequiredStorageBoxAssignment(` ${id.toString()} `, ' A1 ');
    expect(result.boxId.toString()).toBe(id.toString());
    expect(result.positionCode).toBe('A1');
  });

  it('walks direct and drawer storage hierarchies and tolerates missing parents', async () => {
    const docs = {
      drawer: { _id: 'drawer', containerType: 'DRAWER', parent_id: 'rack' },
      rack: { _id: 'rack', containerType: 'RACK', parent_id: 'shelf' },
      shelf: { _id: 'shelf', containerType: 'SHELF', parent_id: 'freezer' },
      freezer: { _id: 'freezer', containerType: 'FREEZER' },
    };
    const findOne = vi.fn(async ({ _id }) => docs[_id] || null);
    const db = { collection: vi.fn(() => ({ findOne })) };

    await expect(h.resolveStorageHierarchyForBox(db, { parent_id: 'rack' }))
      .resolves.toEqual({ rack: docs.rack, shelf: docs.shelf, freezer: docs.freezer });

    await expect(h.resolveStorageHierarchyForBox(db, { parent_id: 'drawer' }))
      .resolves.toEqual({ rack: docs.rack, shelf: docs.shelf, freezer: docs.freezer });

    await expect(h.resolveStorageHierarchyForBox(db, {}))
      .resolves.toEqual({ rack: null, shelf: null, freezer: null });

    await expect(h.resolveStorageHierarchyForBox(db, { parent_id: 'missing' }))
      .resolves.toEqual({ rack: null, shelf: null, freezer: null });
  });

  it('builds stable id variants and avoids duplicates/invalid empty values', () => {
    expect(h.buildIdVariants()).toEqual([]);
    expect(h.buildIdVariants(null, undefined, '')).toEqual([]);
    expect(h.buildIdVariants('001', 1, '1', 'alpha', 'alpha'))
      .toEqual(['001', 1, '1', 'alpha']);
  });

  it('classifies sensor statuses using status, maintenanceStatus and operationalStatus fallbacks', () => {
    expect(h.isOperationalSensor(null)).toBe(true);
    expect(h.isOperationalSensor({})).toBe(true);
    expect(h.isOperationalSensor({ status: 'offline' })).toBe(false);
    expect(h.isOperationalSensor({ maintenanceStatus: 'maintenance' })).toBe(false);
    expect(h.isOperationalSensor({ operationalStatus: 'error' })).toBe(false);
    expect(h.isOperationalSensor({ status: 'active' })).toBe(true);
  });

  it('deleteSample maps deletedCount to a boolean result', async () => {
    const samples = {
      deleteOne: vi.fn()
        .mockResolvedValueOnce({ deletedCount: 1 })
        .mockResolvedValueOnce({ deletedCount: 0 }),
    };
    const db = { collection: vi.fn(() => samples) };

    await expect(sampleService.deleteSample(db, 'S1')).resolves.toBe(true);
    await expect(sampleService.deleteSample(db, 'S2')).resolves.toBe(false);
  });

  it('deleteSample rethrows collection failures', async () => {
    const db = {
      collection: vi.fn(() => ({
        deleteOne: vi.fn().mockRejectedValue(new Error('delete failed')),
      })),
    };
    await expect(sampleService.deleteSample(db, 'S1')).rejects.toThrow('delete failed');
  });

  it('getSampleByBarcode returns exact match without later lookup strategies', async () => {
    const sample = { _id: 'sample-1', specimenId: 'SPEC-1', barcode: 'ABC', specimenStatus: 'available' };
    const samples = {
      findOne: vi.fn().mockResolvedValueOnce(sample),
    };
    const patients = { findOne: vi.fn().mockResolvedValue(null) };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samples;
        if (name === 'patients') return patients;
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };

    const result = await sampleService.getSampleByBarcode(db, 'ABC');
    expect(result.sample.specimenId).toBe('SPEC-1');
    expect(result.participant).toBeNull();
    expect(samples.findOne).toHaveBeenCalledTimes(1);
  });

  it('getSampleByBarcode falls through case-insensitive, numeric and regex strategies', async () => {
    const sample = { _id: 'sample-1', specimenId: 'SPEC-1', barcode: 123, specimenStatus: 'available' };
    const samples = {
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sample),
    };
    const patients = { findOne: vi.fn().mockResolvedValue(null) };
    const db = {
      collection: vi.fn((name) => name === 'samples' ? samples : patients),
    };

    const numeric = await sampleService.getSampleByBarcode(db, '123');
    expect(numeric.sample).toBe(sample);
    expect(samples.findOne).toHaveBeenCalledWith({ barcode: 123 });

    samples.findOne
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'sample-2', specimenId: 'SPEC-2', barcode: 'A+B' });
    const regex = await sampleService.getSampleByBarcode(db, 'A+B');
    expect(regex.sample.specimenId).toBe('SPEC-2');
    expect(samples.findOne.mock.calls[2][0].barcode.$regex).toBeInstanceOf(RegExp);
  });

  it('getSampleByBarcode reports not-found with sample count/examples', async () => {
    const samples = {
      findOne: vi.fn().mockResolvedValue(null),
      countDocuments: vi.fn().mockResolvedValue(2),
      find: vi.fn(() => ({
        limit: () => ({
          project: () => ({
            toArray: async () => [{ barcode: 'EX1' }, { barcode: 'EX2' }],
          }),
        }),
      })),
    };
    const patients = { findOne: vi.fn() };
    const db = {
      collection: vi.fn((name) => name === 'samples' ? samples : patients),
    };

    await expect(sampleService.getSampleByBarcode(db, 'NOT-FOUND'))
      .resolves.toEqual({ sample: null, participant: null });
    expect(samples.countDocuments).toHaveBeenCalledWith({});
  });

  it('getSampleByBarcode resolves and anonymizes participant identity for one- and multi-part names', async () => {
    const samples = {
      findOne: vi.fn().mockResolvedValue({
        _id: 'sample-1',
        specimenId: 'SPEC-1',
        barcode: 'ABC',
        participantId: '12345678',
        specimenStatus: 'available',
      }),
    };
    const patients = {
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        recordNumber: 'RN-1',
      }),
    };
    const identities = {
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        patientNameCiphertext: 'cipher',
      }),
    };
    vi.spyOn(participantIdentityService, 'decryptIdentity')
      .mockReturnValueOnce({ patientName: 'Ana Silva' })
      .mockReturnValueOnce({ patientName: 'Ana' })
      .mockReturnValueOnce({ patientName: '' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samples;
        if (name === 'patients') return patients;
        if (name === 'participantIdentities') return identities;
        return {};
      }),
    };

    let result = await sampleService.getSampleByBarcode(db, 'ABC');
    expect(result.participant.patientName).toBe('A. S.');

    result = await sampleService.getSampleByBarcode(db, 'ABC');
    expect(result.participant.patientName).toBe('A***');

    result = await sampleService.getSampleByBarcode(db, 'ABC');
    expect(result.participant.patientName).toBe('***');
  });

  it('getSampleByBarcode tolerates missing participant identity and participant id', async () => {
    const samples = {
      findOne: vi.fn()
        .mockResolvedValueOnce({
          _id: 'sample-1',
          specimenId: 'SPEC-1',
          barcode: 'ABC',
          participantId: '12345678',
        })
        .mockResolvedValueOnce({
          _id: 'sample-2',
          specimenId: 'SPEC-2',
          barcode: 'DEF',
        }),
    };
    const patients = {
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', recordNumber: 'RN-1' }),
    };
    const identities = { findOne: vi.fn().mockResolvedValue(null) };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samples;
        if (name === 'patients') return patients;
        if (name === 'participantIdentities') return identities;
        return {};
      }),
    };

    const first = await sampleService.getSampleByBarcode(db, 'ABC');
    expect(first.participant.patientName).toBe('***');

    const second = await sampleService.getSampleByBarcode(db, 'DEF');
    expect(second.participant).toBeNull();
  });

  it('getSampleResults rejects missing sample and returns linked results otherwise', async () => {
    const results = {
      find: vi.fn(() => ({ toArray: async () => [{ resultID: 'R1' }] })),
    };
    const db = { collection: vi.fn(() => results) };

    vi.spyOn(sampleService, 'getSample').mockResolvedValueOnce(null);
    await expect(sampleService.getSampleResults(db, 'S1')).rejects.toThrow('Amostra não encontrada');

    sampleService.getSample.mockResolvedValueOnce({ specimenId: 'SPEC-1' });
    await expect(sampleService.getSampleResults(db, 'S1')).resolves.toEqual([{ resultID: 'R1' }]);
    expect(results.find).toHaveBeenCalledWith({ specimenId: 'SPEC-1' });
  });

  it('history accessors prefer canonical specimenId and fall back to supplied id', async () => {
    const samples = {
      findOne: vi.fn()
        .mockResolvedValueOnce({ specimenId: 'SPEC-1' }),
    };
    const movements = {
      find: vi.fn(() => ({
        sort: () => ({ toArray: async () => [{ movementId: 'M1' }] }),
      })),
    };
    const db = {
      collection: vi.fn((name) => name === 'samples' ? samples : movements),
    };

    await expect(sampleService.getSampleMovements(db, 'S1')).resolves.toEqual([{ movementId: 'M1' }]);
    expect(movements.find).toHaveBeenCalledWith({
      $or: [
        { specimenId: 'SPEC-1' },
        { barcode: 'SPEC-1' },
      ],
    });
  });

  it('findAvailableSamplesForResearch always enforces canonical available status', async () => {
    const toArray = vi.fn().mockResolvedValue([{ specimenId: 'S1' }]);
    const find = vi.fn(() => ({ toArray }));
    const db = { collection: vi.fn(() => ({ find })) };

    await expect(sampleService.findAvailableSamplesForResearch(db, { collectionSite: 'ORG-1', specimenStatus: 'quarantined' }))
      .resolves.toEqual([{ specimenId: 'S1' }]);
    expect(find).toHaveBeenCalledWith({
      collectionSite: 'ORG-1',
      specimenStatus: 'available',
    });
  });
});
