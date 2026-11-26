import { describe, it, expect } from 'vitest';
const { INDEX_TARGETS, buildFoundationIndexes, verifyFoundationIndexes } = require('../../../src/foundation/indexes');
const { ensureSessionIndexes } = require('../../../src/utils/sessionIndexes');
const { ensureTerminologyConceptIndexes, ensureTerminologyRelationIndexes } = require('../../../src/utils/terminologyIndexes');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('./helpers/fake-db');

/**
 * RF022 AC2: the Foundation job builds every model index before the APIs
 * start and learns which builds failed, although each helper swallows its
 * own errors so its request path keeps serving.
 *
 * The helpers latch per process by collection name, so the full-target
 * build runs first in this file, and the failure case uses a collection
 * name no other test has latched.
 */
describe('Foundation index builds', () => {
  it('builds an index on every target collection, and every build reads back', async () => {
    const db = createFakeDb();
    const builds = await buildFoundationIndexes(db);

    for (const { collection } of INDEX_TARGETS) {
      expect(db.collection(collection).indexes.length, collection).toBeGreaterThan(1);
      expect(builds.some((build) => build.collection === collection), collection).toBe(true);
    }
    expect(builds.every((build) => build.ok === true)).toBe(true);
    expect(builds.some((build) => build.unique)).toBe(true);
    expect(await verifyFoundationIndexes(db, builds)).toEqual([]);
  });

  // #1374: a chain write inside a caller's session builds no index, so the
  // Foundation job builds the chain's and StorageLocation's partial unique
  // indexes beforehand.
  it('builds the physical chain and StorageLocation indexes by name', async () => {
    const chainCollections = [
      CANONICAL_COLLECTIONS.containers,
      CANONICAL_COLLECTIONS.specimenContainerAssignments,
      CANONICAL_COLLECTIONS.containerPositionAssignments,
      CANONICAL_COLLECTIONS.rackLocationAssignments,
      CANONICAL_COLLECTIONS.storageLocations,
    ];
    const targeted = INDEX_TARGETS.map((target) => target.collection);
    for (const collection of chainCollections) expect(targeted, collection).toContain(collection);

    const builds = await buildFoundationIndexes(createFakeDb());
    const named = (name) => builds.find((build) => build.name === name);
    for (const [name, collection] of [
      ['uniq_containerId', CANONICAL_COLLECTIONS.containers],
      ['uniq_open_specimen', CANONICAL_COLLECTIONS.specimenContainerAssignments],
      ['uniq_open_container', CANONICAL_COLLECTIONS.containerPositionAssignments],
      ['uniq_open_position', CANONICAL_COLLECTIONS.containerPositionAssignments],
      ['uniq_open_rack', CANONICAL_COLLECTIONS.rackLocationAssignments],
      ['uniq_storageLocationId', CANONICAL_COLLECTIONS.storageLocations],
      ['uniq_active_label_value', CANONICAL_COLLECTIONS.labelIdentifiers],
    ]) {
      expect(named(name), name).toMatchObject({ collection, unique: true, ok: true });
    }
  });

  // #1392 (RF009 AC5/AC6): a stored exposure summary is unique by its id.
  it('builds the TelemetryExposureSummary unique id index by name', async () => {
    const builds = await buildFoundationIndexes(createFakeDb());
    expect(builds.find((build) => build.name === 'uniq_telemetryExposureSummaryId')).toMatchObject({
      collection: CANONICAL_COLLECTIONS.telemetryExposureSummaries, unique: true, ok: true,
    });
  });

  // #1561 (RF028): the natural keys the reference promotion looks up.
  it('builds the TerminologyConcept and TerminologyRelation natural-key unique indexes by name (#1561)', async () => {
    const builds = await buildFoundationIndexes(createFakeDb());
    expect(builds.find((build) => build.name === 'uniq_terminologyConcept_systemUri_code_version')).toMatchObject({
      collection: CANONICAL_COLLECTIONS.terminologyConcepts, keys: { systemUri: 1, code: 1, version: 1 }, unique: true, ok: true,
    });
    expect(builds.find((build) => build.name === 'uniq_terminologyRelation_source_target_type_version')).toMatchObject({
      collection: CANONICAL_COLLECTIONS.terminologyRelations,
      keys: { sourceConceptId: 1, targetConceptId: 1, relationType: 1, relationVersion: 1 },
      unique: true,
      ok: true,
    });
  });

  // #1561: a unique natural-key build over rows that already share a key is
  // refused before createIndex, with an error naming the duplicate keys, and
  // the Foundation job records that refusal as a failed unique build.
  describe('terminology natural-key duplicate check (#1561)', () => {
    // The $group / $match count / $limit pipeline the check issues, run over
    // the fake collection's rows.
    function withAggregate(collection, created) {
      collection.aggregate = (pipeline) => {
        const [{ $group }, { $match }, { $limit }] = pipeline;
        const fields = Object.entries($group._id).map(([key, path]) => [key, path.slice(1)]);
        const groups = new Map();
        for (const doc of collection.docs) {
          const id = Object.fromEntries(fields.map(([key, path]) => [key, doc[path]]));
          const at = JSON.stringify(id);
          if (!groups.has(at)) groups.set(at, { _id: id, count: 0 });
          groups.get(at).count += 1;
        }
        const rows = [...groups.values()].filter((group) => group.count > $match.count.$gt).slice(0, $limit);
        return { toArray: async () => rows };
      };
      const createIndex = collection.createIndex.bind(collection);
      collection.createIndex = (keys, options) => {
        created.push(options.name);
        return createIndex(keys, options);
      };
      return collection;
    }

    const conceptRow = (code, n) => ({
      terminologyConceptId: `tc-${code}-${n}`, systemUri: 'http://www.orpha.net', code, version: 'e2e-696',
    });

    it('throws naming the duplicate key and builds no index when two concepts share one key', async () => {
      const created = [];
      const concepts = withAggregate(createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyConcepts), created);
      concepts.docs.push(conceptRow('ORPHA:558', 1), conceptRow('ORPHA:558', 2), conceptRow('ORPHA:365', 1));

      const error = await ensureTerminologyConceptIndexes(concepts).then(() => null, (thrown) => thrown);
      expect(error).toMatchObject({ code: 'DUPLICATE_NATURAL_KEY' });
      expect(error.message).toContain('{"systemUri":"http://www.orpha.net","code":"ORPHA:558","version":"e2e-696"} x2');
      expect(error.message).toContain('troubleshooting-runbook.md');
      expect(error.message).not.toContain('ORPHA:365');
      expect(created).toEqual([]);
    });

    it('builds the index as before when no two concepts share a key', async () => {
      const created = [];
      const concepts = withAggregate(createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyConcepts), created);
      concepts.docs.push(conceptRow('ORPHA:558', 1), conceptRow('ORPHA:365', 1));

      await ensureTerminologyConceptIndexes(concepts);
      expect(created).toEqual(['uniq_terminologyConcept_systemUri_code_version']);
    });

    it('checks the relation natural key the same way', async () => {
      const created = [];
      const relations = withAggregate(createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyRelations), created);
      const relation = { sourceConceptId: 'a', targetConceptId: 'b', relationType: 'is_a', relationVersion: 'v1' };
      relations.docs.push({ ...relation, terminologyRelationId: 'r1' }, { ...relation, terminologyRelationId: 'r2' });

      await expect(ensureTerminologyRelationIndexes(relations)).rejects.toThrow('"sourceConceptId":"a","targetConceptId":"b"');
      expect(created).toEqual([]);
    });

    it('skips the duplicate scan and the build when the unique index is already there', async () => {
      const created = [];
      const concepts = createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyConcepts);
      await concepts.createIndex({ systemUri: 1, code: 1, version: 1 }, { unique: true, name: 'uniq_terminologyConcept_systemUri_code_version' });
      withAggregate(concepts, created);
      let scans = 0;
      const aggregate = concepts.aggregate;
      concepts.aggregate = (...args) => { scans += 1; return aggregate(...args); };

      await ensureTerminologyConceptIndexes(concepts);
      expect(scans).toBe(0);
      expect(created).toEqual([]);
    });

    it('still scans and builds when only a non-unique index has the same keys', async () => {
      const created = [];
      const concepts = createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyConcepts);
      await concepts.createIndex({ systemUri: 1, code: 1, version: 1 }, { name: 'lookup_systemUri_code_version' });
      withAggregate(concepts, created);
      concepts.docs.push(conceptRow('ORPHA:558', 1), conceptRow('ORPHA:558', 2));

      await expect(ensureTerminologyConceptIndexes(concepts)).rejects.toMatchObject({ code: 'DUPLICATE_NATURAL_KEY' });
      expect(created).toEqual([]);
    });

    it('reads a collection that does not exist yet as holding no index, and builds', async () => {
      const created = [];
      const concepts = withAggregate(createFakeDb().collection(CANONICAL_COLLECTIONS.terminologyConcepts), created);
      concepts.listIndexes = () => ({
        toArray: async () => { throw Object.assign(new Error('ns does not exist'), { code: 26 }); },
      });

      await ensureTerminologyConceptIndexes(concepts);
      expect(created).toEqual(['uniq_terminologyConcept_systemUri_code_version']);
    });

    it('records a failed unique build, with its message, when the duplicate scan itself fails', async () => {
      const db = createFakeDb();
      const concepts = db.collection(CANONICAL_COLLECTIONS.terminologyConcepts);
      const created = [];
      withAggregate(concepts, created);
      concepts.aggregate = () => ({ toArray: async () => { throw new Error('operation exceeded time limit'); } });

      const error = await ensureTerminologyConceptIndexes(concepts).then(() => null, (thrown) => thrown);
      expect(error.indexBuild).toEqual({
        keys: { systemUri: 1, code: 1, version: 1 }, name: 'uniq_terminologyConcept_systemUri_code_version', unique: true,
      });

      const builds = await buildFoundationIndexes(db, [
        { collection: CANONICAL_COLLECTIONS.terminologyConcepts, ensure: ensureTerminologyConceptIndexes },
      ]);
      expect(builds).toEqual([{
        collection: CANONICAL_COLLECTIONS.terminologyConcepts,
        keys: { systemUri: 1, code: 1, version: 1 },
        name: 'uniq_terminologyConcept_systemUri_code_version',
        unique: true,
        ok: false,
        error: 'operation exceeded time limit',
      }]);
      expect(await verifyFoundationIndexes(db, builds)).toEqual(builds);
      expect(created).toEqual([]);
    });

    it('records the refusal as a failed unique build carrying the duplicate keys', async () => {
      const db = createFakeDb();
      withAggregate(db.collection(CANONICAL_COLLECTIONS.terminologyConcepts), []);
      db.collection(CANONICAL_COLLECTIONS.terminologyConcepts).docs.push(conceptRow('ORPHA:558', 1), conceptRow('ORPHA:558', 2));

      const builds = await buildFoundationIndexes(db, [
        { collection: CANONICAL_COLLECTIONS.terminologyConcepts, ensure: ensureTerminologyConceptIndexes },
      ]);
      expect(builds).toHaveLength(1);
      expect(builds[0]).toMatchObject({
        collection: CANONICAL_COLLECTIONS.terminologyConcepts,
        name: 'uniq_terminologyConcept_systemUri_code_version',
        keys: { systemUri: 1, code: 1, version: 1 },
        unique: true,
        ok: false,
      });
      expect(builds[0].error).toContain('"code":"ORPHA:558"');
      expect(builds[0]).not.toHaveProperty('settled');
      expect(await verifyFoundationIndexes(db, builds)).toEqual(builds);
    });
  });

  // #1402 (ELM-0275): one BiomarkerAssociation row per biomarkerId.
  it('builds the BiomarkerAssociation unique biomarkerId index by name (#1402)', async () => {
    const builds = await buildFoundationIndexes(createFakeDb());
    expect(builds.find((build) => build.name === 'uniq_biomarkerId')).toMatchObject({
      collection: 'biomarkerAssociations', keys: { biomarkerId: 1 }, unique: true, ok: true,
    });
  });

  // #1405 (ELM-0326): one WorkflowRun per workflowRunId.
  it('builds the WorkflowRun unique workflowRunId index by name (#1405)', async () => {
    const builds = await buildFoundationIndexes(createFakeDb());
    expect(builds.find((build) => build.name === 'uniq_workflowRunId')).toMatchObject({
      collection: 'workflowRuns', keys: { workflowRunId: 1 }, unique: true, ok: true,
    });
  });

  it('reports a build whose index is gone on read-back', async () => {
    const db = createFakeDb();
    const builds = [{ collection: 'facilities', keys: { name: 1 }, name: 'facilities_name_idx_v1', unique: false, ok: true }];
    await db.collection('facilities').createIndex({ name: 1 }, { name: 'facilities_name_idx_v1' });
    expect(await verifyFoundationIndexes(db, builds)).toEqual([]);

    await db.collection('facilities').dropIndex('facilities_name_idx_v1');
    expect(await verifyFoundationIndexes(db, builds)).toEqual(builds);
  });

  it('records a failed build that the helper itself swallows', async () => {
    const db = createFakeDb({
      'sessions-failing': () => ({
        createIndex: async () => {
          throw new Error('index build interrupted');
        },
      }),
    });
    const builds = await buildFoundationIndexes(db, [{ collection: 'sessions-failing', ensure: ensureSessionIndexes }]);

    expect(builds.length).toBeGreaterThan(0);
    expect(builds.every((build) => build.ok === false && build.error === 'index build interrupted')).toBe(true);
    expect(await verifyFoundationIndexes(db, builds)).toHaveLength(builds.length);
  });
});
