import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';

// Real-backend proof for #1384: user management is bounded by the caller's
// organization. Before it, a Coordenador (who holds createUser) listed, read,
// edited and deactivated the users of every organization -- user.routes.js
// checked the permission code and nothing else.
//
// A user's organizations are its active role assignment scope ids, which
// POST /api/users/register writes from the body's organizationId. See
// docs/decisions/2026-10-17-org-scoped-user-management.md.
//
// #1229 (Dennis, 2026-10-29): the seed no longer gives the Coordenador any
// user-account code (RF003 names the Administrador only), so no seeded
// organization-scoped role reaches these routes any more. The organization
// rule is proven against an org-scoped holder of the codes in
// api/backend/tests/integration/users.org-scope.routes.test.js; this spec
// now proves, on the real stack, that a seeded Coordenador is refused on
// its own organization's users and another's, and that nothing is written.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('User management is bounded by the caller organization (#1384) — real backend', () => {
  // The organizations the test creates, deleted after it.
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  async function registerUser(
    request: APIRequestContext,
    auth: Record<string, string>,
    { username, password, accessType, roleName, organizationId }: {
      username: string; password: string; accessType: number; roleName: string; organizationId: string;
    },
  ) {
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: {
        name: `#1384 ${roleName} ${username}`,
        email: `${username}@example.com`,
        username,
        password,
        accessType,
        roleName,
        organizationId,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const data = (await res.json()).data;
    return String(data.id || data._id);
  }

  test('a seeded Coordenador is refused listing, reading, editing and deactivating users of its own organization and of another (#1229)', async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1384 ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const organizationId = (await res.json()).data.organizationId as string;
      organizationIds.push(organizationId);
      return organizationId;
    };
    const ownOrg = await makeOrg('own');
    const otherOrg = await makeOrg('other');

    const stamp = Date.now();
    const coordUsername = `coord.1384.${stamp}`;
    const coordPassword = 'Coordenador@12345-forte';
    await registerUser(request, adminAuth, {
      username: coordUsername, password: coordPassword, accessType: 3, roleName: 'Coordenador', organizationId: ownOrg,
    });
    const ownTecId = await registerUser(request, adminAuth, {
      username: `tec.own.1384.${stamp}`, password: 'Tecnico@12345-forte', accessType: 2, roleName: 'Técnico', organizationId: ownOrg,
    });
    const otherTecId = await registerUser(request, adminAuth, {
      username: `tec.other.1384.${stamp}`, password: 'Tecnico@12345-forte', accessType: 2, roleName: 'Técnico', organizationId: otherOrg,
    });

    const coordinator = await completeFirstLoginMfa(request, apiBaseURL!, coordUsername, coordPassword);
    const coordAuth = { Authorization: `Bearer ${coordinator.token}` };

    const listRes = await request.get(`${apiBaseURL}/api/users`, { headers: coordAuth });
    expect(listRes.status(), await listRes.text()).toBe(403);

    for (const targetId of [ownTecId, otherTecId]) {
      const read = await request.get(`${apiBaseURL}/api/users/${targetId}`, { headers: coordAuth });
      expect(read.status(), await read.text()).toBe(403);

      const edit = await request.put(`${apiBaseURL}/api/users/${targetId}`, {
        headers: coordAuth,
        data: { name: '#1384 renamed across organizations' },
      });
      expect(edit.status(), await edit.text()).toBe(403);

      const del = await request.delete(`${apiBaseURL}/api/users/${targetId}`, { headers: coordAuth });
      expect(del.status(), await del.text()).toBe(403);
    }

    // The refused edits wrote nothing, and the refused deletes left both
    // accounts active: the Administrador, the control, reads them unchanged.
    for (const targetId of [ownTecId, otherTecId]) {
      const adminRead = await request.get(`${apiBaseURL}/api/users/${targetId}`, { headers: adminAuth });
      expect(adminRead.status(), await adminRead.text()).toBe(200);
      expect((await adminRead.json()).data.name).not.toBe('#1384 renamed across organizations');
      const adminStatus = await request.get(`${apiBaseURL}/api/users/${targetId}/validate-status`, { headers: adminAuth });
      expect(adminStatus.status(), await adminStatus.text()).toBe(200);
      expect((await adminStatus.json()).data.status).toBe('active');
    }
  });
});
