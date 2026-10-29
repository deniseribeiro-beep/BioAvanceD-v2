import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { resolveCallerCreateOrganization } = require('../../src/services/callerCreateOrganization.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1376: the create rule POST /api/samples applies, resolved from the caller
// for the create paths that carry no route-level scope.
function buildDb(users, organizations = []) {
  const organizationsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => organizations.find((o) => o.organizationId === query.organizationId) || null),
  });
  const db = createDbMock({
    organizations: organizationsCollection,
    ...buildRbacCollections(users),
  });
  return { db, organizationsCollection };
}

const SAMPLE_ONLY_ROLE = { roleCode: 'sample-only', hierarchyLevel: null, permissions: ['createSample'] };

describe('#1376 resolveCallerCreateOrganization', () => {
  it('gives a single-organization caller its own organization, even when requested names another', async () => {
    const { db, organizationsCollection } = buildDb([{ userAccountId: 'u1', accessType: 2, organizationId: 'org-a' }]);

    const result = await resolveCallerCreateOrganization(db, { userId: 'u1', requested: 'org-b' });

    expect(result.organizationId).toBe('org-a');
    expect(result.organizationScope).toEqual({ scope: 'organization', organizationIds: ['org-a'] });
    expect(organizationsCollection.findOne).not.toHaveBeenCalled();
  });

  it('gives a multi-organization caller the one of its own it names', async () => {
    const { db } = buildDb([
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-a' },
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-b' },
    ]);

    const result = await resolveCallerCreateOrganization(db, { userId: 'u1', requested: 'org-b' });

    expect(result.organizationId).toBe('org-b');
  });

  it('refuses a multi-organization caller naming none with a 400', async () => {
    const { db } = buildDb([
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-a' },
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-b' },
    ]);

    await expect(resolveCallerCreateOrganization(db, { userId: 'u1' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a multi-organization caller naming a foreign organization with a 400', async () => {
    const { db } = buildDb([
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-a' },
      { userAccountId: 'u1', accessType: 2, organizationId: 'org-b' },
    ]);

    await expect(resolveCallerCreateOrganization(db, { userId: 'u1', requested: 'org-z' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses an org-less caller with the 403 requireOrganizationScope gives, and looks nothing up', async () => {
    const organizationsCollection = createCollectionMock({ findOne: vi.fn() });
    const db = createDbMock({
      organizations: organizationsCollection,
      ...buildRbacCollections([{ userAccountId: 'u1', roleCodes: ['sample-only'] }], [SAMPLE_ONLY_ROLE]),
    });

    await expect(resolveCallerCreateOrganization(db, { userId: 'u1', requested: 'org-a' }))
      .rejects.toMatchObject({ statusCode: 403, message: 'Sem organização atribuída' });
    expect(organizationsCollection.findOne).not.toHaveBeenCalled();
  });

  it('gives a global caller the existing organization it names', async () => {
    const { db, organizationsCollection } = buildDb(
      [{ userAccountId: 'admin', accessType: 4 }],
      [{ organizationId: 'org-a' }]
    );

    const result = await resolveCallerCreateOrganization(db, { userId: 'admin', requested: 'org-a' });

    expect(result.organizationId).toBe('org-a');
    expect(result.organizationScope.scope).toBe('global');
    expect(organizationsCollection.findOne).toHaveBeenCalledWith({ organizationId: 'org-a' });
  });

  it('refuses a global caller naming a missing organization with a 404', async () => {
    const { db } = buildDb([{ userAccountId: 'admin', accessType: 4 }], [{ organizationId: 'org-a' }]);

    await expect(resolveCallerCreateOrganization(db, { userId: 'admin', requested: 'org-missing' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'organizationId org-missing não encontrado' });
  });

  it('gives a global caller naming none a null organization', async () => {
    const { db, organizationsCollection } = buildDb([{ userAccountId: 'admin', accessType: 4 }]);

    const result = await resolveCallerCreateOrganization(db, { userId: 'admin', requested: '' });

    expect(result.organizationId).toBeNull();
    expect(organizationsCollection.findOne).not.toHaveBeenCalled();
  });

  it('uses a given organizationScope without resolving the caller scope again', async () => {
    const { db } = buildDb([{ userAccountId: 'u1', accessType: 2, organizationId: 'org-a' }]);
    const collectionSpy = vi.spyOn(db, 'collection');
    const organizationScope = { scope: 'organization', organizationIds: ['org-given'] };

    const result = await resolveCallerCreateOrganization(db, { userId: 'u1', organizationScope });

    expect(result).toEqual({ organizationId: 'org-given', organizationScope });
    expect(collectionSpy).not.toHaveBeenCalledWith('userRoleAssignments');
  });
});
