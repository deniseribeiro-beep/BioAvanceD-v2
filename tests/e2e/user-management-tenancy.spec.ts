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

  test('a Coordenador lists, reads, edits and deactivates only the users of its own organization', async ({ request }) => {
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
    const coordId = await registerUser(request, adminAuth, {
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

    // The list names the caller and the Técnico of its own organization, and
    // not the other organization's Técnico.
    const listRes = await request.get(`${apiBaseURL}/api/users`, { headers: coordAuth });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const listedIds = ((await listRes.json()).data as Array<{ id?: string; _id?: string }>).map((u) => String(u.id || u._id));
    expect(listedIds.sort()).toEqual([coordId, ownTecId].sort());
    expect(listedIds).not.toContain(otherTecId);

    // Another organization's Técnico, by id.
    const foreignRead = await request.get(`${apiBaseURL}/api/users/${otherTecId}`, { headers: coordAuth });
    expect(foreignRead.status(), await foreignRead.text()).toBe(403);

    const foreignEdit = await request.put(`${apiBaseURL}/api/users/${otherTecId}`, {
      headers: coordAuth,
      data: { name: '#1384 renamed across organizations' },
    });
    expect(foreignEdit.status(), await foreignEdit.text()).toBe(403);

    const foreignDelete = await request.delete(`${apiBaseURL}/api/users/${otherTecId}`, { headers: coordAuth });
    expect(foreignDelete.status(), await foreignDelete.text()).toBe(403);

    // Control, same caller and same route: its own organization's Técnico
    // reads, so the 403s are the scope check and not a missing permission.
    const ownRead = await request.get(`${apiBaseURL}/api/users/${ownTecId}`, { headers: coordAuth });
    expect(ownRead.status(), await ownRead.text()).toBe(200);

    // The refused edit wrote nothing, and the refused delete left the
    // account active: the Administrador reads it unchanged.
    const adminRead = await request.get(`${apiBaseURL}/api/users/${otherTecId}`, { headers: adminAuth });
    expect(adminRead.status(), await adminRead.text()).toBe(200);
    expect((await adminRead.json()).data.name).not.toBe('#1384 renamed across organizations');
    const adminStatus = await request.get(`${apiBaseURL}/api/users/${otherTecId}/validate-status`, { headers: adminAuth });
    expect(adminStatus.status(), await adminStatus.text()).toBe(200);
    expect((await adminStatus.json()).data.status).toBe('active');
  });
});
