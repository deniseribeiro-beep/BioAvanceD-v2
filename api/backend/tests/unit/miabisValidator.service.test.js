import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const Sample = require('../../src/models/Sample');
const connectionModule = require('../../src/infrastructure/database/neo4j/connection');

// Set up the connectNeo4j spy BEFORE requiring the service module, so the
// destructured `const { connectNeo4j } = require(...)` inside the service
// picks up the spy (per this repo's documented gotcha).
vi.spyOn(connectionModule, 'connectNeo4j');

const servicePath = require.resolve('../../src/services/miabisValidator.service');
let { validateMiabisCompliance } = require(servicePath);

function makeFakeSession(runImpl) {
  return {
    run: vi.fn(runImpl),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeDriver(session) {
  return { session: vi.fn(() => session) };
}

function makeCompleteSample(overrides = {}) {
  return {
    sampleType: 'blood',
    anatomicalSite: 'arm',
    storageTemperature: -20,
    diagnosisCode: 'C50',
    ...overrides,
  };
}

describe('validateMiabisCompliance', () => {
  beforeEach(() => {
    // IMPORTANT: the service module destructures `connectNeo4j` at require
    // time, so it holds a reference to the exact mock function object that
    // existed at that moment. `vi.restoreAllMocks()` would swap
    // `connectionModule.connectNeo4j` back to the real implementation and
    // any subsequent `vi.spyOn` call creates a *new* mock object that the
    // service never sees. So for this one spy we only reset its state
    // in-place (mockReset), never restore/re-spy its identity.
    connectionModule.connectNeo4j.mockReset();

    // Sample.findById is looked up fresh on every call (not destructured),
    // so it's safe to fully restore/re-spy per test.
    if (vi.isMockFunction(Sample.findById)) {
      Sample.findById.mockRestore();
    }
  });

  it('returns sampleNotFound result and never calls connectNeo4j when sample is missing', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });

    const result = await validateMiabisCompliance('missing-id');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleNotFound'],
      consentStatus: 'not_found',
      canBeShared: false,
    });
    expect(connectionModule.connectNeo4j).not.toHaveBeenCalled();
  });

  it('fast-fails with not_evaluated and preserves field order when only some fields are missing', async () => {
    // Missing sampleType and diagnosisCode only
    const sample = makeCompleteSample({ sampleType: undefined, diagnosisCode: undefined });
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(sample),
    });

    const result = await validateMiabisCompliance('id-1');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleType', 'diagnosisCode'],
      consentStatus: 'not_evaluated',
      canBeShared: false,
    });
    expect(connectionModule.connectNeo4j).not.toHaveBeenCalled();
  });

  it('lists all four missing fields in fixed order when all are absent', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue({}),
    });

    const result = await validateMiabisCompliance('id-2');

    expect(result.missingFields).toEqual([
      'sampleType',
      'anatomicalSite',
      'storageTemperature',
      'diagnosisCode',
    ]);
    expect(result.consentStatus).toBe('not_evaluated');
  });

  it('is fully compliant when all fields present and Neo4j reports valid public consent', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    const fakeRecord = { toObject: () => ({ status: 'valid', isPublic: true }) };
    const fakeSession = makeFakeSession(async () => ({ records: [fakeRecord] }));
    const fakeDriver = makeFakeDriver(fakeSession);
    connectionModule.connectNeo4j.mockResolvedValue(fakeDriver);

    const result = await validateMiabisCompliance('id-3');

    expect(connectionModule.connectNeo4j).toHaveBeenCalledTimes(1);
    expect(fakeSession.run).toHaveBeenCalledWith(expect.stringContaining('MATCH'), { sampleId: 'id-3' });
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      isCompliant: true,
      missingFields: [],
      consentStatus: 'valid',
      canBeShared: true,
    });
  });

  it('is not compliant when consent record exists but status is not valid', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    const fakeRecord = { toObject: () => ({ status: 'revoked', isPublic: false }) };
    const fakeSession = makeFakeSession(async () => ({ records: [fakeRecord] }));
    connectionModule.connectNeo4j.mockResolvedValue(makeFakeDriver(fakeSession));

    const result = await validateMiabisCompliance('id-4');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'revoked',
      canBeShared: false,
    });
  });

  it('falls back to unknown status when record.status is falsy', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    const fakeRecord = { toObject: () => ({ status: null, isPublic: 1 }) };
    const fakeSession = makeFakeSession(async () => ({ records: [fakeRecord] }));
    connectionModule.connectNeo4j.mockResolvedValue(makeFakeDriver(fakeSession));

    const result = await validateMiabisCompliance('id-5');

    expect(result.consentStatus).toBe('unknown');
    expect(result.canBeShared).toBe(true); // !!1 coercion
    expect(result.isCompliant).toBe(false);
  });

  it('keeps consentStatus as not_found and canBeShared false when Neo4j returns no records', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    const fakeSession = makeFakeSession(async () => ({ records: [] }));
    connectionModule.connectNeo4j.mockResolvedValue(makeFakeDriver(fakeSession));

    const result = await validateMiabisCompliance('id-6');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'not_found',
      canBeShared: false,
    });
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });

  it('catches errors from connectNeo4j and falls back to consentStatus error without rethrowing', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    connectionModule.connectNeo4j.mockRejectedValue(new Error('neo4j down'));

    const result = await validateMiabisCompliance('id-7');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });

  it('catches errors from session.run and falls back to consentStatus error', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });

    const fakeSession = makeFakeSession(async () => {
      throw new Error('cypher failed');
    });
    connectionModule.connectNeo4j.mockResolvedValue(makeFakeDriver(fakeSession));

    const result = await validateMiabisCompliance('id-8');

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });
});
