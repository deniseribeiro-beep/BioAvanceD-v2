import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Datastream = require('../../../src/models/TelemetryDatastream');
const Registration = require('../../../src/models/DeviceRegistration');

// #1316, RF017 AC5 and AC7.
const stream = {
  sensorId: 'sensor-1', equipmentId: 'freezer-1', storageLocationId: 'loc-1', observedProperty: 'temperature', unit: 'Cel',
  samplingPolicyId: 'sampling-1', thresholdProfileId: 'threshold-1', validityPeriod: { start: '2026-01-01T00:00:00Z' },
};

describe('TelemetryDatastream (V2E-0562..0571, RF017 AC5)', () => {
  it('binds sensor, equipment, location, property, unit and validity', () => {
    expect(Datastream.create(stream)).toMatchObject({ sensorId: 'sensor-1', equipmentId: 'freezer-1', unit: 'Cel', status: 'active' });
  });

  it.each(['sensorId', 'equipmentId', 'storageLocationId', 'observedProperty', 'unit', 'samplingPolicyId', 'thresholdProfileId'])('requires %s', (field) => {
    expect(() => Datastream.create({ ...stream, [field]: '' })).toThrow(field);
  });

  it('refuses a unit that is not a UCUM code, and a bad or missing validity', () => {
    expect(() => Datastream.create({ ...stream, unit: 'degrees C' })).toThrow('UCUM');
    expect(() => Datastream.create({ ...stream, validityPeriod: {} })).toThrow('validityPeriod');
    expect(() => Datastream.create({ ...stream, validityPeriod: { start: '2026-02-01', end: '2026-01-01' } })).toThrow('[start, end)');
  });

  it('is valid over [start, end), and a closed one is stored retired', () => {
    const closed = Datastream.create({ ...stream, validityPeriod: { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' } });
    expect(closed.status).toBe('retired');
    expect(Datastream.validAt(closed, '2026-01-15T00:00:00Z')).toBe(true);
    expect(Datastream.validAt(closed, '2026-02-01T00:00:00Z')).toBe(false);
  });

  it('keeps one datastream per sensor and property at a time', () => {
    const first = Datastream.create({ ...stream, validityPeriod: { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' } });
    expect(() => Datastream.assertNoOverlap(Datastream.create({ ...stream, validityPeriod: { start: '2026-01-15T00:00:00Z' } }), [first])).toThrow('sensor-1');
    expect(() => Datastream.assertNoOverlap(Datastream.create({ ...stream, validityPeriod: { start: '2026-02-01T00:00:00Z' } }), [first])).not.toThrow();
    expect(() => Datastream.assertNoOverlap(Datastream.create({ ...stream, observedProperty: 'humidity', unit: '%' }), [first])).not.toThrow();
  });
});

describe('DeviceRegistration (V2E-0618..0623, RF017 AC7)', () => {
  const registration = { deviceId: 'sensor-1', communicationProfileId: 'comm-1', credentialReference: 'secret-manager:device/sensor-1' };

  it('records an opaque credentialReference and no credential', () => {
    const created = Registration.create(registration);
    expect(created).toMatchObject({ credentialReference: 'secret-manager:device/sensor-1', status: 'active' });
    expect(Object.keys(created)).toEqual(['deviceRegistrationId', 'deviceId', 'communicationProfileId', 'credentialReference', 'registeredAt', 'status']);
  });

  it.each(['credential', 'secret', 'password', 'token', 'apiKey'])('refuses a payload carrying %s', (field) => {
    expect(() => Registration.create({ ...registration, [field]: 's3cr3t' })).toThrow('credentialReference');
  });

  it.each([
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc+def=',
    'plain-password',
    'Bearer abc',
  ])('refuses %s as a credentialReference, since it is not <manager>:<path>', (value) => {
    expect(() => Registration.create({ ...registration, credentialReference: value })).toThrow('opaca');
  });

  it.each(['deviceId', 'communicationProfileId', 'credentialReference'])('requires %s', (field) => {
    expect(() => Registration.create({ ...registration, [field]: '' })).toThrow(field);
  });
});
