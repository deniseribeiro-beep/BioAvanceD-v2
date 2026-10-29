import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Model = require('../../../src/models/CustodianshipAssignment');

// #1316, RF021 AC4/AC5: custody is its own half-open assignment per specimen.
const base = {
  specimenId: 'SPC-1',
  custodianOrganizationId: 'org-1',
  authorizationId: 'appr-1',
  effectivePeriod: { start: '2026-01-01T00:00:00Z' },
};

describe('CustodianshipAssignment model (V2E-0105..0112)', () => {
  it('carries the eight canonical fields', () => {
    expect(Object.keys(Model.fieldsOf())).toEqual([
      'custodianshipAssignmentId', 'specimenId', 'custodianOrganizationId', 'responsibleInvestigatorId',
      'locationId', 'effectivePeriod', 'assignmentStatus', 'authorizationId',
    ]);
  });

  it.each(['specimenId', 'custodianOrganizationId', 'authorizationId'])('requires %s (1..1)', (field) => {
    expect(() => Model.create({ ...base, [field]: '' })).toThrow(field);
  });

  it('requires the responsible investigator for a biorepository only (V2E-0108)', () => {
    expect(() => Model.create(base, { governanceRegime: 'biorepository' })).toThrow('responsibleInvestigatorId');
    expect(Model.create(base, { governanceRegime: 'biobank' }).responsibleInvestigatorId).toBeNull();
    expect(Model.create({ ...base, responsibleInvestigatorId: 'inv-1' }, { governanceRegime: 'biorepository' }).responsibleInvestigatorId).toBe('inv-1');
  });

  it('refuses an unknown status, a bad date and an end not after the start', () => {
    expect(() => Model.create({ ...base, assignmentStatus: 'held' })).toThrow('assignmentStatus');
    expect(() => Model.create({ ...base, effectivePeriod: { start: 'not-a-date' } })).toThrow('ISO 8601');
    expect(() => Model.create({ ...base, effectivePeriod: { start: '2026-02-01', end: '2026-02-01' } })).toThrow('[start, end)');
  });

  it('stores an assignment created with its end as ended', () => {
    const closed = Model.create({ ...base, effectivePeriod: { start: '2026-01-01', end: '2026-02-01' } });
    expect(closed.assignmentStatus).toBe('ended');
  });

  it('holds custody over [start, end), and a planned one holds none', () => {
    const a = Model.end(Model.create(base), '2026-03-01T00:00:00Z');
    expect(Model.holdsAt(a, '2026-01-01T00:00:00Z')).toBe(true);
    expect(Model.holdsAt(a, '2026-03-01T00:00:00Z')).toBe(false);
    expect(Model.holdsAt(a, '2025-12-31T23:59:59Z')).toBe(false);
    expect(Model.holdsAt(Model.create({ ...base, assignmentStatus: 'planned' }), '2026-06-01')).toBe(false);
  });

  it('refuses a second custody overlapping the first, the closed history included (RF021 AC5)', () => {
    const first = Model.end(Model.create(base), '2026-03-01T00:00:00Z');
    const backDated = Model.create({ ...base, custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-02-01T00:00:00Z' } });
    expect(() => Model.assertNoOverlap(backDated, [first])).toThrow('org-1');
  });

  it('admits a handover at the exact end, and another specimen at any time', () => {
    const first = Model.end(Model.create(base), '2026-03-01T00:00:00Z');
    const next = Model.create({ ...base, custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-03-01T00:00:00Z' } });
    expect(() => Model.assertNoOverlap(next, [first])).not.toThrow();
    const other = Model.create({ ...base, specimenId: 'SPC-2' });
    expect(() => Model.assertNoOverlap(other, [first])).not.toThrow();
  });

  it('ends an interval only after its start', () => {
    const a = Model.create(base);
    expect(() => Model.end(a, '2025-12-01')).toThrow('[start, end)');
    expect(Model.end(a, '2026-02-01').assignmentStatus).toBe('ended');
  });
});
