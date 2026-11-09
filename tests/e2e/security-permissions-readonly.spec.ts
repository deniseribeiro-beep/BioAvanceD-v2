import crypto from 'node:crypto';
import { test, expect, APIRequestContext } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin, seedRealAuth, RealAuthSession } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { deleteOrganizations } from './helpers/listOrganizations';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  seedStudy,
  seedProtocol,
  seedActiveConsent,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';

// Real-backend proof for #1149: PUT /api/security/permissions wrote a
// `security_permissions` store no authorization path reads, answered
// success, and audited a critical permission change that never happened.
// It is removed, and the Permissões tab is read-only.
//
// #1341: the tab shows the seeded roles and the permissions they grant,
// the rows enforcement reads, not a hardcoded accessType map. The additive
// auditor role appears, and no code outside the catalog (the old map's
// manageSecurity) does.
//
// #1494: RNF008 AC2, each permission keeps its stable code and the tab shows
// its served localized label; RNF008 AC3, an AccessPolicy organization scope
// refuses an access request from an organization outside it.
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

// RNF008 AC2 (#1494): each permission and role is served with its stable code
// and a localized displayName, and the Permissões tab shows the label, never
// the code.
test.describe('RNF008 AC2: stable codes with localized labels — real backend', () => {
  test('the served catalog carries a localized label for every code, and the tab shows the served label', async ({ page, request }) => {
    const session = await realLogin(request);
    const res = await request.get(`${apiBaseURL}/api/security/permissions`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(res.status(), await res.text()).toBe(200);
    const { data } = await res.json();
    const permissions = data.permissions as Array<{ permissionCode: string; displayName: unknown }>;
    expect(permissions.length).toBeGreaterThan(0);
    for (const { permissionCode, displayName } of permissions) {
      expect(typeof displayName, permissionCode).toBe('string');
      expect((displayName as string).trim(), permissionCode).not.toBe('');
      expect(displayName, permissionCode).not.toBe(permissionCode);
    }
    const labelOf = (code: string) => permissions.find((p) => p.permissionCode === code)?.displayName as string;
    const manageSystemLabel = labelOf('manageSystem');
    const viewAuditLogsLabel = labelOf('viewAuditLogs');
    expect(manageSystemLabel).toBe('Gerenciar sistema');
    expect(viewAuditLogsLabel).toBe('Visualizar trilhas de auditoria');
    const auditor = (data.roles as Array<{ roleCode: string; displayName: string }>).find((r) => r.roleCode === 'auditor');
    expect(auditor?.displayName).toBe('Auditor');

    await seedRealAuth(page, session);
    await page.goto('/system-management?tab=security');
    await page.getByTestId('security-nav-permissions').click();

    const manageSystemLabelEl = page.getByTestId('security-permission-toggle-administrator-manageSystem').locator('xpath=..');
    await expect(manageSystemLabelEl).toHaveText(manageSystemLabel);
    await expect(manageSystemLabelEl).not.toContainText('manageSystem');
    const viewAuditLogsLabelEl = page.getByTestId('security-permission-toggle-auditor-viewAuditLogs').locator('xpath=..');
    await expect(viewAuditLogsLabelEl).toHaveText(viewAuditLogsLabel);
    await expect(viewAuditLogsLabelEl).not.toContainText('viewAuditLogs');
    // The auditor role has no i18n key, so its header is the served displayName.
    await expect(page.getByTestId('security-permission-role-auditor').locator('h3')).toHaveText('Auditor');
  });
});

// RNF008 AC3 (#1494): an AccessPolicy's organizationScopeIds bound which
// requesters it covers. A permit policy scoped to one organization permits
// that organization's request and does not apply to an otherwise identical
// request from another organization, which stays review_required and is not
// allowed access. Biobank, collection, study and protocol scopes are a
// separate product issue.
test.describe('RNF008 AC3: an AccessPolicy organization scope refuses an out-of-scope requester — real backend', () => {
  const organizationIds: string[] = [];
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async ({ request }) => {
    await Promise.all(seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await closeSeedDb();
  });

  function validSampleFields() {
    return {
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      quantity: 5,
      quality: 'GOOD',
      linkedProject: 'RNF008 e2e fixture project',
      registeredAt: new Date().toISOString(),
    };
  }

  async function createRealSample(request: APIRequestContext, token: string): Promise<string> {
    const participant = await createRealParticipant(request, apiBaseURL!, token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    return (await create.json()).data.specimenId;
  }

  // Each request names a fresh organization and an approved protocol.
  async function createRequestForSample(
    request: APIRequestContext,
    token: string,
    opts: { studyId: string }
  ): Promise<any> {
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { officialName: `RNF008 AC3 ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    const protocolId = `rnf008-protocol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await seedProtocol(protocolId, { protocolVersion: '1.2' });

    const sampleID = await createRealSample(request, token);
    const sampleDoc = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sampleDoc.status()).toBe(200);
    const specimenId = (await sampleDoc.json()).data.specimenId;
    expect(specimenId).toBeTruthy();

    const create = await request.post(`${apiBaseURL}/api/access-requests`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        requesterId: `researcher-${Date.now()}`,
        organizationId,
        studyId: opts.studyId,
        protocolId,
        requestedPurpose: 'RNF008 e2e — pesquisa em biomarcadores oncológicos',
        requestedItems: [{ itemType: 'specimen', itemId: specimenId }],
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()).data;
    expect(created).toMatchObject({ organizationId, protocolId, protocolVersion: '1.2' });
    return created;
  }

  // Seed the ACTIVE consent for the request's real participant, then
  // evaluate it compatible.
  async function evaluateCompatible(request: APIRequestContext, token: string, accessRequestId: string): Promise<void> {
    const url = `${apiBaseURL}/api/access-requests/${accessRequestId}/evaluate`;
    const first = await request.post(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(first.status()).toBe(200);
    await seedActiveConsent((await first.json()).data.consentCompatibility[0].participantId);
    const second = await request.post(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(second.status()).toBe(200);
    expect((await second.json()).data.overallCompatible).toBe(true);
  }

  test('a permit policy scoped to one organization permits its request and does not apply to another organization', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const studyId = `rnf008-study-${Date.now()}`;
    await seedStudy(studyId);
    const inScope = await createRequestForSample(request, admin.token, { studyId });
    const outOfScope = await createRequestForSample(request, admin.token, { studyId });
    expect(outOfScope.organizationId).not.toBe(inScope.organizationId);
    await evaluateCompatible(request, admin.token, inScope.accessRequestId);
    await evaluateCompatible(request, admin.token, outOfScope.accessRequestId);

    const policyBody = {
      policyName: `RNF008 AC3 e2e ${Date.now()}`,
      policyVersion: '1.0.0',
      applicableEntityTypes: ['AccessRequest'],
      decisionEffect: 'permit',
      ruleExpression: 'all-conditions',
      effectivePeriod: { start: new Date(Date.now() - 60_000).toISOString() },
      roleCodes: ['researcher'],
      organizationScopeIds: [inScope.organizationId],
      resourceScopes: ['Specimen'],
      conditions: [{ consent: 'compatible', study: 'active' }],
      decisionReasonsRequired: true,
    };
    const created = await request.post(`${apiBaseURL}/api/access-policies`, { headers: auth, data: policyBody });
    expect(created.status(), await created.text()).toBe(201);
    const accessPolicyId = (await created.json()).data.accessPolicyId;

    const evaluate = async (accessRequestId: string) => {
      const res = await request.post(`${apiBaseURL}/api/access-requests/${accessRequestId}/evaluate`, { headers: auth });
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()).data;
    };

    // Control: the in-scope organization's request is permitted by the policy.
    const permitted = await evaluate(inScope.accessRequestId);
    expect(permitted.policyDecision.effect).toBe('permit');
    expect(permitted.policyDecision.appliedPolicies).toEqual(
      expect.arrayContaining([expect.objectContaining({ accessPolicyId, decisionEffect: 'permit' })])
    );

    // Out of scope: compatible like the control, only the organization differs.
    const refused = await evaluate(outOfScope.accessRequestId);
    expect(refused.overallCompatible).toBe(true);
    expect(refused.policyDecision.effect).toBe('review_required');
    expect(refused.policyDecision.appliedPolicies.map((p: any) => p.accessPolicyId)).not.toContain(accessPolicyId);
    expect(refused.policyDecision.reasons).toContain('nenhuma AccessPolicy aplicável: requer revisão do comitê');

    const check = await request.get(`${apiBaseURL}/api/access-requests/${outOfScope.accessRequestId}/access-check`, { headers: auth });
    expect(check.status(), await check.text()).toBe(200);
    expect((await check.json()).data).toMatchObject({ allowed: false, reason: 'pending' });
  });
});
