import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * #1163: a lookup index is ensured where the read it serves runs
 * (utils/lookupIndex.js). Each case below pins one read-path wiring line by
 * its EFFECT -- createIndex on the right collection, with the right key spec
 * and index name -- so deleting the line turns exactly that case red.
 *
 * The helpers latch per resolved collection name for the life of the
 * process, so every case uses its own `collectionName`: a shared one would
 * let the first case build the index and silently suppress the rest.
 */

const { ObjectId } = require('mongodb');
const MongoStorageTopologyReadRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageTopologyReadRepository');
const TelemetryMonitor = require('../../src/infrastructure/services/TelemetryMonitor');
const {
  resolveFreezersByEquipmentIdentifiers,
  findBoxIdsUnderFreezer
} = require('../../src/services/equipment-sensor-quarantine.service');

function cursor(rows = []) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows)
  };
}

function makeCollection(collectionName, { findRows = [], findOne = null } = {}) {
  return {
    collectionName,
    createIndex: vi.fn(async () => 'ok'),
    dropIndex: vi.fn(async () => undefined),
    find: vi.fn(() => cursor(findRows)),
    findOne: vi.fn(async () => findOne),
    countDocuments: vi.fn(async () => 0)
  };
}

function makeDb(collections) {
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    })
  };
}

function indexNames(collection) {
  return collection.createIndex.mock.calls.map(([, options]) => options && options.name);
}

// The helpers are called un-awaited, so let their promise chains settle.
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('#1163: storage lookup indexes are ensured on their read paths', () => {
  it('listOperationalFreezers ensures the containerType/status lookup', async () => {
    const storageContainers = makeCollection('sc_1163_list');
    const repo = new MongoStorageTopologyReadRepository(makeDb({ storageContainers }));

    await repo.listOperationalFreezers();
    await settle();

    expect(storageContainers.createIndex).toHaveBeenCalledWith(
      { containerType: 1, status: 1 },
      { name: 'storage_containers_type_status_idx_v1' }
    );
  });

  it('getFreezerTree ensures both parent_id lookups', async () => {
    const storageContainers = makeCollection('sc_1163_tree', { findOne: null });
    const storageBoxes = makeCollection('sb_1163_tree');
    const repo = new MongoStorageTopologyReadRepository(makeDb({ storageContainers, storageBoxes }));

    await repo.getFreezerTree({ freezerId: new ObjectId().toString() });
    await settle();

    expect(indexNames(storageContainers)).toContain('storage_containers_parent_type_idx_v1');
    expect(storageBoxes.createIndex).toHaveBeenCalledWith(
      { parent_id: 1, status: 1 },
      { name: 'storage_boxes_parent_status_idx_v1' }
    );
  });

  it('TelemetryMonitor.resolveBoxIdsUnderFreezer ensures both parent_id lookups', async () => {
    const shelfId = new ObjectId();
    const rackId = new ObjectId();
    const storageContainers = makeCollection('sc_1163_telemetry');
    storageContainers.find
      .mockReturnValueOnce(cursor([{ _id: shelfId }]))
      .mockReturnValueOnce(cursor([{ _id: rackId }]));
    const storageBoxes = makeCollection('sb_1163_telemetry');
    const monitor = new TelemetryMonitor({ db: makeDb({ storageContainers, storageBoxes }) });

    await monitor.resolveBoxIdsUnderFreezer(new ObjectId());
    await settle();

    expect(indexNames(storageContainers)).toContain('storage_containers_parent_type_idx_v1');
    expect(indexNames(storageBoxes)).toContain('storage_boxes_parent_status_idx_v1');
  });

  it('equipment-sensor-quarantine resolveFreezersByEquipmentIdentifiers ensures the containerID index', async () => {
    const storageContainers = makeCollection('sc_1163_resolve');

    await resolveFreezersByEquipmentIdentifiers(makeDb({ storageContainers }), ['EQ-1']);
    await settle();

    expect(indexNames(storageContainers)).toContain('storage_containers_containerid_unique_v3');
  });

  it('equipment-sensor-quarantine findBoxIdsUnderFreezer ensures both parent_id lookups', async () => {
    const storageContainers = makeCollection('sc_1163_quarantine');
    const storageBoxes = makeCollection('sb_1163_quarantine');

    await findBoxIdsUnderFreezer(makeDb({ storageContainers, storageBoxes }), new ObjectId());
    await settle();

    expect(indexNames(storageContainers)).toContain('storage_containers_parent_type_idx_v1');
    expect(indexNames(storageBoxes)).toContain('storage_boxes_parent_status_idx_v1');
  });
});

// terminologies.routes.js takes `authenticate` when it is required (#1553).
const authModule = require('../../src/infrastructure/middleware/auth');
authModule.authenticate = (req, res, next) => {
  req.user = { id: 'user-1' };
  next();
};

describe('#1163: GET /api/terminologies ensures its { sistema, codigo } lookup', () => {
  function buildApp(db) {
    delete require.cache[require.resolve('../../src/interface/routes/terminologies.routes')];
    const router = require('../../src/interface/routes/terminologies.routes');
    const app = express();
    app.use(express.json());
    app.locals.db = db;
    app.use('/api/terminologies', router);
    return app;
  }

  it('ensureTerminologyLookupIndexes builds once per collection name, so the read path pays one Set.has', async () => {
    const { ensureTerminologyLookupIndexes } = require('../../src/services/terminologySync.service');
    const terminologies = makeCollection('terminologies_1163_latch');

    await ensureTerminologyLookupIndexes(terminologies);
    await ensureTerminologyLookupIndexes(terminologies);

    expect(terminologies.createIndex).toHaveBeenCalledTimes(1);
  });

  it('builds terminologies_sistema_codigo_idx_v1 on the list read, not only on a write', async () => {
    const terminologies = makeCollection('terminologies_1163_list');
    const app = buildApp(makeDb({ terminologies }));

    const res = await request(app).get('/api/terminologies');
    await settle();

    expect(res.status).toBe(200);
    expect(terminologies.createIndex).toHaveBeenCalledWith(
      { sistema: 1, codigo: 1 },
      { name: 'terminologies_sistema_codigo_idx_v1' }
    );
    // The listing wrote nothing, so the write-path unique index is untouched.
    expect(indexNames(terminologies)).not.toContain('terminologies_sistema_codigo_unique_v3');
  });
});
