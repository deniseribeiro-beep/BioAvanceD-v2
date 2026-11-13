const mongo = require('../../src/database/mongo');
const consentService = require('../../src/services/consent.service');
const logger = require('../../src/utils/logger');
const job = require('../../src/workers/jobs/consent-expiry.job');

describe('consent-expiry.job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(mongo, 'connectDB').mockResolvedValue({ name: 'bioavanced_test' });
    vi.spyOn(consentService, 'expireDueConsents').mockResolvedValue({ closed: 0 });
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
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

  it('schedules when the timer cannot leave the event loop', () => {
    vi.spyOn(global, 'setTimeout').mockImplementation(() => ({}));

    expect(() => job.scheduleNextRun()).not.toThrow();
  });
});
