import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const bridge = require('../../../src/services/legacyPlacementChain.service');
const specimenLabel = require('../../../src/services/specimenLabel.service');

// #1378: a query-matching fake. Equality (Dates by instant), `null` as
// missing-or-null, `$in`, and the partial unique indexes a build declares.
// Every read, write and index build is recorded with the options it was given.
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

function createFakeCollection(name, calls) {
  const docs = [];
  const indexes = [];
  return {
    docs,
    async createIndex(keys, options = {}) {
      calls.push({ collection: name, op: 'createIndex', options });
      indexes.push({ keys, options });
    },
    async insertOne(doc, options) {
      calls.push({ collection: name, op: 'insertOne', options });
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
    async updateOne(filter, update, options) {
      calls.push({ collection: name, op: 'updateOne', options });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async findOne(filter, options) {
      calls.push({ collection: name, op: 'findOne', options });
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}, options) {
      calls.push({ collection: name, op: 'find', options });
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)) };
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = {};
  const calls = [];
  const db = {
    collections,
    calls,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, calls);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs);
  return db;
}

const SAMPLE = {
  _id: new ObjectId('64a000000000000000000001'),
  specimenId: 'SPC-2026-0001',
  organizationId: 'org-1',
  primaryContainer: 'cryogenic_vial',
  barcode: 'BVA-260001',
};
const AT = new Date('2026-10-13T12:00:00.000Z');
const SESSION = { id: 'caller-session' };
const ISSUANCE_EVENT = 'specimen-label-issuance:64a000000000000000000001:2026-10-13T12:00:00.000Z';

function loadedSeed() {
  return {
    containers: [{ containerId: 'CT-1', containerType: 'cryogenic_vial', emptyStatus: 'occupied' }],
    specimenContainerAssignments: [{
      specimenContainerAssignmentId: 'SCA-1', specimenId: 'SPC-2026-0001', containerId: 'CT-1',
      loadedAt: new Date('2026-10-01T00:00:00.000Z'), unloadedAt: null, assignmentStatus: 'active', sourceEventId: 'evt-1',
    }],
  };
}

describe('ensureSpecimenContainer (#1378)', () => {
  it('reuses the container a loaded specimen is in, and creates none', async () => {
    const db = createFakeDb(loadedSeed());
    const open = await bridge.ensureSpecimenContainer(db, SAMPLE, { at: AT, sourceEventId: ISSUANCE_EVENT }, SESSION);
    expect(open).toMatchObject({ containerId: 'CT-1', specimenId: 'SPC-2026-0001' });
    expect(db.collections.containers.docs).toHaveLength(1);
    expect(db.collections.specimenContainerAssignments.docs).toHaveLength(1);
  });

  it('adopts the specimen\'s legacy placement before creating a container', async () => {
    const db = createFakeDb({
      storageAssignments: [{
        storageAssignmentId: 'SA-1', specimenId: 'SPC-2026-0001', boxId: '64b000000000000000000001',
        positionCode: 'A1', placedAt: new Date('2026-10-02T00:00:00.000Z'), removedAt: null,
      }],
    });
    const open = await bridge.ensureSpecimenContainer(db, SAMPLE, { at: AT, sourceEventId: ISSUANCE_EVENT }, SESSION);
    expect(db.collections.containers.docs).toHaveLength(1);
    expect(open).toMatchObject({ containerId: db.collections.containers.docs[0].containerId, sourceEventId: 'legacy-storage-assignment:SA-1' });
  });

  it('creates and loads a container for a specimen with none, as a first placement would', async () => {
    const db = createFakeDb();
    const open = await bridge.ensureSpecimenContainer(db, SAMPLE, { at: AT, sourceEventId: ISSUANCE_EVENT }, SESSION);
    const [container] = db.collections.containers.docs;
    expect(container).toMatchObject({ containerType: 'cryogenic_vial', emptyStatus: 'occupied' });
    expect(open).toMatchObject({ specimenId: 'SPC-2026-0001', containerId: container.containerId, loadedAt: AT, sourceEventId: ISSUANCE_EVENT, assignmentStatus: 'active' });
  });
});

