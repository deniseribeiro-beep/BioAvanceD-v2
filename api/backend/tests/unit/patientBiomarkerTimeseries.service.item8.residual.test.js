import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const connectionModule = require('../../src/infrastructure/database/influxdb/connection');
const biomarkerIntegrityService = require('../../src/services/biomarker-integrity.service');

function makeFakeWriteApi() {
  return {
    writePoint: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function freshService() {
  const resolved = require.resolve('../../src/services/patientBiomarkerTimeseries.service');
  delete require.cache[resolved];
  return require('../../src/services/patientBiomarkerTimeseries.service');
}

describe('patientBiomarkerTimeseries.service item 8 residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when participantId is missing or empty', async () => {
    const connectSpy = vi.spyOn(connectionModule, 'connectInfluxDB');
    const service = freshService();

    await service.writePatientBiomarkers({
      patient: { biomarkers: [{ biomarkerType: 'alphaGal', value: 1 }] },
    });
    await service.writePatientBiomarkers({
      patient: { participantId: '', biomarkers: [{ biomarkerType: 'alphaGal', value: 1 }] },
    });

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when neither biomarkers nor biomarkerObservations arrays are present', async () => {
    const connectSpy = vi.spyOn(connectionModule, 'connectInfluxDB');
    const service = freshService();

    await service.writePatientBiomarkers({
      patient: { participantId: 'P-NO-ARRAYS', biomarkers: null, biomarkerObservations: undefined },
    });

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('drops null entries and accepts type-only biomarker keys', async () => {
    const fakeWriteApi = makeFakeWriteApi();
    vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
    vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
    const service = freshService();

    await service.writePatientBiomarkers({
      patient: {
        participantId: 'P-TYPE-ONLY',
        biomarkers: [
          null,
          'not-an-object',
          { type: 'alphaGal', value: '2.5' },
        ],
      },
    });

    expect(fakeWriteApi.writePoint).toHaveBeenCalledTimes(1);
    const line = fakeWriteApi.writePoint.mock.calls[0][0].toLineProtocol();
    expect(line).toContain('alphaGal=2.5');
  });

  it('defaults a falsy eventType tag to update', async () => {
    const fakeWriteApi = makeFakeWriteApi();
    vi.spyOn(connectionModule, 'connectInfluxDB').mockResolvedValue(undefined);
    vi.spyOn(connectionModule, 'getInfluxWriteApi').mockReturnValue(fakeWriteApi);
    vi.spyOn(biomarkerIntegrityService, 'appendBiomarkerHash').mockResolvedValue(undefined);
    const service = freshService();

    await service.writePatientBiomarkers({
      patient: {
        participantId: 'P-EVENT',
        biomarkers: [{ biomarkerType: 'alphaGal', value: 1 }],
      },
      eventType: '',
    });

    const line = fakeWriteApi.writePoint.mock.calls[0][0].toLineProtocol();
    expect(line).toContain('eventType=update');
  });
});
