import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const resolver = require('../../../src/services/labelResolver.service');
const physicalChain = require('../../../src/services/physicalChain.service');

// #1314 (RF016 AC6). A query-matching fake, partial unique indexes included.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}
function createFakeCollection() {
  const docs = [];
  const indexes = [];
  return {
    docs,
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async insertOne(doc) {
      for (const { keys, options } of indexes) {
        if (!options.unique) continue;
        const fields = Object.keys(keys);
        const inScope = (row) => !options.partialFilterExpression || matches(row, options.partialFilterExpression);
        if (inScope(doc) && docs.some((row) => inScope(row) && fields.every((f) => row[f] === doc[f]))) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      docs.push({ ...doc });
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
    async updateOne(filter, update) {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
    },
  };
}
function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection();
      return collections[name];
    },
  };
}

const label = {
  encodedValue: 'BVA2:synthetic:8K3M',
  symbology: 'data_matrix',
  targetType: 'container',
  targetId: 'CT-1',
  identifierOrigin: 'manufacturer_applied',
  namespaceRegistryId: 'ns-tube-vendor',
  carrierPlacement: 'container_bottom',
  immutableAtSource: true,
};
const scan = { rawValue: ']d2BVA2:synthetic:8K3M ', symbology: 'data_matrix', deviceId: 'scanner-1', actorId: 'user-1', correlationId: 'corr-1' };

async function seeded() {
  const db = createFakeDb();
  await physicalChain.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
  await resolver.registerLabel(db, label);
  return db;
}

