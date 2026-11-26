import { describe, it, expect, vi } from 'vitest';

const {
  revisionPlan,
  storedPointsAt,
  CURRENT_REVISION_FLUX,
} = require('../../src/infrastructure/persistence/influxdb/telemetryRevisions');

// #1518 (RNF025 C8): a late correction keeps the history, and an identical
// resend of a stored reading is no correction.
describe('telemetryRevisions (#1518, RNF025 C8)', () => {
  describe('revisionPlan', () => {
    it('plans no revision and no supersedes when no point is stored at the time', () => {
      expect(revisionPlan([], { telemetryReadingId: 'tr-1', sourceEventId: 'tr-1', payloadHash: 'h-1' }))
        .toEqual({ revision: null, supersedesTelemetryReadingId: null });
    });

    it('plans revision 1 superseding the stored reading when its payloadHash differs', () => {
      const stored = [{ value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'tr-1', payloadHash: 'h-0' }];

      expect(revisionPlan(stored, { telemetryReadingId: 'tr-2', sourceEventId: 'tr-2', payloadHash: 'h-1' }))
        .toEqual({ revision: '1', supersedesTelemetryReadingId: 'tr-1' });
    });

    it('plans an identical resend with no client sourceEventId as a retry: no revision, no supersedes', () => {
      // The contract falls back to the reading's own new telemetryReadingId
      // as its sourceEventId, so only the payloadHash matches.
      const stored = [{ value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'tr-1', payloadHash: 'h-1' }];

      expect(revisionPlan(stored, { telemetryReadingId: 'tr-2', sourceEventId: 'tr-2', payloadHash: 'h-1' }))
        .toEqual({ revision: null, supersedesTelemetryReadingId: null });
    });

    it('plans an identical resend of a correction into the correction\'s revision, superseding nothing', () => {
      const stored = [
        { value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'tr-1', payloadHash: 'h-0' },
        { value: 6, telemetryReadingId: 'tr-2', sourceEventId: 'tr-2', payloadHash: 'h-1', revision: '1' },
      ];

      expect(revisionPlan(stored, { telemetryReadingId: 'tr-3', sourceEventId: 'tr-3', payloadHash: 'h-1' }))
        .toEqual({ revision: '1', supersedesTelemetryReadingId: null });
    });

    it('plans a retry by its sourceEventId as a retry, whatever its payloadHash', () => {
      const stored = [
        { value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'ev-1', payloadHash: 'h-0' },
        { value: 6, telemetryReadingId: 'tr-2', sourceEventId: 'ev-2', payloadHash: 'h-1', revision: '1' },
      ];

      expect(revisionPlan(stored, { telemetryReadingId: 'tr-3', sourceEventId: 'ev-2', payloadHash: 'h-9' }))
        .toEqual({ revision: '1', supersedesTelemetryReadingId: null });
    });
  });

  describe('storedPointsAt', () => {
    it('reads the measurement\'s points of the sensor at the time, with the value, id, source event and payloadHash fields', async () => {
      const collectRows = vi.fn().mockResolvedValue([{ temperatureValue: 4 }]);
      const time = new Date('2026-10-10T12:00:00.000Z');

      const rows = await storedPointsAt({ collectRows }, 'telemetry', {
        measurement: 'freezer_temperature', valueField: 'temperatureValue', sensorId: 'sensor-1', time,
      });

      expect(rows).toEqual([{ temperatureValue: 4 }]);
      const query = String(collectRows.mock.calls[0][0]);
      expect(query).toContain('from(bucket: "telemetry")');
      expect(query).toContain('range(start: 2026-10-10T12:00:00.000Z, stop: 2026-10-10T12:00:00.001Z)');
      expect(query).toContain('r._measurement == "freezer_temperature" and r.sensorId == "sensor-1"');
      expect(query).toContain('r._field == "temperatureValue"');
      expect(query).toContain('r._field == "payloadHash"');
    });
  });

  describe('CURRENT_REVISION_FLUX', () => {
    it('keeps the highest revision per measurement, sensor and time', () => {
      expect(CURRENT_REVISION_FLUX).toContain('group(columns: ["_measurement", "sensorId", "_time"])');
      expect(CURRENT_REVISION_FLUX).toContain('max(column: "_revision")');
    });
  });
});
