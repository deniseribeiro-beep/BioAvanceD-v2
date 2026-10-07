import { describe, it, expect, vi, afterEach } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require().
// consent.enforcement.js does plain `const consentValidator =
// require('../../services/consent.validator')` at module scope, and that
// module exports a singleton instance. Node's CJS module cache guarantees
// the middleware and this test share the same object instance, so we
// require the real singleton and vi.spyOn() its methods, restoring with
// vi.restoreAllMocks() in afterEach — same pattern as
// tests/unit/controllers/consent.controller.test.js.
const consentValidator = require('../../src/services/consent.validator');
const { enforceCommercialConsent } = require('../../src/infrastructure/middleware/consent.enforcement');

function buildReqRes({ db = {}, body = {}, params = {} } = {}) {
  const req = { app: { locals: { db } }, body, params };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceCommercialConsent', () => {
  it('returns 503 when req.app.locals.db is missing', async () => {
    const initSpy = vi.spyOn(consentValidator, 'init');
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess');
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ db: null });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
    expect(next).not.toHaveBeenCalled();
    expect(initSpy).not.toHaveBeenCalled();
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it('resolves specimenId from body.specimenId by default and calls next on success', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ body: { specimenId: 'spec-1' } });

    await middleware(req, res, next);

    expect(consentValidator.init).toHaveBeenCalledWith(req.app.locals.db);
    expect(validateSpy).toHaveBeenCalledWith('spec-1', 'uso_comercial');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('falls back to params.specimenId when body has none', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ body: {}, params: { specimenId: 'spec-params' } });

    await middleware(req, res, next);

    expect(validateSpy).toHaveBeenCalledWith('spec-params', 'uso_comercial');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to params.id when neither body nor params.specimenId are set', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ body: {}, params: { id: 'param-id' } });

    await middleware(req, res, next);

    expect(validateSpy).toHaveBeenCalledWith('param-id', 'uso_comercial');
  });

  it('resolves to null when no id source is present', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ body: {}, params: {} });

    await middleware(req, res, next);

    expect(validateSpy).toHaveBeenCalledWith(null, 'uso_comercial');
  });

  it('honors a custom scope option', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const middleware = enforceCommercialConsent({ scope: 'pesquisa' });
    const { req, res, next } = buildReqRes({ body: { specimenId: 'spec-1' } });

    await middleware(req, res, next);

    expect(validateSpy).toHaveBeenCalledWith('spec-1', 'pesquisa');
  });

  it('honors a custom resolveSampleId option', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateSpy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const resolveSampleId = vi.fn(() => 'custom-id');
    const middleware = enforceCommercialConsent({ resolveSampleId });
    const { req, res, next } = buildReqRes({ body: { specimenId: 'spec-1' } });

    await middleware(req, res, next);

    expect(resolveSampleId).toHaveBeenCalledWith(req);
    expect(validateSpy).toHaveBeenCalledWith('custom-id', 'uso_comercial');
  });

  it('returns 403 with the validator error message when validation fails', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    vi.spyOn(consentValidator, 'validateAccess').mockRejectedValue(new Error('Consentimento inexistente'));
    const middleware = enforceCommercialConsent();
    const { req, res, next } = buildReqRes({ body: { specimenId: 'spec-1' } });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Consentimento insuficiente para uso comercial',
      message: 'Consentimento inexistente',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
