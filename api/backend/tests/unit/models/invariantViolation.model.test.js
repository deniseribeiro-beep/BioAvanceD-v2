import { describe, it, expect } from 'vitest';

const InvariantViolationModel = require('../../../src/models/InvariantViolation');

describe('InvariantViolationModel (V2E-0060..0066, RF019 AC1/AC4)', () => {
  const ok = { invariantId: 'INV-AUDIT-001', sourceComponent: 'configurationValidation', outcome: 'Block', correlationId: 'release-1' };

  it('creates a violation with an id and a detection instant, its outcome lowercased', () => {
    const violation = InvariantViolationModel.create(ok);
    expect(violation).toMatchObject({ invariantId: 'INV-AUDIT-001', outcome: 'block', correlationId: 'release-1', evidenceUri: null });
    expect(violation.invariantViolationId).toEqual(expect.any(String));
    expect(violation.detectedAt).toBeInstanceOf(Date);
  });

  it.each(['invariantId', 'sourceComponent', 'outcome', 'correlationId'])('refuses a violation without %s (1..1)', (field) => {
    expect(() => InvariantViolationModel.create({ ...ok, [field]: undefined })).toThrow(`${field} é obrigatório`);
  });

  it('refuses an outcome the catalog does not list', () => {
    expect(() => InvariantViolationModel.create({ ...ok, outcome: 'warn' })).toThrow('outcome inválido');
  });
});
