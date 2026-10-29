import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { migrateSampleBarcodeLabels } = require('../../src/scripts/migrateSampleBarcodeLabels');

// The Sample.barcode backfill (#1378, ELM-0116 -> V2E-0169): each stored
// sample's code is issued as a LabelIdentifier on its one container, keeping
// its provenance. A label already issued is left alone, a value active for
// another target or carrying personal data (RULE-012) is listed, not written,
// and the sample document is never modified.

// A query-matching fake: equality (Dates by instant), `null` as
// missing-or-null, `$in`, and the partial unique indexes a build declares.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === null || doc[key] === undefined;
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.some((option) => same(doc[key], option));
    return same(doc[key], value);
  });
}

function createFakeCollection(name, writes) {
  const docs = [];
  const indexes = [];
  return {
    docs,
    async createIndex(keys, options = {}) {
      indexes.push({ keys, options });
    },
    async insertOne(doc) {
      writes.push({ collection: name, op: 'insertOne' });
      for (const { keys, options: index } of indexes) {
        if (!index.unique) continue;
        const inScope = (row) => !index.partialFilterExpression || matches(row, index.partialFilterExpression);
        if (inScope(doc) && docs.some((row) => inScope(row) && Object.keys(keys).every((f) => row[f] === doc[f]))) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async updateOne(filter, update) {
      writes.push({ collection: name, op: 'updateOne' });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async findOne(filter) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) };
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = {};
  const writes = [];
  const db = {
    collections,
    writes,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, writes);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs.map((doc) => ({ ...doc })));
  return db;
}

const REGISTERED = new Date('2026-03-01T09:00:00.000Z');

const LOADED = {
  _id: new ObjectId('64a000000000000000000001'),
  specimenId: 'SPC-2026-0001',
  organizationId: 'org-1',
  barcode: 'BVA-260001',
  registeredAt: REGISTERED,
};
const UNLOADED = {
  _id: new ObjectId('64a000000000000000000002'),
  specimenId: 'SPC-2026-0002',
  primaryContainer: 'cryogenic_vial',
  barcode: 'BVA-260002',
  createdAt: REGISTERED,
};

function loadedSeed() {
  return {
    containers: [{ containerId: 'CT-1', containerType: 'cryogenic_vial', emptyStatus: 'occupied' }],
    specimenContainerAssignments: [{
      specimenContainerAssignmentId: 'SCA-1', specimenId: 'SPC-2026-0001', containerId: 'CT-1',
      loadedAt: new Date('2026-10-01T00:00:00.000Z'), unloadedAt: null, assignmentStatus: 'active', sourceEventId: 'evt-1',
    }],
  };
}

const labelFor = (db, value) => db.collections.labelIdentifiers?.docs.find((label) => label.encodedValue === value);
const writesTo = (db, name) => db.writes.filter((write) => write.collection === name);

describe('migrateSampleBarcodeLabels (#1378)', () => {
  it('issues a sample\'s barcode as an unprinted label keeping its provenance, on the container it is loaded in', async () => {
    const db = createFakeDb({ ...loadedSeed(), samples: [LOADED] });
    const summary = await migrateSampleBarcodeLabels(db);

    expect(summary).toMatchObject({ mode: 'apply', scanned: 1, issued: 1, unchanged: 0, conflicts: [], refused: [] });
    expect(labelFor(db, 'BVA-260001')).toMatchObject({
      targetType: 'container',
      targetId: 'CT-1',
      namespaceRegistryId: 'legacy-sample-barcode',
      status: 'active',
      issuedAt: REGISTERED,
      issuedBy: 'org-1',
      printBatchId: null,
      migratedFrom: { elementId: 'ELM-0116', sampleId: '64a000000000000000000001', value: 'BVA-260001' },
    });
    expect(db.collections.containers.docs).toHaveLength(1);
  });

  it('creates and loads a container for a sample with none, and attributes the label to the system', async () => {
    const db = createFakeDb({ samples: [UNLOADED] });
    await migrateSampleBarcodeLabels(db);

    const [container] = db.collections.containers.docs;
    expect(container).toMatchObject({ containerType: 'cryogenic_vial' });
    expect(db.collections.specimenContainerAssignments.docs[0]).toMatchObject({ specimenId: 'SPC-2026-0002', containerId: container.containerId });
    expect(labelFor(db, 'BVA-260002')).toMatchObject({ targetId: container.containerId, issuedAt: REGISTERED, issuedBy: 'system' });
  });

  it('never modifies the sample document', async () => {
    const db = createFakeDb({ ...loadedSeed(), samples: [LOADED, UNLOADED] });
    await migrateSampleBarcodeLabels(db);

    expect(writesTo(db, 'samples')).toEqual([]);
    expect(db.collections.samples.docs).toEqual([LOADED, UNLOADED]);
  });

  it('writes nothing on a second run and counts every sample unchanged', async () => {
    const db = createFakeDb({ ...loadedSeed(), samples: [LOADED, UNLOADED] });
    await migrateSampleBarcodeLabels(db);
    const before = db.writes.length;
    const second = await migrateSampleBarcodeLabels(db);

    expect(db.writes.length).toBe(before);
    expect(second).toMatchObject({ scanned: 2, issued: 0, unchanged: 2, conflicts: [], refused: [] });
    expect(db.collections.labelIdentifiers.docs).toHaveLength(2);
  });

  it('writes nothing under dryRun and returns the same counts', async () => {
    const seed = () => ({ ...loadedSeed(), samples: [LOADED, UNLOADED, { _id: 'r3', barcode: '  ' }] });
    const db = createFakeDb(seed());
    const dry = await migrateSampleBarcodeLabels(db, { dryRun: true });

    expect(db.writes).toEqual([]);
    expect(dry).toMatchObject({ mode: 'dry-run', scanned: 3, issued: 2, skippedBlank: 1 });
    const applied = await migrateSampleBarcodeLabels(createFakeDb(seed()));
    expect({ ...dry, mode: undefined }).toEqual({ ...applied, mode: undefined });
  });

  it('lists a value already active for another target, and writes nothing for it', async () => {
    const db = createFakeDb({
      ...loadedSeed(),
      samples: [LOADED],
      labelIdentifiers: [{ encodedValue: 'BVA-260001', namespaceRegistryId: 'legacy-sample-barcode', status: 'active', targetType: 'container', targetId: 'CT-OTHER' }],
    });
    const summary = await migrateSampleBarcodeLabels(db);

    expect(summary).toMatchObject({ issued: 0, unchanged: 0, conflicts: [{ sampleId: '64a000000000000000000001', value: 'BVA-260001' }] });
    expect(db.writes).toEqual([]);
  });

  it('refuses a CPF-shaped value with the reason and without the value (RULE-012), and writes nothing for it', async () => {
    const db = createFakeDb({ samples: [{ ...UNLOADED, barcode: '52998224725' }] });
    const summary = await migrateSampleBarcodeLabels(db);

    expect(summary.issued).toBe(0);
    expect(summary.refused).toEqual([{ sampleId: '64a000000000000000000002', reason: 'encodedValue não pode conter um CPF (RULE-012)' }]);
    expect(db.writes).toEqual([]);
  });

  it('migrates a numeric barcode as its string, and skips a blank one', async () => {
    const db = createFakeDb({ samples: [{ ...UNLOADED, barcode: 260002 }, { _id: 'r3', barcode: null }, { _id: 'r4' }] });
    const summary = await migrateSampleBarcodeLabels(db);

    expect(summary).toMatchObject({ scanned: 3, issued: 1, skippedBlank: 2 });
    expect(labelFor(db, '260002')).toMatchObject({ migratedFrom: { value: '260002' } });
  });
});
