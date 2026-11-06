import crypto from 'node:crypto';
import { test, expect, APIRequestContext } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin, seedRealAuth, RealAuthSession } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { deleteOrganizations } from './helpers/listOrganizations';

// Real-backend proof for #1149: PUT /api/security/permissions wrote a
// `security_permissions` store no authorization path reads, answered
// success, and audited a critical permission change that never happened.
// It is removed, and the Permissões tab is read-only.
//
// #1341: the tab shows the seeded roles and the permissions they grant,
// the rows enforcement reads, not a hardcoded accessType map. The additive
// auditor role appears, and no code outside the catalog (the old map's
// manageSecurity) does.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Security permissions tab is read-only (#1149) — real backend', () => {
  test('the tab shows the read-only note, disabled toggles and no save button; the PUT no longer exists', async ({ page, request }) => {
    let session;
    try {
      session = await realLogin(request);
    } catch (err: any) {
      console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
      return;
    }

    const headers = { Authorization: `Bearer ${session.token}` };

    // Control: the read stays.
    const get = await request.get(`${apiBaseURL}/api/security/permissions`, { headers });
    expect(get.status()).toBe(200);
    const { data } = await get.json();
    const roleCodes = data.roles.map((r: any) => r.roleCode);
    expect(roleCodes).toEqual(expect.arrayContaining(['administrator', 'coordinator', 'technician', 'external_user', 'auditor']));
    expect(data.roles.find((r: any) => r.roleCode === 'auditor').permissionCodes).toEqual(['viewAuditLogs']);
    const codes = data.permissions.map((p: any) => p.permissionCode);
    expect(codes).toContain('manageSystem');
    expect(codes).not.toContain('manageSecurity');

    const put = await request.put(`${apiBaseURL}/api/security/permissions`, {
      headers,
      data: { administrator: { manageSystem: false } },
    });
    expect(put.status()).toBe(404);

    await seedRealAuth(page, session);
    await page.goto('/system-management?tab=security');
    await page.getByTestId('security-nav-permissions').click();

    await expect(page.getByTestId('security-permissions-readonly-note')).toBeVisible();
    const toggle = page.getByTestId('security-permission-toggle-administrator-manageSystem');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId('security-permission-role-auditor')).toBeVisible();
    await expect(page.getByTestId('security-permission-toggle-auditor-viewAuditLogs')).toBeChecked();
    await expect(page.getByTestId('security-permission-toggle-auditor-manageSystem')).not.toBeChecked();
    await expect(page.getByTestId('security-save-permissions-button')).toHaveCount(0);
  });
});

// RNF008 AC1 and the single permission source, real backend. Enforcement
// (requirePermission -> userHasPermission) reads the caller's active
// UserRoleAssignment -> Role.permissionIds -> Permission rows, the same rows
// GET /api/security/permissions shows (#1341). So:
//   - a user with no active assignment is refused every swept route;
//   - each seeded role is allowed a swept route exactly when the served
//     catalog grants that route's permission code;
//   - taking a permission out of a role's row turns the route back to 403.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';
const RBAC_DENY_MESSAGE = 'Você não tem permissão para esta ação';

// GET routes whose first gate is requirePermission(code) and whose handler
// answers 200 for a caller in scope.
const SWEEP: Array<{ path: string; code: string }> = [
  { path: '/api/incidents', code: 'viewTemperature' },
  { path: '/api/equipment', code: 'viewEquipment' },
  { path: '/api/access', code: 'manageAccessGrants' },
  { path: '/api/users', code: 'readUser' },
  { path: '/api/reports', code: 'viewReports' },
];

