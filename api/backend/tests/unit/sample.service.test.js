import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const sampleService = require('../../src/services/sample.service');
const fhirSyncService = require('../../src/services/fhir-sync.service');

function makeCursor(docs = []) {
  const cursor = {
    sort: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(docs),
    next: vi.fn().mockResolvedValue(docs[0] || null)
  };
  return cursor;
}

function makeCollection(name) {
  return {
    collectionName: name,
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => makeCursor([])),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'generated-id' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
    createIndex: vi.fn().mockResolvedValue(true)
  };
}

function makeDb(overrides = {}) {
  const collections = {
    samples: makeCollection('samples'),
    sample_movements: makeCollection('sample_movements'),
    counters: makeCollection('counters'),
    patients: makeCollection('patients'),
    locations: makeCollection('locations'),
    results: makeCollection('results'),
    ...overrides
  };
  return {
    collections,
    collection: vi.fn((name) => collections[name] || (collections[name] = makeCollection(name)))
    // no listCollections -> collectionResolver falls back to canonical names directly
  };
}

function validSampleData(overrides = {}) {
  return {
    patientID: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 10,
    quality: 'GOOD',
    linkedProject: 'ProjectX',
    barcode: 'BR-TEST-001',
    sampleID: 555001,
    registerDate: new Date('2024-01-01'),
    ...overrides
  };
}

