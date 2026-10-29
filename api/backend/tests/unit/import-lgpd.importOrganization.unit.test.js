/**
 * #1353: the LGPD imports write organization-owned records, and now stamp
 * them the way POST /api/samples and POST /api/pacientes do (#1185): each
 * sample's collectionSite and each participant's clinicalUnitId is the
 * organization resolveOrganizationIdForCreate picks from the importer's
 * scope, resolved once per import, before any row is read. The routes carry
 * requireOrganizationScope, and the smart-import report list is scoped like
 * the quarantine batches.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/import-lgpd.service');
const controller = require('../../src/controllers/import-lgpd.controller');

const ONE_ORG = { scope: 'organization', organizationIds: ['org-a'] };
const TWO_ORGS = { scope: 'organization', organizationIds: ['org-a', 'org-b'] };
const GLOBAL = { scope: 'global', organizationIds: [] };

function dbWithOrganizations(ids = []) {
  const organizations = { findOne: vi.fn(async ({ organizationId }) => (ids.includes(organizationId) ? { organizationId } : null)) };
  return { organizations, db: { collection: (name) => (name === 'organizations' ? organizations : {}) } };
}

function makeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('LGPD import organization stamp (#1353)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveImportTargetOrganizationId', () => {
    const resolve = (organizationScope, body = {}, orgs = []) =>
      controller.resolveImportTargetOrganizationId(dbWithOrganizations(orgs).db, { organizationScope, body });

    it("gives a single-organization caller their own organization, whatever the form names", async () => {
      await expect(resolve(ONE_ORG)).resolves.toBe('org-a');
      await expect(resolve(ONE_ORG, { organizationId: 'org-z' })).resolves.toBe('org-a');
    });

    it('takes one of a multi-organization caller\'s own organizations, and 400s a missing or foreign one', async () => {
      await expect(resolve(TWO_ORGS, { organizationId: 'org-b' })).resolves.toBe('org-b');
      expect((await resolve(TWO_ORGS).catch((e) => e)).statusCode).toBe(400);
      expect((await resolve(TWO_ORGS, { organizationId: 'org-z' }).catch((e) => e)).statusCode).toBe(400);
    });

    it('lets a global caller name an existing organization or none, and 404s an unknown one', async () => {
      await expect(resolve(GLOBAL)).resolves.toBeNull();
      await expect(resolve(GLOBAL, { organizationId: 'org-z' }, ['org-z'])).resolves.toBe('org-z');
      expect((await resolve(GLOBAL, { organizationId: 'org-y' }, ['org-z']).catch((e) => e)).statusCode).toBe(404);
    });

    it('fails closed with 403 when the route supplied no scope', async () => {
      expect((await resolve(undefined).catch((e) => e)).statusCode).toBe(403);
    });
  });

  describe('importSamples', () => {
    const file = { path: '/tmp/x.csv', originalname: 'x.csv' };

    it('forwards the resolved organization to the service', async () => {
      vi.spyOn(service, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(service, 'cleanupFile').mockReturnValue(undefined);
      const importSpy = vi.spyOn(service, 'importSamples').mockResolvedValue({ total: 0, success: 0, errors: [], skipped: 0, duplicates: 0 });
      vi.spyOn(controller, 'resolveImportOrganizationIds').mockResolvedValue(['org-a']);
      const res = makeRes();

      await controller.importSamples({ organizationScope: ONE_ORG, app: { locals: { db: dbWithOrganizations().db } }, file, body: {} }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(importSpy.mock.calls[0][2]).toMatchObject({ organizationId: 'org-a' });
    });

    it('answers a refusal with its status and reads no row', async () => {
      vi.spyOn(service, 'validateFileFormat').mockReturnValue(true);
      const cleanup = vi.spyOn(service, 'cleanupFile').mockReturnValue(undefined);
      const importSpy = vi.spyOn(service, 'importSamples');
      const res = makeRes();

      await controller.importSamples({ organizationScope: TWO_ORGS, app: { locals: { db: dbWithOrganizations().db } }, file, body: {} }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(importSpy).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledWith('/tmp/x.csv');
    });
  });

  describe('listSmartImportReports', () => {
    function dbCapturingFilter() {
      const seen = {};
      const reports = {
        find: vi.fn((filter) => {
          seen.filter = filter;
          return { sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
        }),
        countDocuments: vi.fn(async () => 0),
      };
      return { seen, db: { collection: () => reports } };
    }

    it('lists only reports stamped with one of an organization-scoped caller\'s organizations', async () => {
      const { seen, db } = dbCapturingFilter();
      await controller.listSmartImportReports({ organizationScope: ONE_ORG, app: { locals: { db } }, query: {} }, makeRes());
      expect(seen.filter).toEqual({ type: 'patients-smart-import', organizationIds: { $in: ['org-a'] } });
    });

    it('leaves a global caller\'s list unfiltered', async () => {
      const { seen, db } = dbCapturingFilter();
      await controller.listSmartImportReports({ organizationScope: GLOBAL, app: { locals: { db } }, query: {} }, makeRes());
      expect(seen.filter).toEqual({ type: 'patients-smart-import' });
    });
  });
});