describe('specimenLabel.service issueSpecimenLabel (#1378, ELM-0116 -> V2E-0169)', () => {
  it('issues the sample\'s barcode as an unprinted institutional Code 128 label on its new container', async () => {
    const db = createFakeDb();
    const { label, containerId } = await specimenLabel.issueSpecimenLabel(db, SAMPLE, { actorId: 'user-7', at: AT });

    expect(containerId).toBe(db.collections.containers.docs[0].containerId);
    expect(db.collections.specimenContainerAssignments.docs[0]).toMatchObject({ containerId, sourceEventId: ISSUANCE_EVENT });
    expect(label).toMatchObject({
      encodedValue: 'BVA-260001',
      symbology: 'code_128',
      targetType: 'container',
      targetId: containerId,
      identifierOrigin: 'institution_applied',
      namespaceRegistryId: 'legacy-sample-barcode',
      templateVersionId: 'legacy-sample-barcode-label@1.0.0',
      carrierPlacement: 'container_side',
      immutableAtSource: false,
      issuedAt: AT,
      issuedBy: 'user-7',
      printBatchId: null,
      status: 'active',
    });
    expect(label.migratedFrom).toBeUndefined();
    expect(db.collections.labelIdentifiers.docs).toEqual([label]);
  });

  it('issues on the container a loaded specimen already has', async () => {
    const db = createFakeDb(loadedSeed());
    const { label, containerId } = await specimenLabel.issueSpecimenLabel(db, SAMPLE, { code: 'BVA-OTHER', at: AT });
    expect(containerId).toBe('CT-1');
    expect(label).toMatchObject({ targetId: 'CT-1', encodedValue: 'BVA-OTHER' });
    expect(db.collections.containers.docs).toHaveLength(1);
  });

  it('with a session builds no index and runs every read and write in it', async () => {
    const db = createFakeDb();
    await specimenLabel.issueSpecimenLabel(db, SAMPLE, { at: AT, session: SESSION });

    expect(db.calls.filter((call) => call.op === 'createIndex')).toEqual([]);
    expect(db.calls.filter((call) => call.collection === 'labelIdentifiers')).toEqual([{ collection: 'labelIdentifiers', op: 'insertOne', options: { session: SESSION } }]);
    expect(db.calls.filter((call) => call.options?.session !== SESSION)).toEqual([]);
  });

  it('names the issuer: the actor, else the sample\'s organization, else the system (V2E-0176)', async () => {
    const issuer = async (sample, actorId) => (await specimenLabel.issueSpecimenLabel(createFakeDb(), sample, { actorId, at: AT })).label.issuedBy;
    expect(await issuer(SAMPLE, 'user-7')).toBe('user-7');
    expect(await issuer(SAMPLE, null)).toBe('org-1');
    expect(await issuer({ ...SAMPLE, organizationId: null }, undefined)).toBe('system');
  });

  it('refuses a value already active in the namespace with 409 LABEL_EXISTS', async () => {
    const db = createFakeDb();
    await specimenLabel.issueSpecimenLabel(db, SAMPLE, { at: AT });
    const other = { ...SAMPLE, _id: new ObjectId('64a000000000000000000002'), specimenId: 'SPC-2026-0002' };
    await expect(specimenLabel.issueSpecimenLabel(db, other, { code: 'BVA-260001', at: AT })).rejects.toMatchObject({ code: 'LABEL_EXISTS', statusCode: 409 });
  });

  it('a printed issue still needs its print batch (RF016 AC4)', async () => {
    await expect(specimenLabel.issueSpecimenLabel(createFakeDb(), SAMPLE, { at: AT, printed: true }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Identificador institucional exige printBatchId (RF016 AC4)' });
  });

  it('keeps a migrated label\'s provenance as migratedFrom', async () => {
    const db = createFakeDb();
    const provenance = { elementId: 'ELM-0116', sampleId: String(SAMPLE._id), value: 'BVA-260001' };
    const { label } = await specimenLabel.issueSpecimenLabel(db, SAMPLE, { at: AT, provenance });
    expect(label.migratedFrom).toEqual(provenance);
    expect(db.collections.labelIdentifiers.docs[0].migratedFrom).toEqual(provenance);
  });

  it('refuses a blank code, and writes nothing', async () => {
    const db = createFakeDb();
    await expect(specimenLabel.issueSpecimenLabel(db, { ...SAMPLE, barcode: '  ' }, { at: AT })).rejects.toThrow(/obrigatório/);
    await expect(specimenLabel.issueSpecimenLabel(db, { ...SAMPLE, barcode: null }, { at: AT })).rejects.toThrow(/obrigatório/);
    expect(db.calls).toEqual([]);
  });
});
