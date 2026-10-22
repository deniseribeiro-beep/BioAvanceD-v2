import { describe, it, expect, vi, afterEach } from 'vitest';

const referenceReleaseController = require('../../src/controllers/referenceRelease.controller');
const referenceReleaseService = require('../../src/services/referenceRelease.service');
const logger = require('../../src/utils/logger');

// RF028 AC8/AC9 (#1319): POST /api/reference-releases/:id/promote and
// POST /api/reference-releases/datasets/:datasetCode/rollback map each
// service outcome to its status.

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildReq(overrides = {}) {
  return {
    app: { locals: { db: { name: 'fake-db' } } },
    params: { id: 'release-1', datasetCode: 'HPO' },
    user: { userID: 'USR-ADMIN' },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('referenceRelease.controller.promote', () => {
  it('answers 200 with the promotion and passes the caller as approvedBy and the request itself', async () => {
    const result = { promoted: true, releaseId: 'release-1', previousReleaseId: null, recordsInserted: 15, recordsUpdated: 0, recordsSkipped: 0 };
    const spy = vi.spyOn(referenceReleaseService, 'promoteRelease').mockResolvedValue(result);
    const req = buildReq();
    const res = buildRes();

    await referenceReleaseController.promote(req, res);

    expect(spy).toHaveBeenCalledWith({ db: req.app.locals.db, releaseId: 'release-1', approvedBy: 'USR-ADMIN', req });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it.each([
    ['release_not_found', 404],
    ['approver_required', 403],
    ['release_not_approved', 409],
    ['approved_run_not_found', 409],
    ['promotion_in_progress', 409],
    ['coverage_manifest_missing', 409],
    ['coverage_manifest_invalid', 409],
    ['coverage_incomplete', 409],
    ['quality_assessment_missing', 409],
    ['quality_assessment_failed', 409],
  ])('answers a refused promotion %s with %i and its reason', async (reason, status) => {
    vi.spyOn(referenceReleaseService, 'promoteRelease').mockResolvedValue({ promoted: false, reason });
    const res = buildRes();

    await referenceReleaseController.promote(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: reason });
  });

  it('answers 503 without calling the service when no db is attached', async () => {
    const spy = vi.spyOn(referenceReleaseService, 'promoteRelease');
    const res = buildRes();

    await referenceReleaseController.promote(buildReq({ app: { locals: { db: null } } }), res);

    expect(spy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('answers 500 when the service throws', async () => {
    vi.spyOn(referenceReleaseService, 'promoteRelease').mockRejectedValue(new Error('boom'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = buildRes();

    await referenceReleaseController.promote(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe('referenceRelease.controller.rollback', () => {
  it('answers 200 with the rollback and passes the caller as initiatedBy and the request itself', async () => {
    const result = { rolledBack: true, activeReleaseId: 'release-0', rolledBackReleaseId: 'release-1' };
    const spy = vi.spyOn(referenceReleaseService, 'rollbackRelease').mockResolvedValue(result);
    const req = buildReq();
    const res = buildRes();

    await referenceReleaseController.rollback(req, res);

    expect(spy).toHaveBeenCalledWith({ db: req.app.locals.db, datasetCode: 'HPO', initiatedBy: 'USR-ADMIN', req });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it.each([
    ['no_active_release', 404],
    ['no_previous_release', 409],
    ['previous_release_not_found', 409],
  ])('answers a refused rollback %s with %i and its reason', async (reason, status) => {
    vi.spyOn(referenceReleaseService, 'rollbackRelease').mockResolvedValue({ rolledBack: false, reason });
    const res = buildRes();

    await referenceReleaseController.rollback(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: reason });
  });

  it('answers 403 without calling the service when the caller has no userID', async () => {
    const spy = vi.spyOn(referenceReleaseService, 'rollbackRelease');
    const res = buildRes();

    await referenceReleaseController.rollback(buildReq({ user: {} }), res);

    expect(spy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('answers 503 without calling the service when no db is attached', async () => {
    const spy = vi.spyOn(referenceReleaseService, 'rollbackRelease');
    const res = buildRes();

    await referenceReleaseController.rollback(buildReq({ app: { locals: { db: null } } }), res);

    expect(spy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('answers 500 when the service throws', async () => {
    vi.spyOn(referenceReleaseService, 'rollbackRelease').mockRejectedValue(new Error('boom'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = buildRes();

    await referenceReleaseController.rollback(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