describe('sample.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default fhir-sync spies: pretend FHIR-first paths are inactive unless a
    // test opts in explicitly, so that legacy-collection logic is exercised.
    vi.spyOn(fhirSyncService, 'getSampleFhirFirst').mockResolvedValue(null);
    vi.spyOn(fhirSyncService, 'listSamplesFhirFirst').mockResolvedValue(null);
    vi.spyOn(fhirSyncService, 'getSampleByBarcodeFhirFirst').mockResolvedValue(null);
    vi.spyOn(fhirSyncService, 'upsertSampleFromLegacy').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  describe('createSample', () => {
    it('creates a sample and appends a birth movement to the ledger', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });

      // NOTE: this test is currently blocked by #119 (validSampleData() predates
      // the now-required locationID/location validation chain) and fails before
      // reaching the assertions below regardless of this fix — tracked separately,
      // not fixed here to stay scoped to #111.
      const result = await sampleService.createSample(db, validSampleData());

      expect(result._id).toBe('generated-id');
      expect(result.barcode).toBe('BR-TEST-001');
      expect(db.collections.samples.insertOne).toHaveBeenCalledTimes(1);
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
      const [movementArg] = db.collections.sample_movements.insertOne.mock.calls[0];
      expect(movementArg.type).toBe('create');
      // Issue #111: upsertSampleFromLegacy is a no-op boundary stub (fhir-sync.service.js)
      // since main's canonical-cleanup rewrite; sample creation no longer calls it.
      expect(fhirSyncService.upsertSampleFromLegacy).not.toHaveBeenCalled();
    });

    it('does not call the FHIR boundary stub on creation (#111)', async () => {
      // Self-contained repro for #111 that doesn't depend on validSampleData()
      // (blocked separately by #119) — mocks the full location/sensor chain so
      // createSample actually reaches the code path the fix touches.
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.locations.findOne.mockResolvedValue({ locationID: 1 });
      db.collection.mockImplementation((name) => {
        if (name === 'sensors') return { findOne: vi.fn().mockResolvedValue({ status: 'ok' }) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await sampleService.createSample(db, validSampleData({ locationID: 1 }));

      expect(fhirSyncService.upsertSampleFromLegacy).not.toHaveBeenCalled();
    });

    it('rejects with 422 when required MIABIS fields are missing', async () => {
      const db = makeDb();
      const bad = validSampleData();
      delete bad.sampleType;

      await expect(sampleService.createSample(db, bad)).rejects.toMatchObject({
        statusCode: 422
      });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 404 when the patient does not exist', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue(null); // not found

      await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({
        statusCode: 404
      });
    });

    it('rejects when the barcode is already taken', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.samples.findOne.mockResolvedValueOnce({ barcode: 'BR-TEST-001' }); // barcode dup check

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Já existe uma amostra com o código de barras/
      );
    });

    it('rejects when the sampleID is already taken', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // barcode dup check passes
        .mockResolvedValueOnce({ sampleID: 555001 }); // sampleID dup check

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Já existe uma amostra com o ID/
      );
    });

    it('rejects with 404 when locationID is provided but does not exist', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.locations.findOne.mockResolvedValue(null);

      await expect(
        sampleService.createSample(db, validSampleData({ locationID: 42 }))
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 409 when the physical storage position is already occupied', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.samples.findOne.mockImplementation((query) => {
        if (query && query['location.status'] === 'Occupied') {
          return Promise.resolve({ sampleID: 'other-sample' });
        }
        return Promise.resolve(null);
      });

      await expect(
        sampleService.createSample(
          db,
          validSampleData({ location: { freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' } })
        )
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rolls back the inserted sample when the ledger append fails', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ patientID: '12345678' });
      db.collections.sample_movements.insertOne.mockRejectedValue(new Error('ledger down'));

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Falha ao registrar cadeia de custódia/
      );
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });
  });

  // -------------------------------------------------------------------
  describe('withdrawSample', () => {
    function existingSample(overrides = {}) {
      return {
        _id: 'sample-1',
        barcode: 'BR-1',
        currentStatus: 'Available',
        quantity: 10,
        originalQuantity: 10,
        availableQuantity: 10,
        totalWithdrawn: 0,
        unit: 'µL',
        ...overrides
      };
    }

    it('performs a total withdrawal and updates the sample', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      const result = await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(result.success).toBe(true);
      expect(result.withdrawnQuantity).toBe(10);
      expect(result.remainingQuantity).toBe(0);
      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.availableQuantity).toBe(0);
    });

    it('performs a partial withdrawal within available quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      const result = await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 4,
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(result.withdrawnQuantity).toBe(4);
      expect(result.remainingQuantity).toBe(6);
    });

    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(
        sampleService.withdrawSample(db, '507f1f77bcf86cd799439011', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow('Amostra não encontrada');
    });

    it('rejects when the sample is already totally withdrawn', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(
        existingSample({ currentStatus: 'TotallyWithdrawn' })
      );

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/não está disponível para retirada/);
    });

    it('rejects an invalid withdrawal type', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Bogus',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Tipo de retirada inválido/);
    });

    it('rejects a responsible name without a surname', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/responsável/);
    });

    it('rejects a missing linkedProject', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: '  '
        })
      ).rejects.toThrow(/Projeto vinculado é obrigatório/);
    });

    it('rejects a partial withdrawal exceeding available quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Parcial',
          withdrawalQuantity: 999,
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Quantidade indisponível/);
    });

    it('rejects a partial withdrawal missing a quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Parcial',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/obrigatória para retirada parcial/);
    });
  });

  // -------------------------------------------------------------------
  describe('getSample', () => {
    it('returns the FHIR-first result when present', async () => {
      const db = makeDb();
      fhirSyncService.getSampleFhirFirst.mockResolvedValue({ _id: 'fhir-1', barcode: 'X' });

      const result = await sampleService.getSample(db, 'fhir-1');
      expect(result._id).toBe('fhir-1');
      expect(db.collections.samples.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the legacy collection when FHIR-first returns nothing', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'legacy-1' });

      const result = await sampleService.getSample(db, 'legacy-1');
      expect(result._id).toBe('legacy-1');
    });
  });

  // -------------------------------------------------------------------
  describe('listSamples', () => {
    it('builds a filtered query and returns paginated results', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ sampleID: 1 }]);
      db.collections.samples.find.mockReturnValue(cursor);
      db.collections.samples.countDocuments.mockResolvedValue(1);

      const result = await sampleService.listSamples(db, {
        patientID: '12345678',
        currentStatus: 'Available',
        sampleType: 'PLASMA',
        limit: 5,
        skip: 1
      });

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        patientID: '12345678',
        currentStatus: 'Available',
        sampleType: 'PLASMA'
      });
      expect(cursor.limit).toHaveBeenCalledWith(5);
      expect(cursor.skip).toHaveBeenCalledWith(1);
      expect(result).toEqual({ samples: [{ sampleID: 1 }], total: 1, limit: 5, skip: 1 });
    });

    it('applies default limit/skip when not specified', async () => {
      const db = makeDb();
      const result = await sampleService.listSamples(db, {});
      expect(result.limit).toBe(50);
      expect(result.skip).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  describe('updateSample', () => {
    it('returns null when the sample does not exist', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      const result = await sampleService.updateSample(db, 'missing', { quantity: 5 });
      expect(result).toBeNull();
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('recomputes lifecycle status and persists the update', async () => {
      const db = makeDb();
      const existing = {
        _id: 'sample-1',
        quantity: 10,
        originalQuantity: 10,
        availableQuantity: 10,
        status: 'AVAILABLE'
      };
      db.collections.samples.findOne
        .mockResolvedValueOnce(existing) // initial lookup
        .mockResolvedValueOnce({ ...existing, availableQuantity: 4 }); // post-update re-fetch

      const result = await sampleService.updateSample(db, 'sample-1', { availableQuantity: 4 });

      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.status).toBe('PARTIAL');
      expect(updateArg.$set.currentStatus).toBe('PartiallyWithdrawn');
      expect(result.availableQuantity).toBe(4);
    });

    it('returns null when updateOne matches nothing', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', quantity: 10 });
      db.collections.samples.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await sampleService.updateSample(db, 'sample-1', { quantity: 5 });
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  describe('deleteSample', () => {
    it('returns true when a sample was deleted', async () => {
      const db = makeDb();
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 1 });

      expect(await sampleService.deleteSample(db, 'sample-1')).toBe(true);
    });

    it('returns false when nothing matched', async () => {
      const db = makeDb();
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 0 });

      expect(await sampleService.deleteSample(db, 'missing')).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleByBarcode', () => {
    it('returns the sample and an anonymized patient on exact match', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        patientID: '12345678'
      });
      db.collections.patients.findOne.mockResolvedValue({
        patientID: '12345678',
        patientName: 'Maria Silva',
        recordNumber: 'RN1'
      });

      const { sample, patient } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(sample._id).toBe('s1');
      expect(patient.patientName).toBe('M. S.');
      expect(patient.patientID).toBe('12345678');
    });

    it('returns nulls when no sample matches any lookup strategy', async () => {
      const db = makeDb();
      // all findOne calls resolve null (default), find() for the debug-log
      // examples query resolves an empty cursor by default too
      const result = await sampleService.getSampleByBarcode(db, 'DOES-NOT-EXIST');
      expect(result).toEqual({ sample: null, patient: null });
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleResults', () => {
    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(sampleService.getSampleResults(db, 'missing')).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('returns the results linked to the sample', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 's1', sampleID: 555001 });
      db.collections.results.find.mockReturnValue(makeCursor([{ resultID: 'r1' }]));

      const results = await sampleService.getSampleResults(db, 's1');
      expect(results).toEqual([{ resultID: 'r1' }]);
      expect(db.collections.results.find).toHaveBeenCalledWith({ sampleID: 555001 });
    });
  });

  // -------------------------------------------------------------------
  describe('getBarcodeIndustrialAssets', () => {
    it('throws for an empty/invalid barcode', async () => {
      await expect(sampleService.getBarcodeIndustrialAssets('   ')).rejects.toThrow(
        'Código de barras inválido para renderização industrial'
      );
    });

    it('generates industrial artifacts for a valid barcode', async () => {
      const assets = await sampleService.getBarcodeIndustrialAssets('BR-2024-001');
      expect(assets.canonicalValue).toBe('BR-2024-001');
      expect(assets.code128.imagePng).toBeDefined();
      expect(assets.dataMatrix.imagePng).toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  describe('returnSample', () => {
    function withdrawnSample(overrides = {}) {
      return {
        _id: 'sample-1',
        barcode: 'BR-1',
        quantity: 10,
        originalQuantity: 10,
        availableQuantity: 4,
        totalWithdrawn: 6,
        totalReturned: 0,
        unit: 'µL',
        ...overrides
      };
    }

    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(
        sampleService.returnSample(db, '507f1f77bcf86cd799439011', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow('Amostra não encontrada');
    });

    it('rejects when there is nothing pending to return', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(
        withdrawnSample({ totalWithdrawn: 5, totalReturned: 5 })
      );

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Não há quantidade pendente de devolução/);
    });

    it('rejects a missing/too-short responsible name', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jo',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Responsável pela devolução é obrigatório/);
    });

    it('rejects a genuinely invalid/unspecified condition', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'not-a-real-condition',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Condição da amostra é obrigatória/);
    });

    it('accepts a PT-BR condition alias from the UI copy and normalizes it', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'Íntegra',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
      expect(result.condition).toBe('intact');
    });

    it('completes a total return with the "intact" condition (observations supplied)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        observations: 'Returned in good condition',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
      expect(result.returnedQuantity).toBe(6);
      expect(result.newAvailableQuantity).toBe(10);
    });

    it('does not require observations for the "intact" condition', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
    });

    it('does not restock the available quantity when the condition is "unusable"', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'unusable',
        observations: 'Sample was damaged in transit',
        returnType: 'Total'
      });

      expect(result.newAvailableQuantity).toBe(4);
    });

    it('rejects a partial return quantity exceeding the pending amount', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          observations: 'n/a',
          returnType: 'Parcial',
          returnQuantity: 999
        })
      ).rejects.toThrow(/Quantidade excede o pendente de devolução/);
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleMovements', () => {
    it('queries movements by sampleID/barcode and sorts by newest first', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ movementID: 2 }, { movementID: 1 }]);
      db.collections.sample_movements.find.mockReturnValue(cursor);

      const movements = await sampleService.getSampleMovements(db, 'sample-1');

      expect(db.collections.sample_movements.find).toHaveBeenCalledWith({
        $or: [{ sampleID: 'sample-1' }, { barcode: 'sample-1' }]
      });
      expect(cursor.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(movements).toEqual([{ movementID: 2 }, { movementID: 1 }]);
    });
  });

  // -------------------------------------------------------------------
  describe('findAvailableSamplesForResearch', () => {
    it('forces currentStatus to AVAILABLE even if the caller requests something else', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ currentStatus: 'AVAILABLE' }]);
      db.collections.samples.find.mockReturnValue(cursor);

      const result = await sampleService.findAvailableSamplesForResearch(db, {
        currentStatus: 'QUARANTINED',
        sampleType: 'PLASMA'
      });

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        sampleType: 'PLASMA',
        currentStatus: 'AVAILABLE'
      });
      expect(result).toEqual([{ currentStatus: 'AVAILABLE' }]);
    });
  });
});
