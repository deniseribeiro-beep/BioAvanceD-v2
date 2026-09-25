import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const canonicalDictionary = require('../../src/reference-data/canonical-dictionary');
const canonicalContract = require('../../src/contracts/canonical/v2');
const env = require('../../src/config/env');
const foundation = require('../../src/foundation/foundation-v2.service');

function makeCollection(overrides = {}) {
  const indexes = [];
  const collection = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    listIndexes: vi.fn(() => ({ toArray: async () => [...indexes] })),
    aggregate: vi.fn(() => ({ toArray: async () => [] })),
    countDocuments: vi.fn().mockResolvedValue(0),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true, insertedId: 'inserted-1' }),
    rename: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          next: vi.fn().mockResolvedValue(null),
        })),
      })),
      toArray: vi.fn().mockResolvedValue([]),
    })),
    ...overrides,
  };
  const originalCreate = collection.createIndex;
  collection.createIndex = vi.fn(async (keys, options = {}) => {
    const result = await originalCreate(keys, options);
    indexes.push({ key: keys, ...options, name: options.name || `index_${indexes.length}` });
    return result;
  });
  return collection;
}

function makeFoundationDb({
  previousRun = null,
  existingRelease = null,
  failIndex = false,
  topologyConflict = false,
  failCanonicalIndexes = false,
} = {}) {
  const actorDocs = existingRelease?.approvedBy
    ? [{ actorId: existingRelease.approvedBy, actorType: 'user', actorStatus: 'active' }]
    : [];
  const actors = makeCollection({
    updateOne: vi.fn(async (_filter, update) => {
      if (!actorDocs.some((actor) => actor.actorId === update.$setOnInsert.actorId)) actorDocs.push(update.$setOnInsert);
    }),
    findOne: vi.fn(async ({ actorId }) => actorDocs.find((actor) => actor.actorId === actorId) || null),
    find: vi.fn(() => ({ toArray: vi.fn(async () => [...actorDocs]) })),
  });
  const foundationDataRuns = makeCollection({
    createIndex: failIndex
      ? vi.fn().mockRejectedValue(new Error('synthetic index failure'))
      : vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          next: vi.fn().mockResolvedValue(previousRun),
        })),
      })),
    })),
  });

  const collections = {
    actors,
    foundationDataRuns,
    canonicalModelReleases: makeCollection({
      findOne: vi.fn().mockResolvedValue(existingRelease),
    }),
    governanceInvariantCatalogs: makeCollection(),
    configurationValidationRuns: makeCollection(),
    readinessReports: makeCollection(),
    graphProjectionCheckpoints: makeCollection(),
    graph_projection_outbox: makeCollection(),
  };

  if (topologyConflict) {
    collections.patients = makeCollection();
    collections.participants = makeCollection();
  }

  function collectionFactory() {
    if (!failCanonicalIndexes) return makeCollection();
    return makeCollection({
      createIndex: vi.fn(async (_keys, options = {}) => {
        if (String(options.name || '').startsWith('canonical_v2_')) {
          throw Object.assign(new Error('canonical index conflict'), { code: 85 });
        }
        return 'idx';
      }),
    });
  }

  return {
    db: {
      listCollections: vi.fn(() => ({ toArray: async () => Object.keys(collections).map((name) => ({ name })) })),
      createCollection: vi.fn(async (name) => {
        collections[name] = collectionFactory();
        return collections[name];
      }),
      collection: vi.fn((name) => {
        if (!collections[name]) collections[name] = collectionFactory();
        return collections[name];
      }),
    },
    collections,
  };
}

function completeness(overrides = {}) {
  return {
    dictionaryVersion: '2.0.0',
    sourcePath: '/synthetic/dictionary.xlsx',
    sourceSheet: 'DICIONARIO_V2',
    expectedTotal: 1644,
    loadedTotal: 1644,
    uniqueTotal: 1644,
    expectedHistoricalTotal: 929,
    historicalTotal: 929,
    expectedNewTotal: 715,
    newTotal: 715,
    expectedEntityTotal: 146,
    entityTotal: 146,
    duplicateIds: [],
    missingRequiredFieldIds: [],
    nonPhaseOneIds: [],
    verified: true,
    ...overrides,
  };
}

