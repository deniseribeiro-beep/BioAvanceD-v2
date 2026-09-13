import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const connectionModule = require('../../src/infrastructure/database/influxdb/connection');
const biomarkerIntegrityService = require('../../src/services/biomarker-integrity.service');
const logger = require('../../src/utils/logger');
const service = require('../../src/services/patientBiomarkerTimeseries.service');

function makeFakeWriteApi() {
  return {
    writePoint: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined)
  };
}

// The service module destructures connectInfluxDB/getInfluxWriteApi at
// require time, so spying on the connection module's exports after the
// service has already been required has no effect on the local bindings
// captured inside the service's closure. To make spies take effect, we
// must set them up first, then evict the service module from Node's
// require cache and re-require it so it re-destructures against the
// now-spied functions.
function freshService() {
  const resolved = require.resolve('../../src/services/patientBiomarkerTimeseries.service');
  delete require.cache[resolved];
  return require('../../src/services/patientBiomarkerTimeseries.service');
}

describe('patientBiomarkerTimeseries.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('toNumeric', () => {
    it('returns null for undefined', () => {
      expect(service.toNumeric(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(service.toNumeric(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(service.toNumeric('')).toBeNull();
    });

    it('returns null for non-numeric string', () => {
      expect(service.toNumeric('abc')).toBeNull();
    });

    it('returns null for NaN', () => {
      expect(service.toNumeric(NaN)).toBeNull();
    });

    it('returns null for Infinity', () => {
      expect(service.toNumeric(Infinity)).toBeNull();
    });

    it('returns numeric value for a numeric string', () => {
      expect(service.toNumeric('3.5')).toBe(3.5);
    });

    it('returns 0 for the number 0 (not treated as missing)', () => {
      expect(service.toNumeric(0)).toBe(0);
    });

    it('returns 0 for the string "0" (not treated as missing)', () => {
      expect(service.toNumeric('0')).toBe(0);
    });
  });

  describe('writePatientBiomarkers', () => {
    it('is a no-op when patient is falsy', async () => {
      const connectSpy = vi.spyOn(connectionModule, 'connectInfluxDB');
      await service.writePatientBiomarkers({ patient: null });
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when patient.participantId trims to empty string', async () => {
      const connectSpy = vi.spyOn(connectionModule, 'connectInfluxDB');
      await service.writePatientBiomarkers({
        patient: { participantId: '   ', biomarkers: [{ biomarkerType: 'alphaGal', value: 5 }] }
      });
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when biomarkers array normalizes to empty', async () => {
      const connectSpy = vi.spyOn(connectionModule, 'connectInfluxDB');
      const appendSpy = vi.spyOn(biomarkerIntegrityService, 'appendBiomarkerHash');
      await service.writePatientBiomarkers({
        db: {},
        patient: { participantId: 'P1', biomarkers: [{ biomarkerType: 'alphaGal', value: '' }] }
      });
      expect(connectSpy).not.toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
    });

    it('writes an InfluxDB point with tags and fields on the happy path', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const service = freshService();

      const updatedAt = new Date('2024-01-01T00:00:00.000Z');
      await service.writePatientBiomarkers({
        patient: {
          participantId: 'P42',
          biomarkers: [
            { biomarkerType: 'alphaGal', value: '3.5' },
            { biomarkerType: 'lysoGb3', value: '7.1' }
          ],
          clinicalUnit: 'CU-1',
          updatedAt
        },
        eventType: 'create'
      });

      expect(fakeWriteApi.writePoint).toHaveBeenCalledTimes(1);
      expect(fakeWriteApi.flush).toHaveBeenCalledTimes(1);

      const point = fakeWriteApi.writePoint.mock.calls[0][0];
      const line = point.toLineProtocol();
      expect(line).toContain('patient_biomarkers');
      expect(line).toContain('participantId=P42');
      expect(line).toContain('eventType=create');
      expect(line).toContain('clinicalUnit=CU-1');
      expect(line).toContain('alphaGal=3.5');
      expect(line).toContain('lysoGb3=7.1');
    });

    it('omits clinicalUnit tag when not present on patient', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const service = freshService();

      await service.writePatientBiomarkers({
        patient: { participantId: 'P43', biomarkers: [{ biomarkerType: 'alphaGal', value: '1' }] }
      });

      const point = fakeWriteApi.writePoint.mock.calls[0][0];
      const line = point.toLineProtocol();
      expect(line).not.toContain('clinicalUnit');
      expect(line).toContain('alphaGal=1');
      expect(line).not.toContain('lysoGb3');
    });

    it('catches and logs an InfluxDB write error without throwing, and still proceeds to hash block', async () => {
      vi.spyOn(connectionModule, 'connectInfluxDB').mockRejectedValue(new Error('influx down'));
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const appendSpy = vi
        .spyOn(biomarkerIntegrityService, 'appendBiomarkerHash')
        .mockResolvedValue(undefined);
      const service = freshService();

      await expect(
        service.writePatientBiomarkers({
          db: {},
          patient: { participantId: 'P44', biomarkers: [{ biomarkerType: 'alphaGal', value: '2' }] }
        })
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('P44'));
      expect(appendSpy).toHaveBeenCalledTimes(1);
    });

    it('calls appendBiomarkerHash once per normalized biomarker entry when db is provided', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const appendSpy = vi
        .spyOn(biomarkerIntegrityService, 'appendBiomarkerHash')
        .mockResolvedValue(undefined);
      const service = freshService();

      const db = { fake: true };
      const updatedAt = new Date('2024-02-02T00:00:00.000Z');
      await service.writePatientBiomarkers({
        db,
        patient: {
          participantId: 'P45',
          biomarkers: [
            { biomarkerType: 'alphaGal', value: '4' },
            { biomarkerType: 'lysoGb3', value: '8' }
          ],
          updatedAt
        },
        eventType: 'update'
      });

      expect(appendSpy).toHaveBeenCalledTimes(2);
      expect(appendSpy).toHaveBeenCalledWith(db, {
        participantId: 'P45',
        biomarkerType: 'alphaGal',
        value: 4,
        timestamp: updatedAt,
        source: 'patient_biomarkers',
        eventType: 'update'
      });
      expect(appendSpy).toHaveBeenCalledWith(db, {
        participantId: 'P45',
        biomarkerType: 'lysoGb3',
        value: 8,
        timestamp: updatedAt,
        source: 'patient_biomarkers',
        eventType: 'update'
      });
    });

    it('reads from patient.biomarkerObservations when patient.biomarkers is absent', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const service = freshService();

      await service.writePatientBiomarkers({
        patient: {
          participantId: 'P50',
          biomarkerObservations: [{ biomarkerType: 'alphaGal', value: '1' }]
        }
      });

      const point = fakeWriteApi.writePoint.mock.calls[0][0];
      expect(point.toLineProtocol()).toContain('alphaGal=1');
    });

    it('skips the hash block entirely when db is falsy', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const appendSpy = vi.spyOn(biomarkerIntegrityService, 'appendBiomarkerHash');
      const service = freshService();

      await service.writePatientBiomarkers({
        patient: { participantId: 'P46', biomarkers: [{ biomarkerType: 'alphaGal', value: '1' }] }
      });

      expect(appendSpy).not.toHaveBeenCalled();
    });

    it('catches and logs a rejection from appendBiomarkerHash without throwing', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      vi.spyOn(biomarkerIntegrityService, 'appendBiomarkerHash').mockRejectedValue(
        new Error('hash failure')
      );
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const service = freshService();

      await expect(
        service.writePatientBiomarkers({
          db: {},
          patient: { participantId: 'P47', biomarkers: [{ biomarkerType: 'alphaGal', value: '1' }] }
        })
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('P47'));
    });

    it('defaults timestamp to now when patient.updatedAt is absent', async () => {
      const fakeWriteApi = makeFakeWriteApi();
      vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
      vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
      const service = freshService();

      const before = Date.now();
      await service.writePatientBiomarkers({
        patient: { participantId: 'P48', biomarkers: [{ biomarkerType: 'alphaGal', value: '1' }] }
      });
      const after = Date.now();

      const point = fakeWriteApi.writePoint.mock.calls[0][0];
      const line = point.toLineProtocol();
      const nsMatch = line.match(/\s(\d+)$/);
      expect(nsMatch).not.toBeNull();
      const ms = Number(nsMatch[1]) / 1e6;
      expect(ms).toBeGreaterThanOrEqual(before - 1);
      expect(ms).toBeLessThanOrEqual(after + 1);
    });
  });
});
