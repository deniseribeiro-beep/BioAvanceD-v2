import { afterEach, describe, expect, it, vi } from 'vitest';

const logService = require('../../../src/services/log.service');
const securityAlertsService = require('../../../src/services/securityAlerts.service');
const auditLogger = require('../../../src/utils/auditLogger');

afterEach(() => {
  vi.restoreAllMocks();
  auditLogger.db = null;
});

describe('auditLogger item 8 residual branches', () => {
  it('honors occurredAt and an explicit action on log()', async () => {
    const createLog = vi.spyOn(logService, 'createLog').mockResolvedValue(undefined);
    auditLogger.init({ collection: vi.fn() });

    await auditLogger.log({
      action: 'CUSTOM',
      resourceType: 'Sample',
      resourceId: 'res-1',
      status: 'success',
      occurredAt: '2026-09-18T10:00:00.000Z',
      message: 'explicit',
    });

    expect(createLog).toHaveBeenCalled();
    const [, payload] = createLog.mock.calls[0];
    expect(payload).toEqual(expect.objectContaining({
      action: 'CUSTOM',
      resourceId: 'res-1',
      timestamp: new Date('2026-09-18T10:00:00.000Z'),
    }));
  });

  it('defaults missing action to LOG and stamps now when occurredAt is omitted', async () => {
    const createLog = vi.spyOn(logService, 'createLog').mockResolvedValue(undefined);
    auditLogger.init({ collection: vi.fn() });
    const before = Date.now();

    await auditLogger.log({
      resourceType: 'Sample',
      resourceId: 'res-default-action',
      message: 'no action supplied',
    });

    const [, payload] = createLog.mock.calls[0];
    expect(payload.action).toBe('LOG');
    expect(payload.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(payload.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('passes an explicit non-pending result through logImport status fallback', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    await auditLogger.logImport(
      { headers: {} },
      'Patient',
      'completed',
      5,
      5,
      0,
      { jobID: 'job-1' }
    );

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'IMPORT',
      status: 'success',
      payload: expect.objectContaining({
        status: 'completed',
        jobID: 'job-1',
      }),
    }));
  });

  it('falls back logImport payload status to pending when result is omitted', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    await auditLogger.logImport(
      { headers: {} },
      'Sample',
      undefined,
      2,
      0,
      0,
      { jobID: 'job-pending' }
    );

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'IMPORT',
      payload: expect.objectContaining({
        status: 'pending',
        jobID: 'job-pending',
      }),
    }));
  });

  it('alerts AUDIT_TRAIL_WRITE_FAILURE with default LOG action and String(error) when message is absent', async () => {
    vi.spyOn(logService, 'createLog').mockRejectedValue('plain audit write failure');
    vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
    const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('alert-1');
    auditLogger.init({ collection: vi.fn() });

    await auditLogger.log({
      resourceType: 'Sample',
      resourceId: 'res-fail',
      message: 'will fail write',
    });

    expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'AUDIT_TRAIL_WRITE_FAILURE',
      details: expect.objectContaining({
        attemptedAction: 'LOG',
        error: 'plain audit write failure',
      }),
    }));
  });
});
