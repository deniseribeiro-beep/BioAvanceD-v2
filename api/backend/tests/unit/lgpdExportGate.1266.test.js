import { describe, it, expect, vi, afterEach } from 'vitest';

const securityService = require('../../src/services/security.service');
const { requireDataExportAllowed } = require('../../src/infrastructure/middleware/lgpdExportGate');

// #1266: lgpd.allowDataExport switches the personal-data exports off.

function createRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const reqWith = (db) => ({ app: { locals: { db } } });

afterEach(() => { vi.restoreAllMocks(); });

describe('#1266 requireDataExportAllowed', () => {
  it('passes through while exports are allowed', async () => {
    vi.spyOn(securityService, 'isDataExportAllowed').mockResolvedValue(true);
    const next = vi.fn();
    const res = createRes();
    await requireDataExportAllowed(reqWith({}), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 403 and stops while exports are switched off', async () => {
    vi.spyOn(securityService, 'isDataExportAllowed').mockResolvedValue(false);
    const next = vi.fn();
    const res = createRes();
    await requireDataExportAllowed(reqWith({}), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Exportação desabilitada' }));
  });

  it('with no database it defers to the route, whose own 503 answers', async () => {
    const spy = vi.spyOn(securityService, 'isDataExportAllowed');
    const next = vi.fn();
    await requireDataExportAllowed(reqWith(undefined), createRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('#1266 isDataExportAllowed reads lgpd.allowDataExport', () => {
  const dbWith = (doc) => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue(doc) }) });

  it('false only for an explicit false; an unreadable document refuses', async () => {
    expect(await securityService.isDataExportAllowed(dbWith({ lgpd: { allowDataExport: false } }))).toBe(false);
    expect(await securityService.isDataExportAllowed(dbWith({ lgpd: { allowDataExport: true } }))).toBe(true);
    expect(await securityService.isDataExportAllowed(dbWith(null))).toBe(true);
    const broken = { collection: () => ({ findOne: vi.fn().mockRejectedValue(new Error('down')) }) };
    expect(await securityService.isDataExportAllowed(broken)).toBe(false);
  });

  it('reads its own key, not allowDataDeletion', async () => {
    const db = dbWith({ lgpd: { allowDataDeletion: false, allowDataExport: true } });
    expect(await securityService.isDataExportAllowed(db)).toBe(true);
    expect(await securityService.isDataDeletionAllowed(db)).toBe(false);
  });
});

describe('#1266 the gate is mounted on the sample-file exports, and only there', () => {
  const router = require('../../src/interface/routes/sample.routes');
  const gated = (path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
    return layer.route.stack.some((s) => s.handle === requireDataExportAllowed);
  };

  it('HL7, FHIR and CDA carry it', () => {
    for (const kind of ['hl7', 'fhir', 'cda']) {
      expect(gated(`/:specimenId/files/:fileID/export/${kind}`), kind).toBe(true);
    }
  });

  it('CONTROL: the raw file download does not', () => {
    expect(gated('/:specimenId/files/:fileID/download')).toBe(false);
  });
});

describe('#1266 anonymizeOnExport is fixed at true', () => {
  it('is in FIXED_PATHS with the export-pseudonymised reason', () => {
    expect(securityService.FIXED_PATHS['lgpd.anonymizeOnExport']).toEqual({ value: true, reason: 'export-pseudonymised' });
    expect(securityService.FIXED_PATHS['lgpd.allowDataExport']).toBeUndefined();
  });
});