describe('foundation-v2.service item 8 coverage', () => {
  const originalStorageDir = env.STORAGE_DIR;
  let tempDir;

  beforeEach(async () => {
    vi.restoreAllMocks();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-foundation-item8-'));
    env.STORAGE_DIR = tempDir;

    vi.spyOn(canonicalDictionary, 'checkCompleteness').mockResolvedValue(completeness());
    vi.spyOn(canonicalDictionary, 'dictionaryChecksum').mockResolvedValue('dictionary-sha');
    vi.spyOn(canonicalContract, 'getRegistry').mockResolvedValue({
      schemas: new Map([
        ['Specimen', { type: 'object', properties: { specimenId: { type: 'string' } } }],
        ['Consent', { type: 'object', properties: { consentId: { type: 'string' } } }],
      ]),
      enumRows: [{ Entity: 'Specimen', Field: 'specimenStatus', Value: 'available' }],
      relationships: [{ source: 'Specimen', target: 'Consent' }],
      conditionalRules: [{ entity: 'Specimen', rule: 'synthetic-rule' }],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    env.STORAGE_DIR = originalStorageDir;
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid MongoDB dependency before executing the pipeline', async () => {
    await expect(
      foundation.runFoundationV2({
        db: null,
        environment: 'test',
        deploymentId: 'dep-1',
        pipelineVersion: '2.0.0',
      })
    ).rejects.toThrow('MongoDB é obrigatório');
  });

  it('stops at the canonical dictionary completeness gate', async () => {
    canonicalDictionary.checkCompleteness.mockResolvedValueOnce(
      completeness({
        verified: false,
        loadedTotal: 1643,
        uniqueTotal: 1643,
      })
    );

    const { db } = makeFoundationDb();

    await expect(
      foundation.runFoundationV2({
        db,
        environment: 'test',
        deploymentId: 'dep-1',
        pipelineVersion: '2.0.0',
      })
    ).rejects.toMatchObject({
      code: 'CANONICAL_DICTIONARY_NOT_READY',
    });

    expect(canonicalContract.getRegistry).not.toHaveBeenCalled();
  });

  it('stops when topology dry-run would block before applying renames', async () => {
    const { db, collections } = makeFoundationDb({ topologyConflict: true });

    await expect(
      foundation.runFoundationV2({
        db,
        environment: 'test',
        deploymentId: 'dep-topology-block',
        pipelineVersion: '2.0.0',
      })
    ).rejects.toMatchObject({ code: 'COLLECTION_MIGRATION_CONFLICT' });

    expect(collections.canonicalModelReleases.updateOne).not.toHaveBeenCalled();
  });

  it('stops when canonical index readiness is blocked after topology apply', async () => {
    const { db, collections } = makeFoundationDb({ failCanonicalIndexes: true });

    await expect(
      foundation.runFoundationV2({
        db,
        environment: 'test',
        deploymentId: 'dep-index-block',
        pipelineVersion: '2.0.0',
      })
    ).rejects.toMatchObject({ code: 'CANONICAL_INDEX_NOT_READY' });

    expect(collections.canonicalModelReleases.updateOne).not.toHaveBeenCalled();
  });

  it('builds deterministic contract checksums from schemas, enums, mappings, invariants and policies', async () => {
    const result = await foundation.buildContractChecksums();

    expect(result.dictionary).toBe('dictionary-sha');
    expect(result.schemas).toMatch(/^[0-9a-f]{64}$/);
    expect(result.enums).toMatch(/^[0-9a-f]{64}$/);
    expect(result.mappings).toMatch(/^[0-9a-f]{64}$/);
    expect(result.invariants).toMatch(/^[0-9a-f]{64}$/);
    expect(result.policies).toMatch(/^[0-9a-f]{64}$/);
  });

  it('runs the complete Foundation v2 pipeline, persists evidence, indexes and readiness with no operational population', async () => {
    const previousRun = { foundationDataRunId: 'run-previous' };
    const { db, collections } = makeFoundationDb({ previousRun });

    const result = await foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'deployment-test-1',
      pipelineVersion: '2.0.0',
      initiatedBy: 'test:item8',
    });

    expect(result.run.runStatus).toBe('completed');
    expect(result.run.environment).toBe('test');
    expect(result.run.previousRunId).toBe('run-previous');
    expect(result.run.canonicalModelReleaseId).toBe(foundation.CANONICAL_RELEASE_ID);
    expect(result.run.dryRunResult).toBe('pass');
    expect(result.run.applyResult).toBe('pass');
    expect(result.run.verifyResult).toBe('pass');
    expect(result.run.rollbackResult).toBe('not_required');
    expect(result.run.postCondition).toEqual({ unauthorizedOperationalRecordsCreated: 0 });
    expect(result.run.steps.length).toBeGreaterThan(10);
    expect(result.run.checkpoints).toHaveLength(result.run.steps.length);
    expect(result.run.reportUri).toMatch(/^object:\/\/bioavanced\/foundation\/runs\//);

    expect(result.readiness.status).toBe('ready');
    expect(result.readiness.p0Coverage).toBe(1);
    expect(result.readiness.blockers).toEqual([]);
    expect(result.readiness.gateResults.map((entry) => entry.gate)).toEqual(foundation.GATE_NAMES);
    expect(result.readiness.gateResults.every((entry) => entry.result === 'pass')).toBe(true);

    const versionGate = result.readiness.gateResults.find((entry) => entry.gate === 'version');
    expect(versionGate.evidence).toMatchObject({
      dictionaryVersion: '2.0.0',
      dictionaryChecksum: 'dictionary-sha',
      elements: 1644,
      entities: 146,
    });

    const configurationGate = result.readiness.gateResults.find((entry) => entry.gate === 'configuration');
    expect(configurationGate.evidence.configurationValidationRunId)
      .toBe(result.configurationValidation.configurationValidationRunId);

    expect(result.configurationValidation.status).toBe('passed');
    expect(result.configurationValidation.invariantResults)
      .toHaveLength(foundation.GOVERNANCE_INVARIANTS.length);
    expect(result.configurationValidation.invariantResults.every((entry) => entry.result === 'pass')).toBe(true);

    expect(result.release.semanticVersion).toBe('2.0.0');
    expect(result.release.releaseStatus).toBe('active');
    expect(result.release.artifactManifest).toHaveLength(6);
    expect(result.release.checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(result.invariantCatalog.catalogId).toBe(foundation.INVARIANT_CATALOG_ID);
    expect(result.invariantCatalog.status).toBe('active');

    expect(collections.foundationDataRuns.createIndex).toHaveBeenCalled();
    expect(collections.canonicalModelReleases.createIndex).toHaveBeenCalled();
    expect(collections.governanceInvariantCatalogs.createIndex).toHaveBeenCalled();
    expect(collections.configurationValidationRuns.createIndex).toHaveBeenCalled();
    expect(collections.readinessReports.createIndex).toHaveBeenCalledTimes(2);
    expect(collections.graphProjectionCheckpoints.createIndex).toHaveBeenCalled();
    expect(collections.graph_projection_outbox.createIndex).toHaveBeenCalledTimes(4);

    expect(collections.canonicalModelReleases.updateOne).toHaveBeenCalledWith(
      { semanticVersion: '2.0.0' },
      expect.objectContaining({ $set: expect.objectContaining({ releaseStatus: 'active' }) }),
      { upsert: true }
    );
    expect(result.release).not.toHaveProperty('approvedBy');
    expect(result.release).not.toHaveProperty('approvedAt');
    expect(collections.configurationValidationRuns.insertOne).toHaveBeenCalledTimes(1);
    expect(collections.readinessReports.insertOne).toHaveBeenCalledTimes(1);
    expect(collections.foundationDataRuns.insertOne).toHaveBeenCalledTimes(1);

    const reportFiles = [
      path.join(tempDir, 'foundation', 'configuration-validation', `${result.configurationValidation.configurationValidationRunId}.json`),
      path.join(tempDir, 'foundation', 'readiness', `${result.readiness.readinessReportId}.json`),
      path.join(tempDir, 'foundation', 'runs', `${result.run.foundationDataRunId}.json`),
    ];
    for (const reportFile of reportFiles) {
      expect(fs.existsSync(reportFile)).toBe(true);
    }
  });

  it('preserves approved fields from an existing canonical release instead of replacing them with defaults', async () => {
    const approvedAt = new Date('2026-01-01T00:00:00.000Z');
    const createdAt = new Date('2025-12-01T00:00:00.000Z');
    const existingRelease = {
      canonicalModelReleaseId: 'release-existing',
      approvedAt,
      approvedBy: '550e8400-e29b-41d4-a716-446655440001',
      supersedesId: 'release-old',
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z', end: null },
      createdAt,
    };
    const { db } = makeFoundationDb({ existingRelease });

    const result = await foundation.runFoundationV2({
      db,
      environment: 'staging',
      deploymentId: 'deployment-staging',
      pipelineVersion: '2.0.0',
    });

    expect(result.release).toMatchObject({
      canonicalModelReleaseId: 'release-existing',
      approvedAt,
      approvedBy: '550e8400-e29b-41d4-a716-446655440001',
      supersedesId: 'release-old',
      effectivePeriod: existingRelease.effectivePeriod,
      createdAt,
    });
    expect(result.run.previousRunId).toBeNull();
  });

  it('rejects a legacy canonical release approver that is not an Actor UUID', async () => {
    const { db, collections } = makeFoundationDb({
      existingRelease: {
        canonicalModelReleaseId: 'release-existing',
        approvedAt: new Date('2026-01-01T00:00:00.000Z'),
        approvedBy: 'project-owner-approved-documentation',
      },
    });

    await expect(foundation.runFoundationV2({
      db,
      environment: 'staging',
      deploymentId: 'deployment-staging',
      pipelineVersion: '2.0.0',
    })).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });
    expect(collections.canonicalModelReleases.updateOne).not.toHaveBeenCalled();
  });

  it('records a failed FoundationDataRun when an apply-stage technical index fails and then rethrows the original error', async () => {
    const { db, collections } = makeFoundationDb({
      previousRun: { foundationDataRunId: 'run-before-failure' },
      failIndex: true,
    });

    await expect(
      foundation.runFoundationV2({
        db,
        environment: 'production',
        deploymentId: 'deployment-prod',
        pipelineVersion: '2.0.0',
        initiatedBy: 'test:item8-failure',
      })
    ).rejects.toThrow('synthetic index failure');

    expect(collections.foundationDataRuns.insertOne).toHaveBeenCalledTimes(1);
    const failedRun = collections.foundationDataRuns.insertOne.mock.calls[0][0];

    expect(failedRun).toMatchObject({
      runStatus: 'failed',
      executionMode: 'apply',
      environment: 'production',
      deploymentId: 'deployment-prod',
      initiatedBy: 'test:item8-failure',
      previousRunId: 'run-before-failure',
      canonicalModelReleaseId: foundation.CANONICAL_RELEASE_ID,
      dryRunResult: 'pass',
      applyResult: 'fail',
      verifyResult: null,
      rollbackResult: 'not_required',
      postCondition: { unauthorizedOperationalRecordsCreated: 0 },
    });
    expect(failedRun.validationSummary.failed).toBe(1);
    expect(failedRun.validationSummary.passed).toBe(7);
    expect(failedRun.errorSummary).toEqual({
      fatal: 1,
      message: 'synthetic index failure',
    });
    expect(failedRun.reportUri).toMatch(/^object:\/\/bioavanced\/foundation\/runs\//);
  });

  it('the checksum helper is stable for key order, arrays and Date values', () => {
    const a = {
      z: 2,
      a: {
        date: new Date('2026-09-18T12:00:00.000Z'),
        list: [{ b: 2, a: 1 }],
      },
    };
    const b = {
      a: {
        list: [{ a: 1, b: 2 }],
        date: new Date('2026-09-18T12:00:00.000Z'),
      },
      z: 2,
    };

    expect(foundation.checksum(a)).toBe(foundation.checksum(b));
    expect(foundation.checksum(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('falls back to the package storage directory when STORAGE_DIR is unset', async () => {
    env.STORAGE_DIR = undefined;
    const defaultRoot = path.join(path.dirname(require.resolve('../../src/foundation/foundation-v2.service')), '../../storage');
    const { db, collections } = makeFoundationDb();

    const result = await foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'dep-storage-default',
      pipelineVersion: '2.0.0',
    });

    const reportFile = path.join(
      defaultRoot,
      'foundation',
      'runs',
      `${result.run.foundationDataRunId}.json`,
    );
    expect(fs.existsSync(reportFile)).toBe(true);
    expect(collections.foundationDataRuns.insertOne).toHaveBeenCalled();
    await fs.promises.rm(path.join(defaultRoot, 'foundation'), { recursive: true, force: true });
  });

  it('rejects a canonical release that has approvedAt without approvedBy', async () => {
    const { db, collections } = makeFoundationDb({
      existingRelease: {
        canonicalModelReleaseId: 'release-xor',
        approvedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await expect(foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'dep-xor',
      pipelineVersion: '2.0.0',
    })).rejects.toMatchObject({
      code: 'DATA_MIGRATION_CONFLICT',
      message: expect.stringMatching(/incomplete Actor provenance/),
    });
    expect(collections.canonicalModelReleases.updateOne).not.toHaveBeenCalled();
  });

  it('maps topology dry-run account conflicts to DATA_MIGRATION_CONFLICT', async () => {
    const { db, collections } = makeFoundationDb();
    collections.users = makeCollection({
      find: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: '507f1f77bcf86cd799439011' }]),
      })),
    });

    await expect(foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'dep-account-block',
      pipelineVersion: '2.0.0',
    })).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });

    expect(collections.canonicalModelReleases.updateOne).not.toHaveBeenCalled();
  });

  it('records DATA_CONFLICT blockers when index readiness fails after a data conflict', async () => {
    const indexPath = require.resolve('../../src/foundation/mongoIndexLifecycleV2');
    const foundationPath = require.resolve('../../src/foundation/foundation-v2.service');
    const indexMod = require('../../src/foundation/mongoIndexLifecycleV2');
    const originalRun = indexMod.runIndexLifecycle;
    indexMod.runIndexLifecycle = vi.fn(async (_db, opts = {}) => {
      if (opts.mode === 'dry-run') {
        return {
          mode: 'dry-run',
          wouldCreate: [],
          preflight: { conflicts: [] },
          migrationRequired: false,
          wouldBlock: false,
          verified: false,
          planned: [],
          created: [],
        };
      }
      return {
        mode: 'apply',
        ready: false,
        created: [],
        verified: 0,
        blocked: [{ constraintId: 'canonical-index:UserAccount:userAccountId', state: 'DATA_CONFLICT' }],
        errors: [],
        planned: [],
        preflight: { conflicts: [{ constraintId: 'canonical-index:UserAccount:userAccountId' }] },
        migrationRequired: true,
      };
    });
    delete require.cache[foundationPath];
    const freshFoundation = require('../../src/foundation/foundation-v2.service');
    const { db, collections } = makeFoundationDb();

    try {
      await expect(freshFoundation.runFoundationV2({
        db,
        environment: 'test',
        deploymentId: 'dep-data-conflict',
        pipelineVersion: '2.0.0',
      })).rejects.toMatchObject({ code: 'CANONICAL_INDEX_NOT_READY' });

      expect(collections.readinessReports.insertOne).toHaveBeenCalled();
      const blocked = collections.readinessReports.insertOne.mock.calls[0][0];
      expect(blocked.blockers).toEqual([{
        code: 'DATA_CONFLICT',
        constraintId: 'canonical-index:UserAccount:userAccountId',
        state: 'DATA_CONFLICT',
      }]);
    } finally {
      indexMod.runIndexLifecycle = originalRun;
      delete require.cache[foundationPath];
      delete require.cache[indexPath];
      require('../../src/foundation/foundation-v2.service');
    }
  });

  it('uses FOUNDATION_APPLY_FAILED when the caught error has no code and indexes never blocked', async () => {
    const { db, collections } = makeFoundationDb();
    db.createCollection = vi.fn(async () => {
      throw new Error('createCollection failed');
    });

    await expect(foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'dep-foundation-apply-failed',
      pipelineVersion: '2.0.0',
    })).rejects.toThrow('createCollection failed');

    const blocked = collections.readinessReports.insertOne.mock.calls[0][0];
    expect(blocked.blockers).toEqual([{ code: 'FOUNDATION_APPLY_FAILED' }]);
  });

  it('marks dryRunResult as fail when the pipeline aborts before the dry-run checkpoint', async () => {
    const { db, collections } = makeFoundationDb();
    const RealDate = Date;
    let dateCalls = 0;
    vi.spyOn(global, 'Date').mockImplementation(function DateMock(...args) {
      dateCalls += 1;
      if (dateCalls === 3) throw new Error('clock failure before dry-run marker');
      if (new.target) return Reflect.construct(RealDate, args);
      return RealDate(...args);
    });

    await expect(foundation.runFoundationV2({
      db,
      environment: 'test',
      deploymentId: 'dep-dry-run-fail',
      pipelineVersion: '2.0.0',
    })).rejects.toThrow('clock failure before dry-run marker');

    const failedRun = collections.foundationDataRuns.insertOne.mock.calls[0][0];
    expect(failedRun.dryRunResult).toBe('fail');
    expect(failedRun.applyResult).toBe('fail');
  });
});
