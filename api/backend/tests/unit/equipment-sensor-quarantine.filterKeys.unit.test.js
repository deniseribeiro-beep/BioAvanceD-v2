/**
 * #917: the sensor and equipment lookups must not key on a field nothing
 * writes.
 *
 * `buildSensorLookup` carried a `{ sensorID: { $in: variants } }` branch and
 * `findEquipmentByMetadata` a `{ id: { $in: variants } }` one. Both were
 * dead by construction:
 *
 *   - **[ran it]** `sensorID` (capital ID) has never been a persisted field.
 *     From the initial commit onward, `SensorModel.create` and
 *     `TemperatureModel.create` write `sensorId: data.sensorId ||
 *     data.sensorID` -- the alias is coalesced away on the way in and never
 *     stored. `git log --all -S sensorID` turns up no writer at any point in
 *     history.
 *   - **[ran it]** `EquipmentModel.create` declares no `id` field,
 *     `equipment.routes.js` is the only insert path into the collection and
 *     it inserts that model's output, and no seed populates `equipment`.
 *
 * This is the #788/#843/#847 class: a filter key nothing writes does not
 * match nothing. The driver serialises a missing value to BSON `null`, so
 * such a branch is inert only while the value handed to it is a non-null
 * string -- it turns live the moment an undefined variant reaches it, which
 * is exactly how #788 happened.
 *
 * `filter-keys.arch.test.js` cannot see either site: both filters are built
 * inside a helper and contain nested braces (`$or`, `$in`), and that guard
 * only reads flat object literals written at the call site. That blindness
 * is #849's scope; this file is the interim pin for the two sites #917
 * cleared, so a re-added branch fails loudly rather than silently.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/equipment-sensor-quarantine.service');

/** Records every filter each collection is queried with, and returns nothing. */
function makeFilterCapturingDb() {
  const filters = { sensors: [], sensorMetadata: [], equipment: [], other: [] };

  const emptyCursor = { toArray: async () => [] };

  function collectionFor(name) {
    const bucket = filters[name] || filters.other;
    return {
      find: vi.fn((filter) => {
        bucket.push(filter);
        return emptyCursor;
      }),
      findOne: vi.fn(async (filter) => {
        bucket.push(filter);
        return null;
      }),
    };
  }

  return {
    db: { collection: vi.fn((name) => collectionFor(name)) },
    filters,
  };
}

/** Every key mentioned anywhere in a filter, including inside $or/$and/$in. */
function collectKeys(node, out = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeys(item, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.add(key);
      collectKeys(value, out);
    }
  }
  return out;
}

describe('#917 sensor/equipment lookups key only on written fields', () => {
  it('queries sensors and sensorMetadata without the never-written sensorID key', async () => {
    const { db, filters } = makeFilterCapturingDb();

    await service.findBoxIdsBySensorKey(db, 'SENSOR-1');

    // Both collections are consulted, and both get the same lookup shape.
    expect(filters.sensors).toHaveLength(1);
    expect(filters.sensorMetadata).toHaveLength(1);

    for (const filter of [...filters.sensors, ...filters.sensorMetadata]) {
      const keys = collectKeys(filter);
      expect(keys.has('sensorID')).toBe(false);
      // The branches that survive are the ones a writer actually produces.
      expect(keys.has('sensorId')).toBe(true);
      expect(keys.has('macAddress')).toBe(true);
      expect(keys.has('$expr')).toBe(true);
    }
  });

  it('leaves the surviving $or branches intact rather than collapsing the lookup', async () => {
    const { db, filters } = makeFilterCapturingDb();

    await service.findBoxIdsBySensorKey(db, 'SENSOR-1');

    // Three branches, down from four -- not two, and not a bare key.
    expect(filters.sensors[0].$or).toHaveLength(3);
    expect(filters.sensors[0].$or[0]).toEqual({ sensorId: { $in: ['SENSOR-1'] } });
  });

  it('does not query at all for an empty sensor key', async () => {
    const { db, filters } = makeFilterCapturingDb();

    const result = await service.findBoxIdsBySensorKey(db, '   ');

    expect(result).toEqual([]);
    expect(filters.sensors).toEqual([]);
    expect(filters.sensorMetadata).toEqual([]);
  });
});
