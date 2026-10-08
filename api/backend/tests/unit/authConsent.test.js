/**
 * tests/unit/authConsent.test.js
 * Unit tests for src/infrastructure/middleware/authConsent.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { authConsent, createConsentMiddleware } = require('../../src/infrastructure/middleware/authConsent');
const auditLogger = require('../../src/utils/auditLogger');

// Note: authConsent.js does `const { getCollection } = require('../../utils/collectionResolver')`
// at module load time, so vi.spyOn(collectionResolver, 'getCollection') cannot intercept the
// already-destructured reference. Instead we simulate getCollection's real behavior: since our
// fake db has no listCollections, resolveCollectionName falls back to calling db.collection(name)
// directly, so we stub db.collection() itself.

function createReq(overrides = {}) {
  return {
    app: { locals: {} },
    body: {},
    params: {},
    query: {},
    method: 'POST',
    path: '/x',
    headers: {},
    ...overrides
  };
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

describe('authConsent middleware', () => {
  let fakeDb;
  let fakeConsentsCollection;
  let next;

  beforeEach(() => {
    fakeConsentsCollection = { findOne: vi.fn() };
    fakeDb = { collection: vi.fn().mockReturnValue(fakeConsentsCollection) };
    next = vi.fn();

    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 DB_UNAVAILABLE and does not call next when db is missing', async () => {
    const req = createReq({ body: { participantId: 'p1' } });
    // no db set on app.locals
    const res = createRes();

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DB_UNAVAILABLE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves participantId from req.body when participantIdResolver is a string', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'bodyPatient' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'bodyPatient' }),
      expect.anything()
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves participantId from req.params when not present in body', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, params: { participantId: 'paramsPatient' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'paramsPatient' }),
      expect.anything()
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves participantId from req.query when not present in body/params', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, query: { participantId: 'queryPatient' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'queryPatient' }),
      expect.anything()
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves participantId from req.locals when not present in body/params/query', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, locals: { participantId: 'localsPatient' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'localsPatient' }),
      expect.anything()
    );
    expect(next).toHaveBeenCalled();
  });

  it('honors precedence body > params > query > locals', async () => {
    const req = createReq({
      app: { locals: { db: fakeDb } },
      body: { participantId: 'fromBody' },
      params: { participantId: 'fromParams' },
      query: { participantId: 'fromQuery' },
      locals: { participantId: 'fromLocals' }
    });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'fromBody' }),
      expect.anything()
    );
  });

  it('uses participantIdResolver as a function, calling it with req', async () => {
    const resolverFn = vi.fn().mockReturnValue('fnPatient');
    const req = createReq({ app: { locals: { db: fakeDb } } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ participantIdResolver: resolverFn });
    await middleware(req, res, next);

    expect(resolverFn).toHaveBeenCalledWith(req);
    expect(fakeConsentsCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: 'fnPatient' }),
      expect.anything()
    );
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 PATIENT_ID_MISSING when no participantId can be resolved', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } } });
    const res = createRes();

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PATIENT_ID_MISSING' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 CONSENT_REQUIRED when no active consent found and strictMode is true', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue(null);

    const middleware = authConsent({ strictMode: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through to next() when no active consent found and strictMode is false', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue(null);

    const middleware = authConsent({ strictMode: false });
    await middleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 INSUFFICIENT_SCOPE when active consent lacks required scope and strictMode is true', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_comercial: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ allowedScopes: ['uso_pesquisa'], strictMode: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
    expect(next).not.toHaveBeenCalled();
  });

  // RF010 AC6: a scoped revocation leaves the consent ACTIVE and its
  // responses as given; the permission it blocks is gone from what the
  // consent permits, and enforcement reads that.
  it('returns 403 INSUFFICIENT_SCOPE for a permission a scoped revocation blocked', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      currentStateDerived: 'partially_revoked',
      responses: { uso_pesquisa: true, uso_comercial: true },
      effectivePermissions: { uso_pesquisa: false, uso_comercial: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ allowedScopes: ['uso_pesquisa'], strictMode: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through to next() when scope insufficient but strictMode is false', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_comercial: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ allowedScopes: ['uso_pesquisa'], strictMode: false });
    await middleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 CONSENT_REVOKED when consent status is REVOKED, regardless of strictMode', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'REVOKED',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ strictMode: false });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REVOKED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 CONSENT_REVOKED when revokedAt is truthy, regardless of strictMode', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      revokedAt: new Date('2025-01-01'),
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = authConsent({ strictMode: false });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REVOKED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and populates req.consent for a fully valid consent', async () => {
    const signedAt = new Date('2025-05-01');
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'consent-id-1' },
      status: 'ACTIVE',
      signedAt,
      responses: { uso_pesquisa: true }
    });

    const middleware = authConsent({ allowedScopes: ['uso_pesquisa'] });
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.consent).toEqual(expect.objectContaining({
      participantId: 'p1',
      consentID: 'consent-id-1',
      status: 'ACTIVE',
      signedAt,
      scopes: { uso_pesquisa: true },
      validated: true
    }));
    expect(req.consent.validatedAt).toBeInstanceOf(Date);
  });

  it('returns 500 CONSENT_VALIDATION_ERROR when an unexpected error is thrown', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeDb.collection.mockImplementation(() => {
      throw new Error('boom');
    });

    const middleware = authConsent();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_VALIDATION_ERROR' }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createConsentMiddleware factories', () => {
  let fakeDb;
  let fakeConsentsCollection;
  let next;

  beforeEach(() => {
    fakeConsentsCollection = { findOne: vi.fn() };
    fakeDb = { collection: vi.fn().mockReturnValue(fakeConsentsCollection) };
    next = vi.fn();

    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('research() merges uso_pesquisa into allowedScopes and allows next() when granted', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = createConsentMiddleware.research();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('commercial() merges uso_comercial into allowedScopes and blocks with INSUFFICIENT_SCOPE when missing', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { uso_pesquisa: true },
      signedAt: new Date()
    });

    const middleware = createConsentMiddleware.commercial();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('generic() uses exactly the provided allowedScopes', async () => {
    const req = createReq({ app: { locals: { db: fakeDb } }, body: { participantId: 'p1' } });
    const res = createRes();
    fakeConsentsCollection.findOne.mockResolvedValue({
      _id: { toString: () => 'c1' },
      status: 'ACTIVE',
      responses: { custom_scope: true },
      signedAt: new Date()
    });

    const middleware = createConsentMiddleware.generic(['custom_scope']);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
