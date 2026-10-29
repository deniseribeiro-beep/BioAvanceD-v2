import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const TelemetryExposureSummaryModel = require('../../../src/models/TelemetryExposureSummary');

const { CALCULATION_VERSION } = TelemetryExposureSummaryModel;
const HASH = `sha256:${'a'.repeat(64)}`;

// #1392 (RF009 AC5/AC6, V2E-0572..0588, V2E-0638..0641).
function valid(over = {}) {
  return {
    specimenId: 'SPC-1',
    datastreamIds: ['ds-1'],
    windowStart: '2026-09-01T00:00:00Z',
    windowEnd: '2026-09-09T00:00:00Z',
    observationCount: 3,
    minimumValue: -81.2,
    maximumValue: -77.5,
    meanValue: -79.8,
    timeOutsideThresholdSeconds: 120,
    excursionCount: 1,
    coverageRatio: 0.998,
    sourceQueryHash: HASH,
    sourceReadingSetHash: HASH,
    calculationVersion: CALCULATION_VERSION,
    calculatedAt: '2026-09-09T00:01:00Z',
    specimenContainerAssignmentId: 'sca-1',
    containerPositionAssignmentId: 'cpa-1',
    rackLocationAssignmentId: 'rla-1',
    exposurePathHash: HASH,
    ...over,
  };
}

describe('TelemetryExposureSummaryModel (#1392, RF009 AC5/AC6)', () => {
  it('emits the 21 catalog fields, storageAssignmentId among them', () => {
    expect(Object.keys(TelemetryExposureSummaryModel.fieldsOf()).sort()).toEqual([
      'calculatedAt', 'calculationVersion', 'containerPositionAssignmentId', 'coverageRatio', 'datastreamIds',
      'excursionCount', 'exposurePathHash', 'maximumValue', 'meanValue', 'minimumValue', 'observationCount',
      'rackLocationAssignmentId', 'sourceQueryHash', 'sourceReadingSetHash', 'specimenContainerAssignmentId',
      'specimenId', 'storageAssignmentId', 'telemetryExposureSummaryId', 'timeOutsideThresholdSeconds',
      'windowEnd', 'windowStart',
    ]);
  });

  it('creates a valid summary with storageAssignmentId null and a minted id', () => {
    const summary = TelemetryExposureSummaryModel.create(valid({ storageAssignmentId: 'sa-legacy' }));
    expect(summary.storageAssignmentId).toBeNull();
    expect(summary.telemetryExposureSummaryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(summary.windowStart).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(CALCULATION_VERSION).toBe('1.0.0');
  });

  it('accepts zero observations with the three statistics null', () => {
    const summary = TelemetryExposureSummaryModel.create(valid({
      observationCount: 0, minimumValue: null, maximumValue: null, meanValue: null, coverageRatio: 0, excursionCount: 0, timeOutsideThresholdSeconds: 0,
    }));
    expect(summary).toMatchObject({ observationCount: 0, minimumValue: null, maximumValue: null, meanValue: null });
  });

  it.each([
    'specimenId', 'windowStart', 'windowEnd', 'observationCount', 'timeOutsideThresholdSeconds', 'excursionCount',
    'coverageRatio', 'sourceQueryHash', 'sourceReadingSetHash', 'calculationVersion', 'calculatedAt',
    'specimenContainerAssignmentId', 'containerPositionAssignmentId', 'rackLocationAssignmentId', 'exposurePathHash',
  ])('refuses a summary without %s (1..1)', (field) => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: null }))).toThrow(`${field} é obrigatório`);
  });

  it('refuses an empty datastreamIds (1..*)', () => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ datastreamIds: [] }))).toThrow('datastreamIds');
  });

  it('refuses a window whose end is not after its start', () => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ windowEnd: '2026-09-01T00:00:00Z' }))).toThrow('windowEnd');
    expect(() => TelemetryExposureSummaryModel.create(valid({ windowEnd: '2026-08-01T00:00:00Z' }))).toThrow('windowEnd');
  });

  it.each([
    ['observationCount', -1], ['observationCount', 1.5], ['excursionCount', -1], ['excursionCount', 0.5],
    ['timeOutsideThresholdSeconds', -1], ['timeOutsideThresholdSeconds', 1.2],
  ])('refuses %s = %s, not a non-negative integer', (field, value) => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: value }))).toThrow(field);
  });

  it.each([-0.01, 1.01])('refuses a coverageRatio of %s, outside [0, 1]', (coverageRatio) => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ coverageRatio }))).toThrow('coverageRatio');
  });

  it.each(['sourceQueryHash', 'sourceReadingSetHash', 'exposurePathHash'])('refuses a %s not of the sha256:<64 hex> form', (field) => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: 'sha256:synthetic' }))).toThrow(field);
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: 'a'.repeat(64) }))).toThrow(field);
  });

  it('refuses a calculationVersion that is not SemVer', () => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ calculationVersion: 'v1' }))).toThrow('calculationVersion');
  });

  it.each(['minimumValue', 'maximumValue', 'meanValue'])('refuses observations without a finite %s', (field) => {
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: null }))).toThrow(field);
    expect(() => TelemetryExposureSummaryModel.create(valid({ [field]: Number.NaN }))).toThrow(field);
  });

  it.each(['minimumValue', 'maximumValue', 'meanValue'])('refuses zero observations with a %s', (field) => {
    const empty = { observationCount: 0, minimumValue: null, maximumValue: null, meanValue: null };
    expect(() => TelemetryExposureSummaryModel.create(valid({ ...empty, [field]: -80 }))).toThrow(field);
  });
});
