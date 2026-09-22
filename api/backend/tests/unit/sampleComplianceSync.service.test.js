import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const collectionResolverModule = require('../../src/utils/collectionResolver');
const SampleGraphValidatorModule = require('../../src/services/SampleGraphValidator');
const logger = require('../../src/utils/logger');

// Spy must be set before first require of service so module-scope destructuring
// captures the spied version.
vi.spyOn(collectionResolverModule, 'getCollection');

const servicePath = require.resolve('../../src/services/sampleComplianceSync.service');
let revalidateSamplesByParticipantId = require(servicePath).revalidateSamplesByParticipantId;

function reloadServiceWithFreshBinding() {
  delete require.cache[servicePath];
  revalidateSamplesByParticipantId = require(servicePath).revalidateSamplesByParticipantId;
}

afterEach(() => {
  vi.restoreAllMocks();
  // re-establish the getCollection spy for the next test, then reload service
  // so its module-scope destructuring captures the freshly spied version.
  vi.spyOn(collectionResolverModule, 'getCollection');
  reloadServiceWithFreshBinding();
});

describe('revalidateSamplesByParticipantId', () => {
  it('returns zeroed result and skips getCollection when participantId is null', async () => {
    const result = await revalidateSamplesByParticipantId({}, null);
    expect(result).toEqual({ total: 0, validated: 0, failed: 0 });
    expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
  });

  it('returns zeroed result and skips getCollection when participantId is undefined', async () => {
    const result = await revalidateSamplesByParticipantId({}, undefined);
    expect(result).toEqual({ total: 0, validated: 0, failed: 0 });
    expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
  });

  it('returns zeroed result and skips getCollection when participantId is empty string', async () => {
    const result = await revalidateSamplesByParticipantId({}, '');
    expect(result).toEqual({ total: 0, validated: 0, failed: 0 });
    expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
  });

  it('returns zeroed result and skips getCollection when participantId is whitespace-only', async () => {
    const result = await revalidateSamplesByParticipantId({}, '   ');
    expect(result).toEqual({ total: 0, validated: 0, failed: 0 });
    expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
  });

  it('queries the samples collection with the normalized participantId and projection', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = { find };
    collectionResolverModule.getCollection.mockResolvedValue(collection);

    const db = { fake: true };
    await revalidateSamplesByParticipantId(db, '  P123  ');

    expect(collectionResolverModule.getCollection).toHaveBeenCalledWith(db, 'samples');
    expect(find).toHaveBeenCalledWith(
      { participantId: 'P123' },
      { projection: { specimenId: 1 } }
    );
  });

  it('returns zeroed result and does not construct a validator when no samples are found', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    const ctorSpy = vi.spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance');

    const result = await revalidateSamplesByParticipantId({}, 'P1');

    expect(result).toEqual({ total: 0, validated: 0, failed: 0 });
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('validates each sample by canonical specimenId and counts successes', async () => {
    const samples = [
      { specimenId: 'sA' },
      { specimenId: 'sB' },
      { specimenId: 'sC' },
    ];
    const toArray = vi.fn().mockResolvedValue(samples);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    const validateSpy = vi
      .spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance')
      .mockResolvedValue(true);

    const result = await revalidateSamplesByParticipantId({}, 'P1');

    expect(result).toEqual({ total: 3, validated: 3, failed: 0 });
    expect(validateSpy).toHaveBeenNthCalledWith(1, 'sA');
    expect(validateSpy).toHaveBeenNthCalledWith(2, 'sB');
    expect(validateSpy).toHaveBeenNthCalledWith(3, 'sC');
  });

  it('counts per-sample failures without aborting remaining samples, and logs a warning', async () => {
    const samples = [
      { specimenId: 'ok1' },
      { specimenId: 'bad1' },
      { specimenId: 'ok2' },
    ];
    const toArray = vi.fn().mockResolvedValue(samples);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    vi.spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance').mockImplementation(
      async (id) => {
        if (id === 'bad1') {
          throw new Error('boom');
        }
        return true;
      }
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await revalidateSamplesByParticipantId({}, 'P9');

    expect(result).toEqual({ total: 3, validated: 2, failed: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[SAMPLE_COMPLIANCE_SYNC] Falha ao revalidar amostra vinculada ao paciente',
      { participantId: 'P9', specimenId: 'bad1', error: 'boom' }
    );
  });

  it('logs an info summary with total/validated/failed counts on completion', async () => {
    const samples = [{ specimenId: 'x1' }];
    const toArray = vi.fn().mockResolvedValue(samples);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    vi.spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance').mockResolvedValue(true);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    await revalidateSamplesByParticipantId({}, 'P5');

    expect(infoSpy).toHaveBeenCalledWith(
      '[SAMPLE_COMPLIANCE_SYNC] Revalidação ética concluída para paciente',
      { participantId: 'P5', total: 1, validated: 1, failed: 0 }
    );
  });

  it('passes an empty specimenId only for malformed stored records and counts the validation failure', async () => {
    const samples = [{}];
    const toArray = vi.fn().mockResolvedValue(samples);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    vi.spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance').mockRejectedValue(
      new Error('no id')
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await revalidateSamplesByParticipantId({}, 'P7');

    expect(result).toEqual({ total: 1, validated: 0, failed: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      { participantId: 'P7', specimenId: '', error: 'no id' }
    );
  });

  it('stringifies a non-Error rejection reason in the warning log', async () => {
    const samples = [{ specimenId: 'z1' }];
    const toArray = vi.fn().mockResolvedValue(samples);
    const find = vi.fn().mockReturnValue({ toArray });
    collectionResolverModule.getCollection.mockResolvedValue({ find });

    vi.spyOn(SampleGraphValidatorModule.prototype, 'validateSampleCompliance').mockRejectedValue(
      'plain string failure'
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await revalidateSamplesByParticipantId({}, 'P8');

    expect(result).toEqual({ total: 1, validated: 0, failed: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      { participantId: 'P8', specimenId: 'z1', error: 'plain string failure' }
    );
  });
});