test.describe('RNF008: enforcement follows the seeded catalog and denies by default — real backend', () => {
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  async function createOrganization(request: APIRequestContext, adminToken: string, label: string): Promise<string> {
    const res = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { officialName: `RNF008 ${label} ${Date.now()}`, countryCode: 'BR' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const organizationId = (await res.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    return organizationId;
  }

  async function provision(
    request: APIRequestContext,
    adminToken: string,
    accessType: number,
    roleName: string,
    organizationId: string
  ): Promise<RealAuthSession> {
    const username = `rnf008.${accessType}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    const password = 'Rnf008@12345-forte';
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `RNF008 ${roleName}`, email: `${username}@example.com`, username, password, accessType, roleName, organizationId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return completeFirstLoginMfa(request, apiBaseURL!, username, password);
  }

  async function expectRbacDeny(request: APIRequestContext, token: string, path: string) {
    const res = await request.get(`${apiBaseURL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(403);
    expect((await res.json()).message, path).toBe(RBAC_DENY_MESSAGE);
  }

  test('AC1: a user with no active role assignment is refused every swept route by the RBAC check', async ({ request }) => {
    const admin = await realLogin(request);
    const organizationId = await createOrganization(request, admin.token, 'AC1');
    const technician = await provision(request, admin.token, 2, 'Técnico', organizationId);

    // Control: with its assignment active the Técnico reads the incidents.
    const control = await request.get(`${apiBaseURL}/api/incidents`, { headers: { Authorization: `Bearer ${technician.token}` } });
    expect(control.status(), await control.text()).toBe(200);

    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    try {
      await client.connect();
      const revoked = await client.db(mongoDbName).collection('userRoleAssignments').updateMany(
        { userAccountId: String(technician.user._id), assignmentStatus: 'active' },
        { $set: { assignmentStatus: 'revoked', revokedBy: 'e2e-rnf008', revokedAt: new Date(), revocationReason: 'e2e deny-by-default' } }
      );
      expect(revoked.modifiedCount).toBeGreaterThanOrEqual(1);
    } finally {
      await client.close();
    }

    for (const { path } of SWEEP) {
      await expectRbacDeny(request, technician.token, path);
    }
  });

  test('each role is allowed a swept route exactly when the served catalog grants its permission code', async ({ request }) => {
    const admin = await realLogin(request);
    const catalog = await request.get(`${apiBaseURL}/api/security/permissions`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(catalog.status(), await catalog.text()).toBe(200);
    const roles = (await catalog.json()).data.roles as Array<{ roleCode: string; permissionCodes: string[] }>;
    const grants = new Map(roles.map((r) => [r.roleCode, new Set(r.permissionCodes)]));

    const organizationId = await createOrganization(request, admin.token, 'catalog');
    const sessions: Array<{ roleCode: string; token: string }> = [
      { roleCode: 'administrator', token: admin.token },
      { roleCode: 'coordinator', token: (await provision(request, admin.token, 3, 'Coordenador', organizationId)).token },
      { roleCode: 'technician', token: (await provision(request, admin.token, 2, 'Técnico', organizationId)).token },
      { roleCode: 'external_user', token: (await provision(request, admin.token, 1, 'Usuário Externo', organizationId)).token },
    ];

    let allowed = 0;
    let denied = 0;
    for (const { roleCode, token } of sessions) {
      const granted = grants.get(roleCode);
      expect(granted, `catalog row for ${roleCode}`).toBeDefined();
      for (const { path, code } of SWEEP) {
        if (granted!.has(code)) {
          const res = await request.get(`${apiBaseURL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
          expect(res.status(), `${roleCode} ${path}: ${await res.text()}`).toBe(200);
          allowed += 1;
        } else {
          await expectRbacDeny(request, token, path);
          denied += 1;
        }
      }
    }
    // The sweep holds both outcomes, so it cannot pass on an all-allow or an
    // all-deny backend.
    expect(allowed).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });

  test('a route a role row grants is refused once the row drops the permission', async ({ request }) => {
    const admin = await realLogin(request);
    const organizationId = await createOrganization(request, admin.token, 'row');
    const external = await provision(request, admin.token, 1, 'Usuário Externo', organizationId);
    const extAuth = { Authorization: `Bearer ${external.token}` };

    // The seeded Usuário Externo row does not grant viewTemperature.
    await expectRbacDeny(request, external.token, '/api/incidents');

    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    const roleId = crypto.randomUUID();
    try {
      await client.connect();
      const db = client.db(mongoDbName);
      const permission = await db.collection('permissions').findOne({ permissionCode: 'viewTemperature' });
      expect(permission).not.toBeNull();
      const permissionId = String(permission!.permissionId);
      const now = new Date();
      await db.collection('roles').insertOne({
        roleId, roleCode: `e2e_rnf008_${Date.now()}`, displayName: 'RNF008 e2e', description: null,
        hierarchyLevel: null, permissionIds: [permissionId], roleStatus: 'active', effectivePeriod: null,
        createdAt: now, updatedAt: now,
      });
      await db.collection('userRoleAssignments').insertOne({
        assignmentId: crypto.randomUUID(), userAccountId: String(external.user._id), roleId,
        scopeType: null, scopeId: null, validFrom: null, validUntil: null, assignmentStatus: 'active',
        grantedBy: 'e2e-rnf008', grantedAt: now, revokedBy: null, revokedAt: null, revocationReason: null,
        createdAt: now, updatedAt: now,
      });

      // The role row grants it: the same token is now allowed.
      const allowed = await request.get(`${apiBaseURL}/api/incidents`, { headers: extAuth });
      expect(allowed.status(), await allowed.text()).toBe(200);

      // The row drops it: refused again, with nothing else changed.
      await db.collection('roles').updateOne({ roleId }, { $pull: { permissionIds: permissionId } as any, $set: { updatedAt: new Date() } });
      await expectRbacDeny(request, external.token, '/api/incidents');
    } finally {
      const db = client.db(mongoDbName);
      await db.collection('userRoleAssignments').deleteMany({ roleId }).catch(() => {});
      await db.collection('roles').deleteOne({ roleId }).catch(() => {});
      await client.close();
    }
  });
});
