import { test, expect, type Page } from '@playwright/test';
import { realLogin } from '../e2e/helpers/realAuth';
import { createRealParticipant, seedStorageBoxLocation, cleanupStorageBoxLocation, closeSeedDb, type SeededStorageBox } from '../e2e/helpers/seedParticipant';

// Not a coverage spec — a human-paced showcase reel for Denise, recorded via
// `playwright.showcase.config.ts` (video: 'on', single worker, real backend).
// Lives outside tests/e2e/ on purpose so the main playwright.config.ts (whose
// testDir *is* tests/e2e, discovered by CI's bare `playwright test`) never
// picks this file up. Run with:
//   npx playwright test --config=playwright.showcase.config.ts
// against a live compose stack — see docker-workflow's local-env overlay for
// the startup recipe. Produces a .webm under test-results/; convert to mp4
// with ffmpeg.
//
// Wave 2 reel (#331): demonstrates what's provably working end-to-end
// through the real UI against the real backend for RF003 (login/session),
// RF020 (Organizations/Collections CRUD, #606-608). RF007 (scientific
// files, including this session's Assay/Dataset linkage, #641/#643) and
// RF011 (FHIR interop) are proven real-backend but API-only today -- no UI
// exists for either yet, so per this skill's own "reuse proven flows, don't
// improvise a new one" guidance, this reel doesn't fabricate a UI path for
// them rather than risk demoing an unproven flow live.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker against the real stack');

// Pause lengths tuned to how much changes on screen: a small in-place change
// (one field filled, one error appearing) gets SMALL; a panel/table update
// gets MEDIUM; a full page/view change (navigation, login redirect) gets
// LARGE — long enough for a human watching the recording to register it.
const SMALL = 1_000;
const MEDIUM = 2_000;
const LARGE = 3_000;

async function beat(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

test.describe('Human-paced e2e showcase reel — Wave 2 (#331)', () => {
  test('login, RF020 organizations/collections CRUD via the real UI, samples list', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    const officialName = `Showcase Org ${Date.now()}`;
    const collectionId = `showcase-collection-${Date.now()}`;
    const collectionName = `Showcase Collection ${Date.now()}`;
    let organizationId: string | null = null;

    try {
      // 1. A rejected login — wrong password.
      await page.goto('/login');
      await expect(page.getByTestId('login-page')).toBeVisible();
      await beat(page, MEDIUM);

      await page.getByTestId('login-username-input').fill(testUser);
      await beat(page, SMALL);
      await page.getByTestId('login-password-input').fill('definitely-wrong-password');
      await beat(page, SMALL);
      await page.getByTestId('login-submit-button').click();
      await expect(page.getByTestId('login-error')).toBeVisible();
      await beat(page, MEDIUM);

      // 2. The real admin login, correcting the password in place. (RF003)
      await page.getByTestId('login-password-input').fill(testPass);
      await beat(page, SMALL);
      await page.getByTestId('login-submit-button').click();
      await page.waitForURL('**/system-management');
      await expect(page.getByTestId('system-management-page')).toBeVisible();
      await beat(page, LARGE);

      // 3. Organizations CRUD through the real UI. (RF020, #606/#608)
      await page.goto('/system-management?tab=organizations');
      await beat(page, MEDIUM);
      await page.getByTestId('new-organization-button').click();
      await beat(page, SMALL);
      await page.getByTestId('organization-official-name-input').fill(officialName);
      await beat(page, SMALL);
      await page.getByTestId('organization-country-code-input').fill('BR');
      await beat(page, SMALL);
      await page.getByTestId('organization-acronym-input').fill('SHOWCASE');
      await beat(page, SMALL);
      await page.getByTestId('organization-form-submit').click();
      await expect(page.getByTestId('organization-form-submit')).not.toBeVisible();
      await expect(page.getByText(officialName, { exact: true })).toBeVisible();
      await beat(page, LARGE);

      // 4. Collections CRUD through the real UI. (RF020, #607/#608)
      await page.goto('/system-management?tab=collections');
      await beat(page, MEDIUM);
      await page.getByTestId('new-collection-button').click();
      await beat(page, SMALL);
      await page.getByTestId('collection-id-input').fill(collectionId);
      await beat(page, SMALL);
      await page.getByTestId('collection-name-input').fill(collectionName);
      await beat(page, SMALL);
      await page.getByTestId('collection-sample-types-input').fill('plasma; serum');
      await beat(page, SMALL);
      await page.getByTestId('collection-form-submit').click();
      await expect(page.getByTestId('collection-form-submit')).not.toBeVisible();
      await expect(page.getByText(collectionId, { exact: true })).toBeVisible();
      await beat(page, LARGE);

      // 5. The samples list — a full view change, closing shot.
      await page.goto('/samples');
      await expect(page.getByTestId('samples-page-title')).toBeVisible();
      await beat(page, LARGE);

      // Resolve organizationId (server-generated) for cleanup below.
      const session = await realLogin(request);
      const listResponse = await request.get(`${apiBaseURL}/api/organizations`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (listResponse.ok()) {
        const list = await listResponse.json();
        const created = list.data.find((org: Record<string, unknown>) => org.officialName === officialName);
        organizationId = created ? created.organizationId : null;
      }
    } finally {
      // Not shown on camera -- avoid leaving demo fixtures in the
      // persistent mongodb-test-data volume across sessions, same
      // rationale as organization-collection-management-ui.spec.ts's own
      // cleanup finally block.
      const session = await realLogin(request).catch(() => null);
      if (session) {
        if (organizationId) {
          await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, {
            headers: { Authorization: `Bearer ${session.token}` },
          }).catch(() => {});
        }
        await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        }).catch(() => {});
      }
    }
  });
});

