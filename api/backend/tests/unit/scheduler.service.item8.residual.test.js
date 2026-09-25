import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkStaleTemperatureReadings } = require('../../src/services/scheduler.service');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDb({ sensors, readingsBySensorId }) {
  return {
    collection(name) {
      if (name === 'sensors') {
        return {
          find: () => ({ toArray: async () => sensors }),
        };
      }
      if (name === 'temperatures') {
        return {
          find: ({ sensorId }) => ({
            sort: () => ({
              limit: () => ({
                next: async () => readingsBySensorId[sensorId] || null,
              }),
            }),
          }),
        };
      }
      if (name === 'alerts') {
        return {
          findOne: async () => null,
          insertOne: vi.fn(async () => ({ insertedId: 'alert-1' })),
          updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

describe('scheduler.service item 8 residual normalizeDate branches', () => {
  it('skips sensors whose last reading has no usable timestamp fields', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S-1', organizationId: 'org-1' }],
      readingsBySensorId: {
        'S-1': { sensorId: 'S-1', temperatureValue: 4 },
      },
    });

    const result = await checkStaleTemperatureReadings(db);
    expect(result).toEqual({ sensors: 1, alerts: 0 });
  });

  it('uses dateTime when timestamp is absent and createdAt when both are invalid', async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const alerts = {
      findOne: async () => null,
      insertOne: vi.fn(async () => ({ insertedId: 'alert-stale' })),
      updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
    };
    const db = {
      collection(name) {
        if (name === 'sensors') {
          return { find: () => ({ toArray: async () => [{ sensorID: 'S-legacy' }] }) };
        }
        if (name === 'temperatures') {
          return {
            find: () => ({
              sort: () => ({
                limit: () => ({
                  next: async () => ({ sensorId: 'S-legacy', dateTime: stale }),
                }),
              }),
            }),
          };
        }
        if (name === 'alerts') return alerts;
        throw new Error(`unexpected ${name}`);
      },
    };

    const result = await checkStaleTemperatureReadings(db);
    expect(result.alerts).toBe(1);
    expect(alerts.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      sensorId: 'S-legacy',
      type: 'stale_reading',
    }));
  });

  it('ignores an unparsable createdAt fallback without creating alerts', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S-2' }],
      readingsBySensorId: {
        'S-2': { sensorId: 'S-2', timestamp: 'bad', dateTime: 'also-bad', createdAt: 'still-bad' },
      },
    });

    await expect(checkStaleTemperatureReadings(db)).resolves.toEqual({ sensors: 1, alerts: 0 });
  });
});
