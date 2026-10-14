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

    expect(result).toMatchObject({ resolved: true, containerId: 'CT-1', specimenId: 'SPC-1' });
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