// Wave 3 reel (#646): demonstrates what's provably working end-to-end
// through the real UI against the real backend for RF014 (security policy
// management, including the login MFA-toggle round trip), RF017 (equipment
// management), and RF016 (real symbology label generation + print-job
// download, #655). RF015/RF024/RF025/RF026/RF029 are proven real-backend
// but API-only today -- no frontend caller exists for any of them (see
// specimen-quality-inventory.spec.ts / scientific-data-access.spec.ts /
// pipeline-continuity.spec.ts's own RF015/24/25/26/29 blocks, all
// `request`-only) -- so, per this skill's own "reuse proven flows, don't
// improvise a new one" guidance, this reel doesn't fabricate a UI path for
// them rather than demo an unproven flow live. RF017's storage-topology
// sub-flow (InlineStorageMovementPanel) is also skipped: its freezer
// dropdown has no data-testid coverage and is blocked by the known
// seedStorageBoxLocation() fixture gap (#598, see this skill's local-env
// overlay) -- the equipment sub-domain alone is what's demoed for RF017.
test.describe('Human-paced e2e showcase reel — Wave 3 (#646)', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('login, RF014 security policy update via the real UI, RF017 equipment management, RF016 real sample labeling', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    const equipmentDescription = `Showcase Freezer ${Date.now()}`;
    let originalSecurityConfig: Record<string, any> | null = null;
    let equipmentIdToDelete: string | null = null;
    let seededStorageBox: SeededStorageBox | null = null;

    try {
      // 1. Real admin login. RF003 itself (rejected + corrected password)
      // is already fully demoed in the Wave 2 reel -- just enough here to
      // reach an authenticated session.
      await page.goto('/login');
      await expect(page.getByTestId('login-page')).toBeVisible();
      await beat(page, MEDIUM);
      await page.getByTestId('login-username-input').fill(testUser);
      await beat(page, SMALL);
      await page.getByTestId('login-password-input').fill(testPass);
      await beat(page, SMALL);
      await page.getByTestId('login-submit-button').click();
      await page.waitForURL('**/system-management');
      await expect(page.getByTestId('system-management-page')).toBeVisible();
      await beat(page, LARGE);

      const admin = await realLogin(request);

      // 2. Security policy management through the real UI. (RF014, #646 Wave 3)
      // security_config is a single global singleton shared by the whole
      // stack -- capture it now so it can be restored below, same rationale
      // as auth-access-security.spec.ts's own RF014 policy-update test.
      const before = await request.get(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      originalSecurityConfig = (await before.json()).data;

      await page.goto('/system-management?tab=security');
      await expect(page.getByTestId('security-page')).toBeVisible();
      await beat(page, MEDIUM);
      await page.getByTestId('security-nav-authentication').click();
      await beat(page, SMALL);
      await page.getByTestId('security-require-mfa-toggle').click();
      await beat(page, SMALL);
      await page.getByTestId('security-save-config-button').click();
      // saveStatus auto-resets to 'idle' 3s after a successful save
      // (SecurityPage.tsx's handleSaveConfig) -- assert right away, then
      // beat for less than that window so the confirmation is still on
      // screen while the viewer registers it.
      await expect(page.locator('.security-success')).toBeVisible();
      await beat(page, MEDIUM);

      // 3. Equipment management through the real UI. (RF017, #646 Wave 3)
      await page.goto('/facility-management?tab=equipment');
      await beat(page, MEDIUM);
      await page.getByTestId('equipment-new-button').click();
      await beat(page, SMALL);
      await page.getByTestId('equipment-description-input').fill(equipmentDescription);
      await beat(page, SMALL);
      await page.getByTestId('equipment-model-input').fill('Freezer -80°C');
      await beat(page, SMALL);
      await page.getByTestId('equipment-serial-input').fill(`SN-SHOWCASE-${Date.now()}`);
      await beat(page, SMALL);
      await page.getByTestId('equipment-save-button').click();
      // Not a row-text assertion: this shared test DB accumulates equipment
      // fixtures across every session (500+ rows as of this writing), so a
      // freshly-created row can land many pages deep in the unsorted,
      // 10-per-page table. The form panel closing on success (it stays open
      // on error, see EquipmentForm's onSave catch block) is the reliable
      // signal instead.
      await expect(page.getByTestId('equipment-form-panel')).not.toBeVisible();
      await beat(page, LARGE);

      // 4. Real sample labeling through the real UI. (RF016, #655/#646)
      // Fixture setup only -- not shown on camera.
      const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
      seededStorageBox = await seedStorageBoxLocation();
      const { boxId, positionCode } = seededStorageBox;
      const sampleCreate = await request.post(`${apiBaseURL}/api/samples`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          participantId: participant.participantId,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 5,
          quality: 'GOOD',
          linkedProject: 'Wave 3 showcase fixture',
          registeredAt: new Date().toISOString(),
          boxId,
          positionCode,
        },
      });
      expect([201, 202]).toContain(sampleCreate.status());
      const sampleID = (await sampleCreate.json()).data.sampleID;

      await page.goto(`/samples/${sampleID}/label`);
      await expect(page.getByTestId('sample-label-page')).toBeVisible();
      await beat(page, MEDIUM);
      await expect(page.getByTestId('sample-label-code128-image')).toBeVisible();
      await beat(page, SMALL);
      await expect(page.getByTestId('sample-label-data-matrix-image')).toBeVisible();
      await beat(page, SMALL);
      await expect(page.getByTestId('sample-label-qr-image')).toBeVisible();
      await beat(page, MEDIUM);

      await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('sample-label-print-job-button').click(),
      ]);
      await beat(page, LARGE);

      // Resolve the created equipment's id (server-generated) for cleanup below.
      const equipmentList = await request.get(`${apiBaseURL}/api/equipment`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      if (equipmentList.ok()) {
        const list = (await equipmentList.json()).data;
        const created = list.find((eq: Record<string, unknown>) => eq.equipmentDescription === equipmentDescription);
        equipmentIdToDelete = created ? (created._id || created.equipmentID) : null;
      }
    } finally {
      // Not shown on camera -- restore the shared security_config singleton
      // and remove the equipment demo fixture, same rationale as the Wave 2
      // reel's own finally block.
      const admin = await realLogin(request).catch(() => null);
      if (admin && originalSecurityConfig) {
        await request.put(`${apiBaseURL}/api/security/config`, {
          headers: { Authorization: `Bearer ${admin.token}` },
          data: {
            session: {
              timeoutMinutes: originalSecurityConfig.session.timeoutMinutes,
              maxSessionDurationHours: originalSecurityConfig.session.maxSessionDurationHours,
            },
            authentication: {
              maxLoginAttempts: originalSecurityConfig.authentication.maxLoginAttempts,
              requireMFA: originalSecurityConfig.authentication.requireMFA,
            },
            passwordRules: { minLength: originalSecurityConfig.passwordRules.minLength },
          },
        }).catch(() => {});
      }
      if (admin && equipmentIdToDelete) {
        await request.delete(`${apiBaseURL}/api/equipment/${equipmentIdToDelete}`, {
          headers: { Authorization: `Bearer ${admin.token}` },
        }).catch(() => {});
      }
      if (seededStorageBox) {
        await cleanupStorageBoxLocation(seededStorageBox).catch(() => {});
      }
    }
  });
});

