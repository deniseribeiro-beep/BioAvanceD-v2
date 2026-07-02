import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Load the real singleton module that the worker references, then stub
// specific methods on it — works in forks pool because the worker holds
// the same module-cache reference we mutate here.
const importService = require('../../src/services/import.service');
const logger = require('../../src/utils/logger');

const locationWorker = require('../../src/workers/workers/location-worker');

const NON_EXISTENT = '/this/path/does/not/exist/location-worker-test-file.csv';

let tmpFile;
let importLocationsStub;
let loggerErrorStub;

beforeEach(() => {
  importLocationsStub = vi.spyOn(importService, 'importLocations');
  loggerErrorStub = vi.spyOn(logger, 'error').mockImplementation(() => {});

  tmpFile = path.join(os.tmpdir(), `location-worker-test-${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, 'code,name\nLOC1,Freezer A\n');
});

afterEach(() => {
  importLocationsStub.mockRestore();
  loggerErrorStub.mockRestore();

  if (fs.existsSync(tmpFile)) { fs.unlinkSync(tmpFile); }
  vi.clearAllMocks();
});

describe('LocationWorker', () => {
  it('throws when file does not exist, without calling importLocations', async () => {
    await expect(locationWorker.process({}, 'job-1', NON_EXISTENT))
      .rejects.toThrow('Arquivo não encontrado');

    expect(importLocationsStub).not.toHaveBeenCalled();
  });

  it('logs the error and rethrows when the file does not exist', async () => {
    await expect(locationWorker.process({}, 'job-1', NON_EXISTENT)).rejects.toThrow();
    expect(loggerErrorStub).toHaveBeenCalledWith(
      'Erro no worker de localizações:',
      expect.any(Error)
    );
  });

  it('builds the file object from the given path and default fileName', async () => {
    importLocationsStub.mockResolvedValue({ total: 0, success: 0, errors: [] });

    await locationWorker.process({}, 'job-1', tmpFile);

    expect(importLocationsStub).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ path: tmpFile, originalname: 'locations.csv' })
    );
  });

  it('uses options.fileName as originalname when provided', async () => {
    importLocationsStub.mockResolvedValue({ total: 0, success: 0, errors: [] });

    await locationWorker.process({}, 'job-1', tmpFile, { fileName: 'my-locations.csv' });

    expect(importLocationsStub).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ path: tmpFile, originalname: 'my-locations.csv' })
    );
  });

  it('returns a result summary derived from importService results', async () => {
    importLocationsStub.mockResolvedValue({ total: 5, success: 4, errors: ['row 3 invalid'] });

    const result = await locationWorker.process({}, 'job-1', tmpFile);

    expect(result.total).toBe(5);
    expect(result.success).toBe(4);
    expect(result.errors).toEqual(['row 3 invalid']);
    expect(typeof result.processingTime).toBe('number');
    expect(result.processingTime).toBeGreaterThanOrEqual(0);
    expect(result.fhirResourcesCreated).toBe(0);
    expect(result.fhirResourcesUpdated).toBe(0);
    expect(result.fhirResources).toEqual([]);
  });

  it('propagates and logs errors thrown by importService.importLocations', async () => {
    const downstreamError = new Error('DB connection lost');
    importLocationsStub.mockRejectedValue(downstreamError);

    await expect(locationWorker.process({}, 'job-1', tmpFile)).rejects.toThrow('DB connection lost');
    expect(loggerErrorStub).toHaveBeenCalledWith('Erro no worker de localizações:', downstreamError);
  });
});
