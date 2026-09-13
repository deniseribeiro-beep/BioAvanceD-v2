import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validate } = require('../../../src/contracts/canonical/v1');

describe('canonical.v1.telemetry (RF029 slice 3/6, #671)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.telemetry', {
      sensorId: 'S-1',
      equipmentId: 'D-1',
      metricType: 'temperature',
      timestamp: '2026-08-20T12:00:00.000Z',
      value: 4.5,
      unit: 'Cel',
      measurementQuality: 'good',
      calibrationStatus: 'valid',
      thresholdProfileId: 'TP-1',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.telemetry', {
      sensorId: 'S-1',
      metricType: 'temperature',
      timestamp: '2026-08-20T12:00:00.000Z',
      value: 4.5,
      unit: 'Cel',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects a payload missing a required field (value)', () => {
    const { valid, errors } = validate('canonical.v1.telemetry', {
      sensorId: 'S-1',
      metricType: 'temperature',
      timestamp: '2026-08-20T12:00:00.000Z',
      unit: 'Cel',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  // RF009's real POST /api/iot/telemetry body is {sensorId, temperature,
  // timestamp} -- `temperature` where the canonical contract requires an
  // explicit `value` (+ metricType/unit). additionalProperties: false means
  // that legacy shape is rejected outright, not silently accepted.
  it('rejects the legacy `temperature` field name -- not part of the canonical shape', () => {
    const { valid, errors } = validate('canonical.v1.telemetry', {
      sensorId: 'S-1',
      temperature: 4.5,
      timestamp: '2026-08-20T12:00:00.000Z',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.telemetry', {
      sensorId: 'S-1',
      metricType: 'temperature',
      timestamp: '2026-08-20T12:00:00.000Z',
      value: 4.5,
      unit: 'Cel',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});
