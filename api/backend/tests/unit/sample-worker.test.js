import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';

const importLGPDService = require('../../src/services/import-lgpd.service');
const sampleWorker = require('../../src/workers/workers/sample-worker');

function makeDb(user = null) {
  return {
    collection: vi.fn((name) => {
      if (name === 'users') {
        return { findOne: vi.fn().mockResolvedValue(user) };
      }
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SampleWorker.process — actor attribution and Neo4j lineage threading (#483)', () => {
  it('resolves the queuing user and forwards their name plus the Neo4j driver into importSamples', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 1,
      success: 1,
      errors: [],
    });

    const userId = '507f1f77bcf86cd799439011';
    const db = makeDb({ _id: userId, displayName: 'Dennis Pedersen', email: 'dennis@example.com', role: 'admin' });
    const neo4jDriver = { marker: 'fake-driver' };

    await sampleWorker.process(db, 'job-1', '/tmp/samples.csv', {
      startBoxId: 'box-1',
      autoIncrement: true,
      groupFields: { a: 1 },
      userID: userId,
      neo4jDriver,
    });

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ path: '/tmp/samples.csv' }),
      expect.objectContaining({
        startBoxId: 'box-1',
        autoIncrement: true,
        groupFields: { a: 1 },
        neo4jDriver,
        actor: { userId, userName: 'Dennis Pedersen', userRole: 'admin' },
      })
    );
  });

  it('falls back to the IMPORT_WORKER identity and a null driver when no userID/neo4jDriver were queued', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 0,
      success: 0,
      errors: [],
    });

    const db = makeDb();

    await sampleWorker.process(db, 'job-2', '/tmp/samples.csv', {});

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({
        neo4jDriver: null,
        actor: { userId: null, userName: 'IMPORT_WORKER' },
      })
    );
  });

  it('falls back to IMPORT_WORKER when the queued userID does not resolve to a user', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 0,
      success: 0,
      errors: [],
    });

    const userId = '507f1f77bcf86cd799439011';
    const db = makeDb(null);

    await sampleWorker.process(db, 'job-3', '/tmp/samples.csv', { userID: userId });

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({
        actor: { userId, userName: 'IMPORT_WORKER', userRole: null },
      })
    );
  });

  it('fails open to IMPORT_WORKER when the user lookup throws (e.g. a malformed userID)', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 0,
      success: 0,
      errors: [],
    });

    const db = makeDb();

    await sampleWorker.process(db, 'job-4', '/tmp/samples.csv', { userID: 'not-an-object-id' });

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({
        actor: { userId: 'not-an-object-id', userName: 'IMPORT_WORKER' },
      })
    );
  });
});

describe('SampleWorker.process — the uploader organization reaches importSamples (#1376)', () => {
  it('forwards organizationId and organizationScope from the job options', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 0,
      success: 0,
      errors: [],
    });

    const db = makeDb();
    const organizationScope = { scope: 'organization', organizationIds: ['org-a'] };

    await sampleWorker.process(db, 'job-5', '/tmp/samples.csv', {
      organizationId: 'org-a',
      organizationScope,
    });

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-a', organizationScope })
    );
  });

  it('passes null organizationId and organizationScope when the job options carry none', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 0,
      success: 0,
      errors: [],
    });

    const db = makeDb();

    await sampleWorker.process(db, 'job-6', '/tmp/samples.csv', {});

    expect(importLGPDService.importSamples).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({ organizationId: null, organizationScope: null })
    );
  });
});
