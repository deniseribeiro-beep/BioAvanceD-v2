import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ScanEventModel = require('../../../src/models/ScanEvent');

// #1314 (RF016 AC6): a scan records what was read and what it resolved to.
const scan = {
  deviceId: 'scanner-1',
  actorId: 'user-1',
  normalizedValue: 'BVA2:synthetic:8K3M',
  symbology: 'data_matrix',
  targetType: 'specimen',
  targetId: 'SPC-1',
  operationContext: 'lookup',
  result: 'resolved',
  correlationId: 'corr-1',
};

describe('ScanEvent model (RF016 AC6)', () => {
  it('records a resolved lookup with its device, actor, value and instant', () => {
    const event = ScanEventModel.create(scan);
    expect(event).toMatchObject({ result: 'resolved', rawValueProtected: null, locationId: null });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('requires each 1..1 field, and accepts only the catalog values and the AC5 symbologies', () => {
    expect(() => ScanEventModel.create({ ...scan, correlationId: null })).toThrow(/correlationId/);
    expect(() => ScanEventModel.create({ ...scan, symbology: 'ean_13' })).toThrow('symbology inválido: ean_13');
    expect(() => ScanEventModel.create({ ...scan, operationContext: 'dispose' })).toThrow('operationContext inválido: dispose');
  });

  it('keeps the raw value only when the policy authorizes retention (V2E-0221)', () => {
    expect(() => ScanEventModel.create({ ...scan, rawValueProtected: ']d2BVA2:synthetic:8K3M' })).toThrow(/V2E-0221/);
    expect(ScanEventModel.create({ ...scan, rawValueProtected: ']d2BVA2:synthetic:8K3M' }, { retainRawValue: true }).rawValueProtected)
      .toBe(']d2BVA2:synthetic:8K3M');
  });
});