describe('labelResolver.service (RF016 AC6)', () => {
  it('normalizes away the AIM symbology prefix and surrounding whitespace', () => {
    expect(resolver.normalizeScannedValue(']d2BVA2:synthetic:8K3M ')).toBe('BVA2:synthetic:8K3M');
    expect(resolver.normalizeScannedValue('BVA2:synthetic:8K3M')).toBe('BVA2:synthetic:8K3M');
  });

  it('resolves a tube code to the specimen its container holds, and records the scan', async () => {
    const db = await seeded();
    await physicalChain.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1' });

    const result = await resolver.resolveScan(db, scan);

    expect(result).toMatchObject({ resolved: true, source: 'label', containerId: 'CT-1', specimenId: 'SPC-1' });
    expect(db.collections.scanEvents.docs).toHaveLength(1);
    expect(db.collections.scanEvents.docs[0]).toMatchObject({
      normalizedValue: 'BVA2:synthetic:8K3M', targetType: 'specimen', targetId: 'SPC-1', result: 'resolved', rawValueProtected: null,
    });
  });

  it('refuses a specimen the inScope guard denies, before any ScanEvent is written', async () => {
    const db = await seeded();
    await physicalChain.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1' });

    const asked = [];
    const result = await resolver.resolveScan(db, scan, { inScope: async (specimenId) => { asked.push(specimenId); return false; } });

    expect(result).toMatchObject({ resolved: false, reason: 'OUT_OF_SCOPE' });
    expect(result.specimenId).toBeUndefined();
    expect(asked).toEqual(['SPC-1']);
    expect(db.collections.scanEvents?.docs ?? []).toHaveLength(0);
  });

  it('an empty tube resolves to its container and no specimen, and records no scan (RULE-032)', async () => {
    const db = await seeded();

    const result = await resolver.resolveScan(db, scan);

    expect(result).toMatchObject({ resolved: false, reason: 'EMPTY_CONTAINER', containerId: 'CT-1' });
    expect(db.collections.scanEvents?.docs || []).toHaveLength(0);
  });

  it('refuses an unknown code, and a symbology the policy does not allow', async () => {
    const db = await seeded();
    expect(await resolver.resolveScan(db, { ...scan, rawValue: 'BVA2:other' })).toMatchObject({ resolved: false, reason: 'UNKNOWN_IDENTIFIER' });
    const policy = { allowedSymbologies: ['code_128'] };
    expect(await resolver.resolveScan(db, scan, { policy })).toMatchObject({ resolved: false, reason: 'SYMBOLOGY_NOT_ALLOWED' });
  });

  // #1378 (ELM-0116): a code printed before its label was migrated still
  // resolves through the sample's legacy barcode during the migration window.
  describe('legacy Sample.barcode during the migration window', () => {
    const legacyScan = { ...scan, rawValue: 'BR-2025-001', symbology: 'code_128' };

    it('resolves a legacy code to its specimen and its container, and records one scan', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-1', specimenId: 'SPC-9', barcode: 'BR-2025-001' });
      await physicalChain.createContainer(db, { containerId: 'CT-9', containerType: 'cryovial' });
      await physicalChain.loadSpecimen(db, { specimenId: 'SPC-9', containerId: 'CT-9', sourceEventId: 'evt-9' });

      const result = await resolver.resolveScan(db, legacyScan);

      expect(result).toMatchObject({
        resolved: true, source: 'legacy_barcode', normalizedValue: 'BR-2025-001', label: null, containerId: 'CT-9', specimenId: 'SPC-9',
      });
      expect(db.collections.scanEvents.docs).toHaveLength(1);
      expect(db.collections.scanEvents.docs[0]).toMatchObject({
        normalizedValue: 'BR-2025-001', targetType: 'specimen', targetId: 'SPC-9', operationContext: 'lookup', result: 'resolved',
      });
    });

    it('a legacy sample on no container resolves with a null containerId', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-1', specimenId: 'SPC-9', barcode: 'BR-2025-001' });

      expect(await resolver.resolveScan(db, legacyScan)).toMatchObject({ resolved: true, source: 'legacy_barcode', containerId: null, specimenId: 'SPC-9' });
    });

    it('a value that is both an active label and a legacy barcode resolves through the label', async () => {
      const db = await seeded();
      await physicalChain.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1' });
      await db.collection('samples').insertOne({ _id: 'oid-2', specimenId: 'SPC-OTHER', barcode: 'BVA2:synthetic:8K3M' });

      const result = await resolver.resolveScan(db, scan);

      expect(result).toMatchObject({ resolved: true, source: 'label', containerId: 'CT-1', specimenId: 'SPC-1' });
      expect(db.collections.scanEvents.docs).toHaveLength(1);
    });

    it('a label on an empty container does not fall back to a legacy barcode', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-2', specimenId: 'SPC-OTHER', barcode: 'BVA2:synthetic:8K3M' });

      expect(await resolver.resolveScan(db, scan)).toMatchObject({ resolved: false, reason: 'EMPTY_CONTAINER' });
    });

    it('refuses a legacy sample the inScope guard denies, before any ScanEvent is written', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-1', specimenId: 'SPC-9', barcode: 'BR-2025-001' });

      const asked = [];
      const result = await resolver.resolveScan(db, legacyScan, { inScope: async (specimenId) => { asked.push(specimenId); return false; } });

      expect(result).toMatchObject({ resolved: false, reason: 'OUT_OF_SCOPE' });
      expect(result.specimenId).toBeUndefined();
      expect(asked).toEqual(['SPC-9']);
      expect(db.collections.scanEvents?.docs ?? []).toHaveLength(0);
    });

    it('a value no label and no sample carries is still UNKNOWN_IDENTIFIER', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-1', specimenId: 'SPC-9', barcode: 'BR-2025-001' });

      expect(await resolver.resolveScan(db, { ...legacyScan, rawValue: 'br-2025-001' })).toMatchObject({ resolved: false, reason: 'UNKNOWN_IDENTIFIER' });
      expect(await resolver.resolveScan(db, { ...legacyScan, rawValue: 'BR-2025-002' })).toMatchObject({ resolved: false, reason: 'UNKNOWN_IDENTIFIER' });
      expect(db.collections.scanEvents?.docs ?? []).toHaveLength(0);
    });

    it('a legacy sample with no specimenId resolves to String(_id)', async () => {
      const db = await seeded();
      const _id = { toString: () => '652f1c0a9b1e8a0012345678' };
      await db.collection('samples').insertOne({ _id, barcode: 'BR-2025-001' });

      const result = await resolver.resolveScan(db, legacyScan);

      expect(result).toMatchObject({ resolved: true, source: 'legacy_barcode', specimenId: '652f1c0a9b1e8a0012345678' });
      expect(db.collections.scanEvents.docs[0].targetId).toBe('652f1c0a9b1e8a0012345678');
    });

    it('a barcode stored as a number resolves from its scanned digits', async () => {
      const db = await seeded();
      await db.collection('samples').insertOne({ _id: 'oid-3', specimenId: 'SPC-7', barcode: 20250042 });

      expect(await resolver.resolveScan(db, { ...legacyScan, rawValue: '20250042' })).toMatchObject({
        resolved: true, source: 'legacy_barcode', specimenId: 'SPC-7',
      });
    });
  });

  it('refuses a second active label with the same value in one namespace', async () => {
    const db = await seeded();
    await expect(resolver.registerLabel(db, { ...label, targetId: 'CT-2' })).rejects.toMatchObject({ code: 'LABEL_EXISTS', statusCode: 409 });
  });

  // #1378: an index build beside an open transaction is a write conflict.
  it('with a session builds no index and inserts in the caller\'s session, keeping provenance as migratedFrom', async () => {
    const db = createFakeDb();
    const collection = db.collection('labelIdentifiers');
    const calls = [];
    collection.createIndex = async () => { calls.push('createIndex'); };
    const insertOne = collection.insertOne.bind(collection);
    collection.insertOne = async (doc, options) => { calls.push(options); return insertOne(doc); };
    const session = { id: 'caller-session' };
    const provenance = { elementId: 'ELM-0116', sampleId: 'S-1', value: 'BVA2:synthetic:8K3M' };

    const stored = await resolver.registerLabel(db, label, { session, provenance });

    expect(calls).toEqual([{ session }]);
    expect(stored).toMatchObject({ encodedValue: 'BVA2:synthetic:8K3M', migratedFrom: provenance });
    expect(collection.docs[0].migratedFrom).toEqual(provenance);
  });

  it('passes printed to the model: an institutional label needs a batch unless issued unprinted', async () => {
    const institutional = {
      ...label, symbology: 'code_128', identifierOrigin: 'institution_applied', namespaceRegistryId: 'ns-biobank',
      carrierPlacement: 'container_side', immutableAtSource: false,
      issuedAt: '2026-10-13T12:00:00.000Z', issuedBy: 'user-1', templateVersionId: 'tpl-1',
    };
    const db = createFakeDb();
    await expect(resolver.registerLabel(db, institutional)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 422 });
    expect(await resolver.registerLabel(db, institutional, { printed: false })).toMatchObject({ printBatchId: null });
  });
});
