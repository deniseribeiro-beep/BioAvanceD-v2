/**
 * #798: `logImport`'s payload is hand-picked from `context` key by key
 * (`jobID`, `dataType`, `fhirResourcesCreated`, `fhirResourcesUpdated`,
 * `processingTime`), so a caller passing a new context key has **no effect
 * at all** until that key is read here by name. The three LGPD import
 * controllers now pass `{ skipped }` -- the count of blank rows `isEmptyRow`
 * drops, which deliberately stay out of `total` -- and these tests pin that
 * it actually reaches the stored payload rather than being silently
 * discarded on the way in.
 *
 * That silent-discard is exactly what made this worth a test: passing the
 * value and storing it look identical at the call site, and the import-side
 * tests all pass either way.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// CJS singleton: `vi.mock` does not intercept `require()` in this repo, so
// spy on the real instance -- the module cache guarantees this test and the
// controllers share one object.
const auditLogger = require('../../src/utils/auditLogger');

function captureLog() {
  return vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
}

describe('AuditLogger.logImport -- skipped blank rows (#798)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries context.skipped through to the stored payload', async () => {
    const logSpy = captureLog();

    await auditLogger.logImport({}, 'Patient', 'success', 9, 9, 0, { skipped: 3 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].payload).toMatchObject({
      total: 9,
      success: 9,
      errors: 0,
      skipped: 3,
    });
  });

  it('defaults skipped to 0 when the caller passes no context at all', async () => {
    const logSpy = captureLog();

    await auditLogger.logImport({}, 'Sample', 'success', 4, 4, 0);

    expect(logSpy.mock.calls[0][0].payload.skipped).toBe(0);
  });

  it('defaults skipped to 0 when the context omits it, rather than storing undefined', async () => {
    const logSpy = captureLog();

    await auditLogger.logImport({}, 'Sample', 'success', 4, 4, 0, { jobID: 'job-1' });

    expect(logSpy.mock.calls[0][0].payload.skipped).toBe(0);
    expect(logSpy.mock.calls[0][0].payload.jobID).toBe('job-1');
  });

  it('leaves total, success and errors untouched -- skipped is a separate tally', async () => {
    const logSpy = captureLog();

    // The invariant the import loops maintain: blank rows never enter
    // total, so total still equals success + errors regardless of skipped.
    await auditLogger.logImport({}, 'Patient', 'partial', 9, 7, 2, { skipped: 3 });

    const { payload } = logSpy.mock.calls[0][0];
    expect(payload.total).toBe(9);
    expect(payload.success).toBe(7);
    expect(payload.errors).toBe(2);
    expect(payload.skipped).toBe(3);
    expect(payload.success + payload.errors).toBe(payload.total);
  });
});
