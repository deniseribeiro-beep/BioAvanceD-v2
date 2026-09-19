import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/equipment-sensor-quarantine.service');

function emptyFind() {
  return { toArray: vi.fn(async () => []) };
}

describe('equipment/sensor quarantine item 8 residual canonical branches', () => {
  it('accepts sensorID as the cold-chain incident input alias without inventing a persisted sensorID field', async () => {
    const db = {
      collection: vi.fn((name) => {
        if (name === 'sensors' || name === 'sensorMetadata') {
          return { find: vi.fn(() => emptyFind()) };
        }
        if (name === 'storageContainers') {
          return { find: vi.fn(() => emptyFind()) };
        }
        if (name === 'storageBoxes') {
          return { find: vi.fn(() => emptyFind()) };
        }
        if (name === 'equipment') {
          return { findOne: vi.fn(async () => null) };
        }
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const result = await service.quarantineByColdChainIncident(db, {
      sensorID: 'SEN-ALIAS',
      status: 'open',
    });

    expect(result).toMatchObject({
      triggered: true,
      matched: 0,
      quarantined: 0,
      movements: 0,
      incidentId: 'SEN-ALIAS',
      sensorKey: 'SEN-ALIAS',
    });
    expect(result.reason).toContain('SEN-ALIAS');
  });

  it('returns the canonical missing-sensor-key no-op for an empty incident', async () => {
    await expect(service.quarantineByColdChainIncident({}, {})).resolves.toEqual({
      triggered: false,
      matched: 0,
      quarantined: 0,
      movements: 0,
      reason: 'missing-sensor-key',
    });
  });

  it('returns no review action when a resolved incident has no canonical identifier', async () => {
    await expect(service.markColdChainIncidentSamplesForReview({}, {})).resolves.toEqual({
      matched: 0,
      modified: 0,
      reviewRequired: false,
    });
  });
});
