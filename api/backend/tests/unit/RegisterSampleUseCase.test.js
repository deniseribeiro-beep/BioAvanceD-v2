import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');
const env = require('../../src/config/env');
const { MongoServerError } = require('mongodb');

// Distinct from src/core/use-cases/RegisterSample.js (covered by
// RegisterSample.test.js) -- this is a separate class with its own
// constructor shape (sampleRepository/lineageRepository/quarantineService)
// and had no dedicated unit test before this file (only incidentally
// touched via sample.routes.test.js).

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('RegisterSampleUseCase', () => {
  let originalLineageMode;

  beforeEach(() => {
    originalLineageMode = env.LINEAGE_MODE;
  });

  afterEach(() => {
    env.LINEAGE_MODE = originalLineageMode;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('throws when sampleRepository is missing', () => {
      expect(() => new RegisterSampleUseCase({})).toThrow(
        'sampleRepository com método create é obrigatório'
      );
    });

    it('throws when sampleRepository lacks a create method', () => {
      expect(() => new RegisterSampleUseCase({ sampleRepository: {} })).toThrow(
        'sampleRepository com método create é obrigatório'
      );
    });

    it('defaults lineageRepository/quarantineService to null and logger to the default logger', () => {
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      expect(useCase.lineageRepository).toBeNull();
      expect(useCase.quarantineService).toBeNull();
      expect(useCase.logger).toBeDefined();
    });
  });

  describe('execute', () => {
    it('throws when sampleData is missing/invalid', async () => {
      // command.sampleData || command falls back to the whole command object
      // when sampleData is null/undefined, so a { sampleData: null } wrapper
      // does NOT trigger this validation (command itself is a truthy object) --
      // only a top-level command that is itself a non-object does.
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      await expect(useCase.execute('not-an-object')).rejects.toThrow(
        'sampleData inválido para registro de amostra'
      );
      await expect(useCase.execute(42)).rejects.toThrow(
        'sampleData inválido para registro de amostra'
      );
    });

    it('accepts sampleData passed directly on command (no sampleData wrapper)', async () => {
      const createdSample = { _id: 'S-1', barcode: 'BC-1' };
      const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
      const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      const result = await useCase.execute({ barcode: 'BC-1' });

      expect(sampleRepository.create).toHaveBeenCalledWith(
        { barcode: 'BC-1' },
        expect.objectContaining({ auditInfo: expect.any(Object) })
      );
      expect(result.sample).toBe(createdSample);
      expect(result.topology.synced).toBe(true);
    });

    it('builds auditInfo from command.actor and forwards command.options into createOptions', async () => {
      const createdSample = { _id: 'S-2' };
      const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
      const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      const command = {
        sampleData: { barcode: 'BC-2' },
        options: { skipValidation: true },
        actor: {
          userId: 'U1',
          userName: 'alice',
          userRole: 'tech',
          ipAddress: '1.2.3.4',
          userAgent: 'agent'
        }
      };

      await useCase.execute(command);

      expect(sampleRepository.create).toHaveBeenCalledWith(
        command.sampleData,
        expect.objectContaining({
          skipValidation: true,
          auditInfo: {
            userId: 'U1',
            userName: 'alice',
            userRole: 'tech',
            ipAddress: '1.2.3.4',
            userAgent: 'agent'
          }
        })
      );
    });

    it('defaults auditInfo fields to null when command.actor is absent', async () => {
      const createdSample = { _id: 'S-3' };
      const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
      const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      await useCase.execute({ sampleData: { barcode: 'BC-3' } });

      expect(sampleRepository.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          auditInfo: {
            userId: null,
            userName: null,
            userRole: null,
            ipAddress: null,
            userAgent: null
          }
        })
      );
    });

    it('returns topology.synced=true and fallbackQueued=false when persistTopology succeeds', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: 'S-4' };
      const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
      const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      const result = await useCase.execute({ sampleData: { barcode: 'BC-4' } });

      expect(result.topology).toEqual({ synced: true, fallbackQueued: false });
      expect(result.strictMode).toBe(false);
    });

    it('rolls back the Mongo sample and throws STRICT_MODE_BLOCKED when persistTopology fails in strict mode', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const createdSample = { _id: 'S-5' };
      const sampleRepository = {
        create: vi.fn().mockResolvedValue(createdSample),
        deleteById: vi.fn().mockResolvedValue(undefined)
      };
      const lineageRepository = {
        createSampleNode: vi.fn().mockRejectedValue(new Error('neo4j down'))
      };
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, logger });

      await expect(useCase.execute({ sampleData: { barcode: 'BC-5' } })).rejects.toMatchObject({
        code: 'STRICT_MODE_BLOCKED',
        statusCode: 403,
        message: expect.stringContaining('neo4j down')
      });

      expect(sampleRepository.deleteById).toHaveBeenCalledWith('S-5');
      expect(logger.error).toHaveBeenCalled();
    });

    it('enqueues for self-healing and does not throw when persistTopology fails in permissive mode', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: 'S-6' };
      const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
      const lineageRepository = {
        createSampleNode: vi.fn().mockRejectedValue(new Error('neo4j down'))
      };
      const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, quarantineService });

      const result = await useCase.execute({ sampleData: { barcode: 'BC-6' } });

      expect(result.topology).toEqual({ synced: false, fallbackQueued: true });
      expect(quarantineService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 'S-6' }),
        expect.objectContaining({ reason: 'neo4j_failure_permissive_mode', strictMode: false })
      );
    });

    // RF023 AC3, RNF019 C1: a create that runs a transaction calls
    // options.onCreatedInTransaction inside it, and the register custody
    // event is appended there with the create's session.
    describe('register custody append inside the create transaction (#1367)', () => {
      // A create that runs a transaction: it calls the in-transaction step
      // with its session and, like an abort, rejects with the step's error.
      // A create offered no step just returns the sample.
      function transactionalCreate(createdSample) {
        return vi.fn(async (_sampleData, options) => {
          if (typeof options.onCreatedInTransaction === 'function') {
            await options.onCreatedInTransaction(createdSample, 'create-session');
          }
          return createdSample;
        });
      }

      it('appends the register event with the create session, once, and reports it synced', async () => {
        env.LINEAGE_MODE = 'fail-open';
        const createdSample = { _id: 'S-T1', barcode: 'BC-T1' };
        const sampleRepository = { create: transactionalCreate(createdSample) };
        const lineageRepository = { recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt' }) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

        const result = await useCase.execute({ sampleData: { barcode: 'BC-T1' }, actor: { userId: 'U1' } });

        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
          expect.objectContaining({ specimenId: 'S-T1', barcode: 'BC-T1', eventType: 'register', actorId: 'U1' }),
          { session: 'create-session' }
        );
        expect(result).toEqual({ sample: createdSample, strictMode: false, topology: { synced: true, fallbackQueued: false } });
      });

      it('strict mode: a failed append aborts the create and throws STRICT_MODE_BLOCKED with nothing to roll back', async () => {
        env.LINEAGE_MODE = 'fail-closed';
        const sampleRepository = {
          create: transactionalCreate({ _id: 'S-T2' }),
          deleteById: vi.fn()
        };
        const lineageRepository = { recordCustodyEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, logger: makeLogger() });

        await expect(useCase.execute({ sampleData: { barcode: 'BC-T2' } })).rejects.toMatchObject({
          code: 'STRICT_MODE_BLOCKED',
          statusCode: 403,
          message: expect.stringContaining('outbox down')
        });
        expect(sampleRepository.deleteById).not.toHaveBeenCalled();
        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
      });

      // #1370: a failed append inside a transaction has aborted it at the
      // server, so a permissive create re-runs without the step and the
      // append follows the commit.
      it('permissive mode: a failed append aborts the transaction, the create re-runs without the step, and the append that fails again is queued', async () => {
        env.LINEAGE_MODE = 'fail-open';
        const createdSample = { _id: 'S-T3' };
        const sampleRepository = { create: transactionalCreate(createdSample) };
        const lineageRepository = { recordCustodyEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };
        const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, quarantineService, logger: makeLogger() });

        const result = await useCase.execute({ sampleData: { barcode: 'BC-T3' } });

        expect(result.sample).toBe(createdSample);
        expect(result.topology).toEqual({ synced: false, fallbackQueued: true });
        expect(sampleRepository.create).toHaveBeenCalledTimes(2);
        expect(sampleRepository.create.mock.calls[0][1].onCreatedInTransaction).toEqual(expect.any(Function));
        expect(sampleRepository.create.mock.calls[1][1]).not.toHaveProperty('onCreatedInTransaction');
        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(2);
        expect(lineageRepository.recordCustodyEvent.mock.calls[0][1]).toEqual({ session: 'create-session' });
        expect(lineageRepository.recordCustodyEvent.mock.calls[1]).toHaveLength(1);
        expect(quarantineService.enqueue).toHaveBeenCalledTimes(1);
        expect(quarantineService.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ specimenId: 'S-T3', eventType: 'register' }),
          expect.objectContaining({ reason: 'neo4j_failure_permissive_mode', neo4jError: 'outbox down', strictMode: false })
        );
      });

      it('permissive mode: an append that fails in the transaction and succeeds after the commit is synced, nothing queued', async () => {
        env.LINEAGE_MODE = 'fail-open';
        const createdSample = { _id: 'S-T6' };
        const sampleRepository = { create: transactionalCreate(createdSample) };
        const lineageRepository = {
          recordCustodyEvent: vi.fn()
            .mockRejectedValueOnce(new Error('outbox down'))
            .mockResolvedValueOnce({ eventId: 'evt' })
        };
        const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, quarantineService, logger: makeLogger() });

        const result = await useCase.execute({ sampleData: { barcode: 'BC-T6' } });

        expect(result).toEqual({ sample: createdSample, strictMode: false, topology: { synced: true, fallbackQueued: false } });
        expect(sampleRepository.create).toHaveBeenCalledTimes(2);
        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(2);
        expect(quarantineService.enqueue).not.toHaveBeenCalled();
      });

      it('permissive mode: a transient transaction error from the append is rethrown as itself for the driver to retry', async () => {
        env.LINEAGE_MODE = 'fail-open';
        const transientError = new MongoServerError({ message: 'x', code: 112, errorLabels: ['TransientTransactionError'] });
        const sampleRepository = { create: transactionalCreate({ _id: 'S-T7' }) };
        const lineageRepository = { recordCustodyEvent: vi.fn().mockRejectedValue(transientError) };
        const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository, quarantineService, logger: makeLogger() });

        await expect(useCase.execute({ sampleData: { barcode: 'BC-T7' } })).rejects.toBe(transientError);
        expect(sampleRepository.create).toHaveBeenCalledTimes(1);
        expect(quarantineService.enqueue).not.toHaveBeenCalled();
      });

      it('a create that runs no transaction never calls the step, and the append follows it with no session, as before', async () => {
        env.LINEAGE_MODE = 'fail-open';
        const createdSample = { _id: 'S-T4' };
        const sampleRepository = { create: vi.fn().mockResolvedValue(createdSample) };
        const lineageRepository = { recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt' }) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

        const result = await useCase.execute({ sampleData: { barcode: 'BC-T4' } });

        expect(sampleRepository.create.mock.calls[0][1].onCreatedInTransaction).toEqual(expect.any(Function));
        expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
        expect(lineageRepository.recordCustodyEvent.mock.calls[0]).toHaveLength(1);
        expect(result.topology).toEqual({ synced: true, fallbackQueued: false });
      });

      it('offers no in-transaction step to a lineage repository without recordCustodyEvent', async () => {
        const sampleRepository = { create: vi.fn().mockResolvedValue({ _id: 'S-T5' }) };
        const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
        const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

        await useCase.execute({ sampleData: { barcode: 'BC-T5' } });

        expect(sampleRepository.create.mock.calls[0][1].onCreatedInTransaction).toBeUndefined();
      });
    });

    it('logs and re-throws when sampleRepository.create itself fails', async () => {
      const sampleRepository = { create: vi.fn().mockRejectedValue(new Error('mongo down')) };
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({ sampleRepository, logger });

      await expect(useCase.execute({ sampleData: { barcode: 'BC-7' } })).rejects.toThrow('mongo down');
      expect(logger.error).toHaveBeenCalledWith(
        '[RegisterSampleUseCase] Falha no registro de amostra:',
        'mongo down'
      );
    });
  });

  describe('resolveStrictMode', () => {
    const sampleRepository = { create: vi.fn() };

    it('is strict when env.LINEAGE_MODE is fail-closed regardless of sampleData', () => {
      env.LINEAGE_MODE = 'fail-closed';
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      expect(useCase.resolveStrictMode({})).toBe(true);
    });

    it('is strict when isRareDisease is true', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      expect(useCase.resolveStrictMode({ isRareDisease: true })).toBe(true);
    });

    it.each(['high', 'critical', 'alto', 'crítico', 'critico', 'HIGH'])(
      'is strict for high-risk riskLevel "%s"',
      (riskLevel) => {
        env.LINEAGE_MODE = 'fail-open';
        const useCase = new RegisterSampleUseCase({ sampleRepository });
        expect(useCase.resolveStrictMode({ riskLevel })).toBe(true);
      }
    );

    it('falls back to riskGrade when riskLevel is absent', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      expect(useCase.resolveStrictMode({ riskGrade: 'critical' })).toBe(true);
    });

    it('is strict when riskScore >= 7', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      expect(useCase.resolveStrictMode({ riskScore: 7 })).toBe(true);
      expect(useCase.resolveStrictMode({ riskScore: '9' })).toBe(true);
    });

    it('is permissive when no risk indicator is present', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      expect(useCase.resolveStrictMode({ riskScore: 6.9, riskLevel: 'low' })).toBe(false);
      expect(useCase.resolveStrictMode({})).toBe(false);
    });
  });

  describe('buildLineagePayload', () => {
    it('prefers createdSample._id, then .id, then sampleData.id for specimenId', () => {
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      expect(useCase.buildLineagePayload({ _id: 'A' }, { id: 'B' }, {}).specimenId).toBe('A');
      expect(useCase.buildLineagePayload({ id: 'B' }, { id: 'C' }, {}).specimenId).toBe('B');
      expect(useCase.buildLineagePayload({}, { id: 'C' }, {}).specimenId).toBe('C');
    });

    it('prefers createdSample.barcode over sampleData.barcode, nulling when neither is present', () => {
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      expect(useCase.buildLineagePayload({ barcode: 'X' }, { barcode: 'Y' }, {}).barcode).toBe('X');
      expect(useCase.buildLineagePayload({}, { barcode: 'Y' }, {}).barcode).toBe('Y');
      expect(useCase.buildLineagePayload({}, {}, {}).barcode).toBeNull();
    });

    it('carries actorId from command.actor.userId and normalizes riskScore to a Number or null', () => {
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      const payload = useCase.buildLineagePayload(
        { _id: 'S' },
        { isRareDisease: true, riskLevel: 'alto', riskScore: '8' },
        { actor: { userId: 'U9' } }
      );

      expect(payload.actorId).toBe('U9');
      expect(payload.eventType).toBe('register');
      expect(payload.happenedAt).toBeInstanceOf(Date);
      expect(payload.metadata).toEqual({ isRareDisease: true, riskLevel: 'alto', riskScore: 8 });
    });

    it('nulls metadata.riskScore when it is not a finite number', () => {
      const sampleRepository = { create: vi.fn() };
      const useCase = new RegisterSampleUseCase({ sampleRepository });

      const payload = useCase.buildLineagePayload({ _id: 'S' }, { riskScore: 'not-a-number' }, {});
      expect(payload.metadata.riskScore).toBeNull();
    });
  });

  describe('persistTopology', () => {
    const sampleRepository = { create: vi.fn() };

    it('throws when no lineageRepository is injected', async () => {
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      await expect(useCase.persistTopology({})).rejects.toThrow('LineageRepository não injetado');
    });

    // #1312: the graph-side derivation writer is gone; a register step is
    // the custody event, whatever the payload carries.
    it('records the custody event even when the payload names a parent, calling no derivation writer', async () => {
      const lineageRepository = {
        createSampleNodeWithParent: vi.fn(),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });
      const payload = { specimenId: 'S1', eventType: 'register', parentSampleId: 'P1' };

      await useCase.persistTopology(payload);

      expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(payload);
      expect(lineageRepository.createSampleNodeWithParent).not.toHaveBeenCalled();
    });

    it('uses recordCustodyEvent when the repository has it', async () => {
      const lineageRepository = {
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined),
        createSampleNode: vi.fn()
      };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      await useCase.persistTopology({});

      expect(lineageRepository.recordCustodyEvent).toHaveBeenCalled();
      expect(lineageRepository.createSampleNode).not.toHaveBeenCalled();
    });

    it('falls back to createSampleNode when neither of the above methods exist', async () => {
      const lineageRepository = { createSampleNode: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository });

      await useCase.persistTopology({});

      expect(lineageRepository.createSampleNode).toHaveBeenCalled();
    });

    it('throws when lineageRepository has no compatible persistence method', async () => {
      const useCase = new RegisterSampleUseCase({ sampleRepository, lineageRepository: {} });
      await expect(useCase.persistTopology({})).rejects.toThrow(
        'LineageRepository sem método de persistência topológica compatível'
      );
    });
  });

  describe('rollbackMongoSample', () => {
    const sampleRepository = { create: vi.fn() };

    it('is a no-op when createdSample has no id', async () => {
      const deleteById = vi.fn();
      const useCase = new RegisterSampleUseCase({ sampleRepository: { create: vi.fn(), deleteById } });
      await useCase.rollbackMongoSample({});
      expect(deleteById).not.toHaveBeenCalled();
    });

    it('is a no-op when sampleRepository has no deleteById', async () => {
      const useCase = new RegisterSampleUseCase({ sampleRepository });
      await expect(useCase.rollbackMongoSample({ _id: 'S1' })).resolves.toBeUndefined();
    });

    it('deletes by id and warns on success', async () => {
      const deleteById = vi.fn().mockResolvedValue(undefined);
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({
        sampleRepository: { create: vi.fn(), deleteById },
        logger
      });

      await useCase.rollbackMongoSample({ _id: 'S1' });

      expect(deleteById).toHaveBeenCalledWith('S1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to createdSample.id when _id is absent', async () => {
      const deleteById = vi.fn().mockResolvedValue(undefined);
      const useCase = new RegisterSampleUseCase({ sampleRepository: { create: vi.fn(), deleteById } });

      await useCase.rollbackMongoSample({ id: 'S2' });

      expect(deleteById).toHaveBeenCalledWith('S2');
    });

    it('logs an error and swallows the failure when deleteById itself rejects', async () => {
      const deleteById = vi.fn().mockRejectedValue(new Error('delete failed'));
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({
        sampleRepository: { create: vi.fn(), deleteById },
        logger
      });

      await expect(useCase.rollbackMongoSample({ _id: 'S3' })).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('enqueueForSelfHealing', () => {
    const sampleRepository = { create: vi.fn() };

    it('warns and returns false when no quarantineService is configured', async () => {
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({ sampleRepository, logger });

      const result = await useCase.enqueueForSelfHealing({}, new Error('e'), false);

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('prefers enqueueTopologicalTransaction when available', async () => {
      const quarantineService = {
        enqueueTopologicalTransaction: vi.fn().mockResolvedValue(undefined),
        enqueue: vi.fn()
      };
      const useCase = new RegisterSampleUseCase({ sampleRepository, quarantineService });
      const neo4jError = new Error('boom');

      const result = await useCase.enqueueForSelfHealing({ specimenId: 'S1' }, neo4jError, true);

      expect(result).toBe(true);
      expect(quarantineService.enqueueTopologicalTransaction).toHaveBeenCalledWith(
        { specimenId: 'S1' },
        { reason: 'neo4j_failure_permissive_mode', neo4jError: 'boom', strictMode: true }
      );
      expect(quarantineService.enqueue).not.toHaveBeenCalled();
    });

    it('falls back to enqueue when enqueueTopologicalTransaction is absent', async () => {
      const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, quarantineService });

      const result = await useCase.enqueueForSelfHealing({ specimenId: 'S1' }, new Error('boom'), false);

      expect(result).toBe(true);
      expect(quarantineService.enqueue).toHaveBeenCalled();
    });

    it('stringifies a non-Error neo4jError value', async () => {
      const quarantineService = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSampleUseCase({ sampleRepository, quarantineService });

      await useCase.enqueueForSelfHealing({ specimenId: 'S1' }, 'plain string error', false);

      expect(quarantineService.enqueue).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ neo4jError: 'plain string error' })
      );
    });

    it('warns and returns false when quarantineService has neither compatible method', async () => {
      const logger = makeLogger();
      const useCase = new RegisterSampleUseCase({ sampleRepository, quarantineService: {}, logger });

      const result = await useCase.enqueueForSelfHealing({}, new Error('e'), false);

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
