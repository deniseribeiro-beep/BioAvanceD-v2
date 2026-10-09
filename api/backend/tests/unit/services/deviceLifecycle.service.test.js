import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/deviceLifecycle.service');
const Model = require('../../../src/models/DeviceLifecycleEvent');

// #1316, RF017 AC6/AC8: registration, the lifecycle history and the
// usability block. A query-matching fake whose filters treat a missing
// field as null, as Mongo does.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => (value === null ? doc[key] == null : doc[key] === value));
}

function createFakeCollection() {
  const docs = [];
  const indexes = [];
  return {
    docs,
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async insertOne(doc) {
      for (const { keys, options } of indexes) {
        const [field] = Object.keys(keys);
        if (options.unique && docs.some((row) => row[field] === doc[field])) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
    async updateOne(filter, update) {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
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

async function expectRefusal(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({ name: 'DeviceError', code, statusCode });
}

describe('deviceLifecycle.service (#1316, RF017 AC6/AC8)', () => {
  let db;
  const register = (over = {}) => service.registerDevice(db, { deviceId: 'dev-1', deviceType: 'freezer', ...over });

  beforeEach(() => { db = createFakeDb(); });

  it('registers a device not homologated, with its maintenance records (ELM-0315)', async () => {
    const device = await register({ maintenanceRecords: ['maint-1'], calibrationDueDate: '2027-01-01' });
    expect(device).toMatchObject({ deviceId: 'dev-1', qualificationStatus: 'pending', maintenanceRecords: ['maint-1'], currentLocationId: null });
    expect(device.calibrationDueDate).toEqual(new Date('2027-01-01'));
    await expectRefusal(register(), 'DEVICE_EXISTS', 409);
    await expectRefusal(register({ deviceId: '' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(register({ deviceId: 'dev-2', deviceType: '' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(register({ deviceId: 'dev-3', maintenanceRecords: 'maint-1' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(register({ deviceId: 'dev-4', calibrationDate: 'soon' }), 'VALIDATION_ERROR', 422);
  });

  it('records installation, movement, homologation and retirement, and keeps the history (AC6)', async () => {
    await register();
    await service.recordEvent(db, 'dev-1', { eventType: 'installed', locationId: 'room-1', occurredAt: '2026-01-01T00:00:00Z' });
    await service.recordEvent(db, 'dev-1', { eventType: 'qualified', evidenceUri: 'object://iq-oq-pq.pdf', occurredAt: '2026-01-02T00:00:00Z' });
    await service.recordEvent(db, 'dev-1', { eventType: 'moved', locationId: 'room-2', occurredAt: '2026-01-03T00:00:00Z' });
    const { device } = await service.recordEvent(db, 'dev-1', { eventType: 'retired', reason: 'fim de vida', occurredAt: '2026-01-04T00:00:00Z' });

    expect(device).toMatchObject({ currentLocationId: null, qualificationStatus: 'qualified' });
    expect(device.retiredAt).toEqual(new Date('2026-01-04T00:00:00Z'));
    const read = await service.getDevice(db, 'dev-1');
    expect(read.history.map((e) => e.eventType)).toEqual(['installed', 'qualified', 'moved', 'retired']);
    expect(read.history[2].locationId).toBe('room-2');
  });

  it('refuses an event its state does not admit (409), and retirement is final', async () => {
    await register();
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'moved', locationId: 'room-2' }), 'LIFECYCLE_CONFLICT', 409);
    await service.recordEvent(db, 'dev-1', { eventType: 'installed', locationId: 'room-1' });
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'installed', locationId: 'room-2' }), 'LIFECYCLE_CONFLICT', 409);
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'moved', locationId: 'room-1' }), 'LIFECYCLE_CONFLICT', 409);
    await service.recordEvent(db, 'dev-1', { eventType: 'retired', reason: 'avaria' });
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'qualified', evidenceUri: 'object://x.pdf' }), 'LIFECYCLE_CONFLICT', 409);
    expect(db.collections.deviceLifecycleEvents.docs).toHaveLength(2);
  });

  it("refuses an event missing what its type requires, and an unknown device's", async () => {
    await register();
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'installed' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'qualified' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'retired' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(service.recordEvent(db, 'dev-1', { eventType: 'repaired' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(service.recordEvent(db, 'dev-x', { eventType: 'qualified', evidenceUri: 'object://x.pdf' }), 'DEVICE_NOT_FOUND', 404);
  });

  it('a device seeded before the lifecycle, with no derived fields, takes its first event', async () => {
    await db.collection('devices').insertOne({ deviceId: 'legacy-1', deviceType: 'freezer', qualificationStatus: 'qualified' });
    const { device } = await service.recordEvent(db, 'legacy-1', { eventType: 'installed', locationId: 'room-1' });
    expect(device.currentLocationId).toBe('room-1');
  });

  it('blocks an unregistered, unhomologated, withdrawn or retired device (AC8)', async () => {
    expect(await service.deviceUsabilityRefusal(db, 'dev-1')).toMatch('não registrado');
    expect(await service.deviceUsabilityRefusal(db, undefined)).toMatch('não registrado');
    await register();
    expect(await service.deviceUsabilityRefusal(db, 'dev-1')).toMatch('não homologado');
    await service.recordEvent(db, 'dev-1', { eventType: 'qualified', evidenceUri: 'object://x.pdf' });
    expect(await service.deviceUsabilityRefusal(db, 'dev-1')).toBeNull();
    await service.recordEvent(db, 'dev-1', { eventType: 'disqualified', reason: 'calibração vencida' });
    expect(await service.deviceUsabilityRefusal(db, 'dev-1')).toMatch('não homologado');
    await service.recordEvent(db, 'dev-1', { eventType: 'qualified', evidenceUri: 'object://y.pdf' });
    await service.recordEvent(db, 'dev-1', { eventType: 'retired', reason: 'fim de vida' });
    expect(await service.deviceUsabilityRefusal(db, 'dev-1')).toMatch('retirado');
  });

  it('the model lists the five event types', () => {
    expect(Model.EVENT_TYPES).toEqual(['installed', 'moved', 'qualified', 'disqualified', 'retired']);
  });
});