test.describe('Human-paced e2e showcase reel — Wave 4 (#743)', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('login, RF008 report templates + CSV export via the real UI, RF013 backup run and policy edit', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    let seededStorageBox: SeededStorageBox | null = null;
    let originalRetentionDays: number | null = null;
    let templateCodeToDelete: string | null = null;

    // Pin the UI language before any goto -- i18n/index.ts#initLanguage reads
    // `app_language` before the browser locale, and every label this reel
    // clicks (and the narration relies on) is the pt-BR one.
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    try {
      // 1. Real admin login. RF003 is fully demoed in the Wave 2 reel --
      // just enough here to reach an authenticated session.
      await page.goto('/login');
      await expect(page.getByTestId('login-page')).toBeVisible();
      await beat(page, MEDIUM);
      await page.getByTestId('login-username-input').fill(testUser);
      await beat(page, SMALL);
      await page.getByTestId('login-password-input').fill(testPass);
      await beat(page, SMALL);
      await page.getByTestId('login-submit-button').click();
      await page.waitForURL('**/system-management');
      await expect(page.getByTestId('system-management-page')).toBeVisible();
      await beat(page, LARGE);

      const admin = await realLogin(request);
      const headers = { Authorization: `Bearer ${admin.token}` };

      // Real data behind the report -- a participant plus a stored sample,
      // the same fixture shape scientific-data-access.spec.ts's own RF008 UI
      // test uses, so the exported CSV has a real row in it rather than only
      // a header.
      const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
      seededStorageBox = await seedStorageBoxLocation();
      const createSample = await request.post(`${apiBaseURL}/api/samples`, {
        headers,
        data: {
          participantId: participant.participantId,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 5,
          quality: 'GOOD',
          linkedProject: 'Wave 4 showcase project',
          registeredAt: new Date().toISOString(),
          boxId: seededStorageBox.boxId,
          positionCode: seededStorageBox.positionCode,
        },
      });
      expect([201, 202]).toContain(createSample.status());

      // 2. RF008 AC#6 -- report templates are a real, user-editable model,
      // not a fixed list (#726). Show the catalogue, then create one.
      await page.goto('/reports/templates');
      await expect(page.getByTestId('report-templates-page')).toBeVisible();
      await beat(page, LARGE);
      await expect(page.getByTestId('report-templates-table')).toBeVisible();
      await beat(page, MEDIUM);

      const templateCode = `showcase_w4_${Date.now()}`;
      await page.getByTestId('new-report-template-button').click();
      await expect(page.getByTestId('report-template-form')).toBeVisible();
      await beat(page, MEDIUM);
      await page.getByTestId('report-template-code-input').fill(templateCode);
      await beat(page, SMALL);
      await page.getByTestId('report-template-name-input').fill('Amostras por Paciente (showcase)');
      await beat(page, SMALL);
      await page.getByTestId('report-template-description-input').fill('Modelo criado ao vivo para a demonstracao da Wave 4');
      await beat(page, SMALL);
      await page.getByTestId('report-template-handler-key-select').selectOption('samplesByPatient');
      await beat(page, SMALL);
      await page.getByTestId('report-template-form-submit').click();
      await expect(page.getByTestId('report-templates-table')).toContainText(templateCode, { timeout: 10_000 });
      templateCodeToDelete = templateCode;
      await beat(page, LARGE);

      // 3. RF008 AC#4 -- a controlled export in an enabled format, driven
      // entirely through the UI: card -> query page -> real CSV download.
      await page.goto('/reports');
      const card = page.locator('.report-card', { hasText: 'Amostras por Paciente' }).first();
      await expect(card).toBeVisible();
      await beat(page, MEDIUM);
      await card.getByRole('button', { name: 'Gerar Relatório' }).click();
      await expect(page).toHaveURL(/\/reports\/query\/samplesByPatient$/);
      await beat(page, LARGE);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Exportar' }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^relatorio_.*\.csv$/);
      await beat(page, LARGE);

      // 4. RF013 -- an Administrador runs a backup and edits the policy.
      const policyBefore = (await (await request.get(`${apiBaseURL}/api/backup-policy`, { headers })).json()).data;
      originalRetentionDays = Number(policyBefore.retentionDays);
      const newRetention = originalRetentionDays + 2;

      await page.goto('/backup');
      await expect(page.getByRole('heading', { name: 'Gerenciamento de Backup' })).toBeVisible();
      await beat(page, LARGE);

      await page.locator('.create-backup-button').click();
      await expect(page.locator('.status-message.success')).toBeVisible({ timeout: 15_000 });
      await beat(page, MEDIUM);
      await expect(page.locator('.backups-table tbody tr').first()).toBeVisible();
      await beat(page, LARGE);

      await page.locator('#backup-policy-retention').fill(String(newRetention));
      await beat(page, SMALL);
      await page.getByRole('button', { name: 'Salvar Política' }).click();
      await expect(page.getByText('Política de backup atualizada com sucesso!')).toBeVisible({ timeout: 10_000 });
      await beat(page, LARGE);
    } finally {
      // Same restore-what-the-reel-changed discipline as the Wave 3 block:
      // the policy is a global singleton, and the template/sample/box rows
      // would otherwise accumulate on the shared volume.
      const admin = await realLogin(request).catch(() => null);
      if (admin && originalRetentionDays !== null) {
        await request.put(`${apiBaseURL}/api/backup-policy`, {
          headers: { Authorization: `Bearer ${admin.token}` },
          data: { retentionDays: originalRetentionDays },
        }).catch(() => {});
      }
      if (admin && templateCodeToDelete) {
        await request.delete(`${apiBaseURL}/api/report-templates/${templateCodeToDelete}`, {
          headers: { Authorization: `Bearer ${admin.token}` },
        }).catch(() => {});
      }
      if (seededStorageBox) {
        await cleanupStorageBoxLocation(seededStorageBox).catch(() => {});
      }
    }
  });
});
