const mongo = require('../../src/database/mongo');
const consentService = require('../../src/services/consent.service');
const logger = require('../../src/utils/logger');
// #1468: the job calls jobMetrics.recordJob on the module, so this spy
// intercepts it; its own behaviour is proven in
// tests/unit/infrastructure/metrics/jobMetrics.test.js.
const jobMetrics = require('../../src/infrastructure/metrics/jobMetrics');
const requestContext = require('../../src/utils/requestContext');
const job = require('../../src/workers/jobs/consent-expiry.job');

describe('consent-expiry.job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(mongo, 'connectDB').mockResolvedValue({ name: 'bioavanced_test' });
    vi.spyOn(consentService, 'expireDueConsents').mockResolvedValue({ closed: 0 });
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(jobMetrics, 'recordJob').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes due terms and records how many ended', async () => {
    consentService.expireDueConsents.mockResolvedValue({ closed: 2 });

    job.scheduleNextRun();
    await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

    expect(consentService.expireDueConsents).toHaveBeenCalledWith({ name: 'bioavanced_test' });
    expect(logger.info).toHaveBeenCalledWith('Termos encerrados por vencimento: 2');
  });

  it('stays quiet when no term ended', async () => {
    job.scheduleNextRun();
    await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('records the failure and keeps the next sweep scheduled', async () => {
    consentService.expireDueConsents
      .mockRejectedValueOnce(new Error('mongo fora'))
      .mockResolvedValueOnce({ closed: 1 });

    job.scheduleNextRun();
    await vi.advanceTimersByTimeAsync(job.SWEEP_MS);
    expect(logger.error).toHaveBeenCalledWith('Erro na varredura de vencimento do TCLE:', 'mongo fora');

    await vi.advanceTimersByTimeAsync(job.SWEEP_MS);
    expect(logger.info).toHaveBeenCalledWith('Termos encerrados por vencimento: 1');
  });

  it('records a failure that has no message of its own', async () => {
    consentService.expireDueConsents.mockRejectedValueOnce('falha');

    job.scheduleNextRun();
    await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

    expect(logger.error).toHaveBeenCalledWith('Erro na varredura de vencimento do TCLE:', 'falha');
  });

  // #1468 (RNF015 C1/C3): each sweep is recorded once, under its own id.
  describe('#1468 sweep metrics', () => {
    function captureRecords() {
      const records = [];
      jobMetrics.recordJob.mockImplementation(async (db, entry) => {
        records.push({ db, ...entry, requestId: requestContext.currentRequestId() });
      });
      return records;
    }

    it('records a completed sweep once, under a fresh well-formed correlation id', async () => {
      const records = captureRecords();

      job.scheduleNextRun();
      await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ db: { name: 'bioavanced_test' }, worker: 'consent-expiry', job: 'sweep', outcome: 'completed' });
      expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(requestContext.WELL_FORMED.test(records[0].requestId)).toBe(true);
    });

    it('records a sweep that throws as failed, and keeps the next sweep scheduled', async () => {
      const records = captureRecords();
      consentService.expireDueConsents.mockRejectedValueOnce(new Error('mongo fora'));

      job.scheduleNextRun();
      await vi.advanceTimersByTimeAsync(job.SWEEP_MS);
      await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

      expect(records.map((r) => r.outcome)).toEqual(['failed', 'completed']);
      expect(records[0].requestId).not.toBe(records[1].requestId);
    });

    it('records nothing when connectDB fails', async () => {
      const records = captureRecords();
      mongo.connectDB.mockRejectedValueOnce(new Error('mongo fora'));

      job.scheduleNextRun();
      await vi.advanceTimersByTimeAsync(job.SWEEP_MS);

      expect(records).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('Erro na varredura de vencimento do TCLE:', 'mongo fora');
    });
  });

  it('schedules when the timer cannot leave the event loop', () => {
    vi.spyOn(global, 'setTimeout').mockImplementation(() => ({}));

    expect(() => job.scheduleNextRun()).not.toThrow();
  });
});
