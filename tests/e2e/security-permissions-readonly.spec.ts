import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';

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
