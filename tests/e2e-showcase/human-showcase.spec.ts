import { type Page } from '@playwright/test';
import { test, expect } from './showcaseFixtures';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { randomBytes, createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { deleteOrganizations } from '../e2e/helpers/listOrganizations';
import { realLogin, seedRealAuth } from '../e2e/helpers/realAuth';
import { createRealParticipant, seedStorageBoxLocation, cleanupStorageBoxLocation, closeSeedDb, seedStudy, seedProtocol, seedCollectionEntity, seedActiveConsent, seedDuoConcept, type SeededStorageBox } from '../e2e/helpers/seedParticipant';
import { seedSensorWithPolicy, findTemperatureIncident, removeSeededSensor, closeSeedSensorDb, type SeededSensor } from '../e2e/helpers/seedSensor';
import { queryTemperaturePoints } from '../e2e/helpers/queryInflux';
import { completeFirstLoginMfa } from '../e2e/helpers/completeFirstLoginMfa';
import { computeTotp } from '../e2e/helpers/totp';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  assignGovernedCustody,
  type GovernedCollection,
} from '../e2e/helpers/seedGovernedCollection';

// Not a coverage spec — a human-paced showcase reel for Denise, recorded via
// `playwright.showcase.config.ts` (video: 'on', single worker, real backend).
// Lives outside tests/e2e/ on purpose so the main playwright.config.ts (whose
// testDir *is* tests/e2e, discovered by CI's bare `playwright test`) never
// picks this file up. Run with:
//   npx playwright test --config=playwright.showcase.config.ts
// against a live compose stack — see the project's Docker conventions for
// the startup recipe. Produces a .webm under test-results/; convert to mp4
// with ffmpeg.
//
// Wave 2 reel (#331): demonstrates what's provably working end-to-end
// through the real UI against the real backend for RF003 (login/session),
// RF020 (Organizations/Collections CRUD, #606-608). RF011 (FHIR interop)
// was proven real-backend but API-only when this reel was recorded, so it
// doesn't fabricate a UI path for it rather than risk demoing an unproven
// flow live. RF007's scientific files were API-only then too; the sample
// page's Arquivos section has since carried their upload, download and
// delete (#647), and the W10 reel below records the upload and a replace.
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
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

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
      await page.getByTestId('collection-governance-regime-select').selectOption('biorepository');
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
// management: the setting catalog (AC1), an out-of-range change refused
// with its message on the page (AC3), the MFA-toggle save and an on-camera
// rollback to the release it replaced (AC4), #1490), RF017 (equipment
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
// seedStorageBoxLocation() fixture gap (#598) -- the equipment sub-domain
// alone is what's demoed for RF017.
test.describe('Human-paced e2e showcase reel — Wave 3 (#646)', () => {
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-w3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('login, RF014 security policy update via the real UI, RF017 equipment management, RF016 real sample labeling', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

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
      // RF014 AC1 (#1490): the setting catalog, each key with its type,
      // scope, allowed values, default, dependencies, owner and validity.
      // maxLoginAttempts is range(5, 1, 10) in securitySettingCatalog.js.
      await page.getByTestId('security-nav-catalog').click();
      await expect(page.getByTestId('security-catalog-version')).toHaveText(/^\d+\.\d+\.\d+$/);
      await expect(
        page.locator('[data-testid="security-catalog-row"][data-path="authentication.maxLoginAttempts"]').getByTestId('security-catalog-allowed'),
      ).toHaveText('1..10');
      await beat(page, LARGE);
      await page.getByTestId('security-catalog-row').last().scrollIntoViewIfNeeded();
      await beat(page, MEDIUM);
      // RF014 AC3 (#1490): a value outside the catalog's range is refused,
      // and the server's message is on the page. The refusal leaves a draft
      // release behind, but no active one.
      await page.getByTestId('security-nav-authentication').click();
      await page.getByTestId('security-max-login-attempts-input').fill('15');
      await beat(page, SMALL);
      await page.getByTestId('security-save-config-button').click();
      await expect(page.getByTestId('security-error')).toContainText('maxLoginAttempts deve estar entre 1 e 10');
      await beat(page, MEDIUM);
      // Back to the stored value, so the valid save below is not refused by it.
      await page.getByTestId('security-max-login-attempts-input').fill(String(originalSecurityConfig!.authentication.maxLoginAttempts));
      await beat(page, SMALL);
      await page.getByTestId('security-require-mfa-toggle').click();
      await beat(page, SMALL);
      await page.getByTestId('security-save-config-button').click();
      // saveStatus auto-resets to 'idle' 3s after a successful save
      // (SecurityPage.tsx's handleSaveConfig) -- assert right away, then
      // beat for less than that window so the confirmation is still on
      // screen while the viewer registers it.
      await expect(page.locator('.security-success')).toBeVisible();
      // A save clears the refusal's message when it starts (useSecurity.ts).
      await expect(page.getByTestId('security-error')).toHaveCount(0);
      await beat(page, MEDIUM);
      // RF014 AC4 (#1339): the save is a new release, active at the top of
      // the history, with the one it replaced offering a rollback.
      await page.getByTestId('security-nav-releases').click();
      const rows = page.getByTestId('security-release-row');
      await expect(rows.first()).toHaveAttribute('data-status', 'active');
      await expect(page.getByTestId('security-release-rollback').first()).toBeVisible();
      // RF014 AC4 (#1490): roll back on camera to the release the MFA save
      // replaced. The refused draft sits between the two in the history, so
      // the target is read through the API, never picked by position.
      const history = (await (await request.get(`${apiBaseURL}/api/security/config/releases`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      const active = history.find((release: { status: string }) => release.status === 'active');
      const superseded = history.find((release: { configurationReleaseId: string }) => release.configurationReleaseId === active.supersedesId);
      await beat(page, MEDIUM);
      await rows
        .filter({ has: page.getByTestId('security-release-version').getByText(superseded.semanticVersion, { exact: true }) })
        .getByTestId('security-release-rollback')
        .click();
      // The rollback is a new active release naming the one it restored. It
      // flips only authentication.requireMFA back, which ends no session.
      await expect(rows.first()).toHaveAttribute('data-status', 'active');
      await expect(rows.first().getByTestId('security-release-restores')).toHaveText(superseded.semanticVersion);
      await beat(page, LARGE);

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
      // 10-per-page table. The form page returning to the equipment list on
      // success (it stays open on error, see EquipmentFormPage's onSave catch
      // block) is the reliable signal instead.
      await page.waitForURL(/\/facility-management\?tab=equipment$/);
      await expect(page.getByTestId('equipment-form-page')).toHaveCount(0);
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
          collectionId: governed!.collectionId,
        },
      });
      expect([201, 202]).toContain(sampleCreate.status());
      const sampleID = (await sampleCreate.json()).data.specimenId;

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
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-w4-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('login, RF008 report templates + CSV export via the real UI, RF013 backup run and policy edit', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

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
          collectionId: governed!.collectionId,
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

// Wave 5 reel: the two surfaces that did not exist when the Wave 4 reel was
// recorded. Both are new UI over already-proven API:
//
//  - RF010's bulk consent-token page (`/patients/:id/consent?token=`, #809).
//    Until it was built, the URL every bulk invitation emails pointed at the
//    JWT page behind ProtectedRoute -- a participant with no account hit a
//    login wall. Proven real-backend by consent-token-page.spec.ts, whose
//    selectors and seeding shape this segment reuses verbatim. Since #1542
//    the accepted link stays the participant's panel, and the segment ends
//    on that panel.
//  - RNF011 AC#4 / RF029 AC#6's batch import. Since #1542 `/import/lgpd`
//    lands on the FHIR batch import (`/patients/import-fhir`), the one
//    batch path in the navigation. The requirement is "invalid imports are
//    staged or quarantined, without silent correction"; here a human sees
//    the RCS-GOV gate's refusal of one row of a bundle only as the Erros 1
//    count, while the rows that pass are saved in quarantine, none released
//    by the import. The refused row's matrix reason, and the save's own
//    writes, are checked off camera.
//
// Not demoed here, deliberately: ResultsPage's import-job filter (#889) is
// new since Wave 4 too, but its UI half is a known full-suite red on this
// stack -- a reel is the wrong place to find out which way it goes.
test.describe('Human-paced e2e showcase reel — Wave 5', () => {
  const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
  const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

  const TERM_TITLE = 'TCLE — Biobanco BioAvanceD (demonstração)';
  const TERM_VERSION = '2026.09';
  const TERM_CONTENT =
    'Este Termo de Consentimento Livre e Esclarecido descreve a guarda das suas amostras ' +
    'biológicas no biobanco, as finalidades de pesquisa autorizadas e o seu direito de ' +
    'revogar este consentimento a qualquer momento, sem prejuízo ao seu atendimento.';

  let client: MongoClient | null = null;
  let db: Db;

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);
  });

  test.afterAll(async () => {
    if (client) {
      await client.close();
      client = null;
    }
    await closeSeedDb();
  });

  test('RF010 a participant with no account opens the emailed invitation and consents', async ({ page }) => {
    // getActiveTemplate() takes the newest `active: true` template
    // (consent.service.js:636, sort createdAt -1), so this is seeded inside
    // the test rather than in beforeAll -- the Wave 4 block's
    // createRealParticipant() seeds one of its own on every call.
    await db.collection('consent_templates').insertOne({
      title: TERM_TITLE,
      content: TERM_CONTENT,
      version: TERM_VERSION,
      active: true,
      permissions: [
        { key: 'showcase-w5-research', label: 'Uso das amostras em pesquisa', required: true },
        { key: 'showcase-w5-recontact', label: 'Novo contato para estudos futuros', required: false },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // #821: acceptance now records a Consent via createPatientConsent, whose
    // validateParticipantId requires the canonical 8-digit shape.
    const participantId = String(80_000_000 + (Date.now() % 10_000_000));
    const consentToken = randomBytes(32).toString('hex');
    await db.collection('patients').insertOne({
      participantId,
      status: 'PENDING_CONSENT',
      // #1049: only the token's SHA-256 is stored; the link carries the token.
      consentTokenHash: createHash('sha256').update(consentToken).digest('hex'),
      consentTokenCreatedAt: new Date(),
      consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    try {
      // 1. The failure mode first, same shape as the Wave 2 reel's rejected
      //    login: a link whose id never got interpolated (#805 emailed a lot
      //    of these) reports an incomplete link. It does NOT bounce to
      //    /login -- that auth wall is what #809 removed, and its absence is
      //    the point of this segment.
      await page.goto(`/patients/undefined/consent?token=${'a'.repeat(64)}`);
      await expect(page.getByTestId('consent-token-error')).toContainText(/incompleto/i, {
        timeout: 15_000,
      });
      await expect(page).not.toHaveURL(/\/login/);
      await beat(page, LARGE);

      // 2. The real emailed link. No session, no login screen -- the
      //    participant is not a user of the system.
      await page.goto(`/patients/${participantId}/consent?token=${consentToken}`);
      await expect(page.getByTestId('consent-token-title')).toContainText(TERM_TITLE, {
        timeout: 15_000,
      });
      await beat(page, LARGE);

      // 3. The term itself, carrying its own version -- a long beat, this is
      //    the part a human watching the recording is meant to read.
      await expect(page.getByTestId('consent-token-content')).toContainText(TERM_CONTENT);
      await expect(page.getByText(`Versão ${TERM_VERSION}`)).toBeVisible();
      await beat(page, LARGE);

      await expect(page.getByTestId('consent-token-permissions')).toContainText(
        'Uso das amostras em pesquisa'
      );
      await expect(page.getByTestId('consent-token-permissions')).toContainText(
        'Novo contato para estudos futuros'
      );
      await beat(page, LARGE);

      // 4. Consent given, purpose by purpose (#821): the required one is
      //    accepted, the optional recontact stays declined.
      await page.getByTestId('consent-token-permission-showcase-w5-research').check();
      await beat(page, LARGE);
      await page.getByTestId('consent-token-accept').click();
      await expect(page.getByTestId('consent-token-success')).toBeVisible();
      await beat(page, LARGE);

      // Off camera: the banner is not the requirement, the persisted
      // transition is. Same assertion set as consent-token-page.spec.ts.
      const stored = await db.collection('patients').findOne({ participantId });
      expect(stored?.status).toBe('ACTIVE');
      expect(stored?.consentAcceptedAt).toBeTruthy();
      // #1542: the accepted link stays the participant's panel, so its hash
      // is kept rather than cleared.
      expect(stored?.consentTokenHash).toBe(createHash('sha256').update(consentToken).digest('hex'));

      // 5. The same emailed link, opened again, is now the participant's
      //    panel: the accepted purpose can be revoked from here, the declined
      //    one is not listed, and there is nothing left to accept.
      await page.goto(`/patients/${participantId}/consent?token=${consentToken}`);
      await expect(page.getByTestId('consent-token-manage')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('consent-token-revoke-showcase-w5-research')).toBeVisible();
      await expect(page.getByTestId('consent-token-revoke-showcase-w5-recontact')).toHaveCount(0);
      await expect(page.getByTestId('consent-token-accept')).toHaveCount(0);
      await page.getByTestId('consent-token-manage').scrollIntoViewIfNeeded();
      await beat(page, LARGE);
    } finally {
      await db.collection('patients').deleteMany({ participantId }).catch(() => {});
      await db.collection('patientConsents').deleteMany({ participantId }).catch(() => {});
      await db.collection('consent_templates').deleteMany({ title: TERM_TITLE }).catch(() => {});
    }
  });

  test('RNF011 AC#4 an operator imports a FHIR batch and the row the gate refuses is held back, not corrected', async ({ page }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

    let batchId: string | null = null;

    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    try {
      // 1. Real admin login -- RF003 is fully demoed in the Wave 2 reel, this
      //    is only enough to reach an authenticated session.
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

      // A FHIR R4 Bundle of three participants, each with one specimen. The
      // third specimen asks for the RCS-GOV governance check and carries no
      // matrix, which that check requires: the gate refuses that row, and
      // nothing fills the matrix in for the operator.
      const run = String(Date.now()).slice(-6);
      const participant = (n: number) => ({
        resourceType: 'Patient',
        id: `7${n}${run}`,
        identifier: [{ system: 'urn:showcase:cpf', value: `000${n}${run}00` }],
        name: [{ text: `Participante Wave 5 ${n} (showcase)` }],
        telecom: [{ system: 'email', value: `showcase-w5-${n}-${run}@example.test` }],
      });
      const specimen = (n: number, extension: Array<Record<string, unknown>> = []) => ({
        resourceType: 'Specimen',
        id: `SPC-W5-${n}-${run}`,
        subject: { reference: `Patient/7${n}${run}` },
        type: { text: 'PLASMA' },
        collection: { collectedDateTime: '2026-11-01T09:00:00Z' },
        extension,
      });
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: participant(1) },
          { resource: participant(2) },
          { resource: participant(3) },
          { resource: specimen(1) },
          { resource: specimen(2) },
          { resource: specimen(3, [{ url: 'urn:showcase:rcs-gov-required', valueBoolean: true }]) },
        ],
      };

      // 2. `/import/lgpd` now lands on the FHIR batch import (#1542): the
      //    batch path every operator is sent to.
      await page.goto('/import/lgpd');
      await page.waitForURL('**/patients/import-fhir');
      await expect(page.getByTestId('fhir-import-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Importação em lote' })).toBeVisible();
      await beat(page, LARGE);

      await page.getByTestId('fhir-import-json-input').setInputFiles({
        name: 'coorte-wave5-bundle.json',
        mimeType: 'application/fhir+json',
        buffer: Buffer.from(JSON.stringify(bundle), 'utf8'),
      });
      await expect(page.getByTestId('fhir-import-patient-count')).toContainText('3');
      await expect(page.getByTestId('fhir-import-specimen-count')).toContainText('3');
      await beat(page, MEDIUM);

      // 3. Validation stages the batch and runs the gate over every row. On
      //    screen the refusal shows only as counts: three rows, two valid,
      //    Erros 1. Its matrix reason is checked off camera after the save.
      const staged = page.waitForResponse(
        (response) => response.url().includes('/import/fhir/stage') && response.request().method() === 'POST'
      );
      await page.getByTestId('fhir-import-validate-button').click();
      const stagedBody = await (await staged).json();
      batchId = String(stagedBody?.data?.batch?._id ?? stagedBody?.batch?._id ?? '') || null;
      expect(batchId).toBeTruthy();

      const summary = page.getByTestId('fhir-import-validation-summary');
      await expect(summary).toContainText(/Total\s*3/, { timeout: 30_000 });
      await expect(summary).toContainText(/Válidos\s*2/);
      await expect(summary).toContainText(/Erros\s*1/);
      await summary.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // Only the two rows that passed are offered for review and saving.
      await expect(page.getByTestId('fhir-import-staging-table').locator('tbody tr')).toHaveCount(2);
      await beat(page, MEDIUM);

      // 4. Saving keeps every row in quarantine: a row is released only by a
      //    signed TCLE or authorized documentation, never by the import. The
      //    status table reads QUARANTINED/BLOCKED from validation onward, so
      //    the save is proven by its own commit response and by what it wrote.
      const committed = page.waitForResponse(
        (response) => response.url().includes(`/import/fhir/batches/${batchId}/commit`) && response.request().method() === 'POST'
      );
      await page.getByTestId('fhir-import-save-quarantine-button').click();
      expect((await committed).status()).toBe(200);

      // Off camera: the save ran. Each row that passed was sent its TCLE,
      // which moves it to PENDING_CONSENT, or CONSENT_SEND_FAILED when the
      // stack's mail send fails; validation alone leaves a row VALID. The
      // consentTracking the send records is sealed at rest, so this raw read
      // cannot see it, and the status is the proof.
      const rows = await db
        .collection('import_staging_records')
        .find({ batchId: new ObjectId(batchId!) })
        .sort({ rowNumber: 1 })
        .toArray();
      expect(rows).toHaveLength(3);
      const passed = rows.filter((row) => row.status !== 'ERROR');
      expect(passed).toHaveLength(2);
      for (const row of passed) {
        expect(['PENDING_CONSENT', 'CONSENT_SEND_FAILED']).toContain(row.status);
      }

      // Off camera: the refused row survived its own import, held as an
      // error naming the missing matrix rather than dropped or corrected.
      const refused = rows.filter((row) => row.status === 'ERROR');
      expect(refused).toHaveLength(1);
      expect(refused[0].errors.map((error: { field?: string }) => error.field)).toContain('matrix');
      expect(rows.some((row) => row.availabilityStatus === 'AVAILABLE')).toBe(false);

      const statusTable = page.getByTestId('fhir-import-status-table');
      await expect(statusTable.locator('tbody tr')).toHaveCount(3, { timeout: 30_000 });
      await expect(statusTable).toContainText('QUARANTINED');
      await expect(statusTable).toContainText('BLOCKED');
      await expect(statusTable).not.toContainText('AVAILABLE');
      await statusTable.scrollIntoViewIfNeeded();
      await beat(page, LARGE);
    } finally {
      // Same restore-what-the-reel-changed discipline as Waves 3 and 4: the
      // mongodb-test-data volume is persistent, so demo rows would otherwise
      // accumulate in the import listings across every future session. No
      // row is signed, so the save commits no patient or sample.
      if (client && batchId) {
        await db
          .collection('import_staging_records')
          .deleteMany({ batchId: new ObjectId(batchId) })
          .catch(() => {});
        await db
          .collection('import_batches')
          .deleteOne({ _id: new ObjectId(batchId) })
          .catch(() => {});
      }
    }
  });
});

// W6 reel: collection governance through the collections tab (RF004 AC3/AC4,
// RF020 AC3/AC4, RF021 AC2/AC3) -- an ethics approval registered, the
// biorepository's first context recorded as a governed decision, and the
// approval suspended. The study and protocol are seeded, as the e2e spec
// collection-governance-ui.spec.ts does, since neither has a UI here.
test.describe('Human-paced e2e showcase reel — W6 collection governance', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('RF004/RF020/RF021 an operator records a collection approval and its governance context', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `showcase-governance-${stamp}`, studyId: `showcase-study-${stamp}`, protocolId: `showcase-protocol-${stamp}` };
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `0 Showcase Governança ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;

    try {
      await page.goto('/system-management?tab=collections');
      await beat(page, LARGE);
      await page.getByTestId(`governance-collection-button-${ids.collectionId}`).click();
      await expect(page.getByTestId('collection-governance-panel')).toBeVisible();
      await beat(page, MEDIUM);

      // 1. The ethics approval the collection rests on.
      await page.getByTestId('governance-approval-authority-input').fill('CEP Hospital Universitário');
      await beat(page, SMALL);
      await page.getByTestId('governance-approval-caae-input').fill('00000000.0.0000.0000');
      await page.getByTestId('governance-approval-document-uri-input').fill('https://docs.example.org/parecer-cep.pdf');
      await page.getByTestId('governance-approval-checksum-input').fill(`sha256:${'d'.repeat(64)}`);
      await page.getByTestId('governance-approval-start-input').fill('2026-01-01');
      await page.getByTestId('governance-approval-end-input').fill('2030-12-31');
      await page.getByTestId('governance-approval-organization-select').selectOption(organizationId);
      await page.getByTestId('governance-approval-status-select').selectOption('active');
      await beat(page, SMALL);
      await page.getByTestId('governance-approval-submit').click();
      const approvalRow = page.locator('[data-testid^="governance-approval-row-"]');
      await expect(approvalRow).toHaveCount(1);
      const approvalId = ((await approvalRow.getAttribute('data-testid')) || '').replace('governance-approval-row-', '');
      await beat(page, MEDIUM);

      // 2. The biorepository's first context, recorded as a decision.
      await page.getByTestId('governance-context-study-input').fill(ids.studyId);
      await page.getByTestId('governance-context-protocol-input').fill(ids.protocolId);
      await page.getByTestId('governance-context-protocol-version-input').fill('1.0');
      await page.getByTestId('governance-context-caae-input').fill('00000000.0.0000.0000');
      await page.getByTestId('governance-context-organization-select').selectOption(organizationId);
      await page.getByTestId('governance-context-investigator-input').fill('Dra. Pesquisadora Responsável');
      await page.getByTestId('governance-context-ethics-approval-select').selectOption(approvalId);
      await page.getByTestId('governance-context-validity-start-input').fill('2026-01-01');
      await page.getByTestId('governance-context-planned-end-input').fill('2030-12-31');
      await page.getByTestId(`governance-event-approval-${approvalId}`).check();
      await beat(page, SMALL);
      await page.getByTestId('governance-event-justification-input').fill('Contexto inicial do biorrepositório aprovado pelo CEP');
      await beat(page, SMALL);
      await page.getByTestId('governance-event-submit').click();
      await expect(page.getByTestId('collection-governance-events')).toContainText('Contexto inicial do biorrepositório');
      await page.getByTestId('collection-governance-context').scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 3. The approval suspended: the collection takes no specimen until it is reinstated.
      await page.getByTestId(`governance-approval-suspended-${approvalId}`).click();
      await expect(page.getByTestId(`governance-approval-active-${approvalId}`)).toBeVisible();
      await beat(page, LARGE);
    } finally {
      await request.delete(`${apiBaseURL}/api/collections/${ids.collectionId}`, { headers }).catch(() => {});
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, { headers }).catch(() => {});
    }
  });

  // RF010 AC3 (#1349): a term published from the builder names, per permission,
  // the governed DUO purpose it covers, picked from the active DUO concepts the
  // real backend lists. The concept is seeded, as tcle-publication-sweep.spec.ts
  // does, since only the reference import populates terminologyConcepts.
  test('RF010 AC3 an operator publishes a term whose permission names its DUO purpose', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const purposeCode = `DUO:showcase-${stamp}`;
    const title = `0 Showcase TCLE finalidade ${stamp}`;
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
    await db.collection('terminologyConcepts').insertOne({
      terminologyConceptId: `showcase-${stamp}`,
      systemUri: 'http://purl.obolibrary.org/obo/duo.owl',
      code: purposeCode,
      display: 'Pesquisa em saúde, médica ou biomédica (showcase)',
      conceptStatus: 'active',
      version: 'showcase',
      referenceDatasetReleaseId: 'showcase',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      await page.goto('/admin/tcle/new');
      await beat(page, LARGE);
      await page.getByLabel('Nome do Modelo').fill(title);
      await page.getByLabel('CAAE').fill('00000000.0.0000.0000');
      await page.getByLabel('Modalidade de Consentimento').selectOption('broad');
      await page.getByLabel('Data de Início da Vigência').fill('2026-01-01');
      await page.getByLabel('Data Final de Vigência').fill('2030-12-31');
      await beat(page, SMALL);
      await page.getByRole('textbox', { name: 'Editor do corpo do TCLE' }).fill('Termo de consentimento para pesquisa com amostras do biorrepositório.');
      await beat(page, SMALL);
      await page.getByPlaceholder('Ex.: Aceito ceder minhas amostras para estudos genéticos').first().fill('Aceito o uso das minhas amostras em pesquisa em saúde');
      await beat(page, SMALL);

      // The purpose the permission covers, from the backend's DUO list.
      const purpose = page.getByTestId('consent-purpose-1');
      await purpose.scrollIntoViewIfNeeded();
      await purpose.selectOption(purposeCode);
      await beat(page, MEDIUM);

      await page.getByRole('button', { name: 'Criar versão do TCLE' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'TCLE criado com sucesso' })).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/admin\/tcle\/edit\//);
      await beat(page, LARGE);

      // Stored as a coded permission, the input a partial revocation is judged on.
      const stored = await db.collection('consent_templates').findOne({ title });
      expect(stored?.permissions?.[0]).toMatchObject({ purposeCode });
    } finally {
      await db.collection('consent_templates').deleteMany({ title });
      await db.collection('terminologyConcepts').deleteMany({ code: purposeCode });
      await client.close();
    }
  });
});

// RF024 reel (#1350): an access request from registration to distribution,
// through /access-requests. access-requests-ui.spec.ts proves the same flow,
// revocation and refusal included; the reel shows the path that ends in a
// release. The study, protocol, DUO concept and consent are seeded.
test.describe('Human-paced e2e showcase reel — RF024 access requests', () => {
  const boxes: SeededStorageBox[] = [];
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-rf024-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('RF024 an operator registers a request, evaluates it, approves it and releases the specimen', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const studyId = `showcase-rf024-study-${stamp}`;
    const protocolId = `showcase-rf024-protocol-${stamp}`;
    const duoCode = `DUO:showcase-rf024-${stamp}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId, { protocolVersion: '1.0' });
    await seedDuoConcept(duoCode);

    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `0 Showcase Acesso ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    await seedActiveConsent(participant.participantId);
    const box = await seedStorageBoxLocation();
    boxes.push(box);
    const sample = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'Showcase RF024',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(sample.status());
    const specimenId = (await sample.json()).data.specimenId as string;
    // Off camera (RF021 AC6): the specimen in custody under the collection's approval, so it can be released.
    await assignGovernedCustody(request, apiBaseURL!, headers, governed!, specimenId, organizationId);

    try {
      // 1. The researcher's request, registered by the operator.
      await page.goto('/access-requests');
      await beat(page, LARGE);
      await page.getByTestId('access-request-requester-input').fill('Dra. Pesquisadora Solicitante');
      await page.getByTestId('access-request-organization-select').selectOption(organizationId);
      await page.getByTestId('access-request-study-input').fill(studyId);
      await page.getByTestId('access-request-protocol-input').fill(protocolId);
      await page.getByTestId('access-request-purpose-input').fill('Pesquisa em biomarcadores oncológicos');
      await page.getByTestId('access-request-duo-select').selectOption(duoCode);
      await page.getByTestId('access-request-item-id-1').fill(specimenId);
      await beat(page, MEDIUM);
      await page.getByTestId('access-request-submit').click();
      await expect(page.getByTestId('access-request-detail')).toBeVisible();
      await page.getByTestId('access-request-detail').scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 2. Evaluated: the specimen's consent permits this use; no policy covers it, so the committee decides.
      await page.getByTestId('access-request-evaluate').click();
      await expect(page.getByTestId(`access-request-item-result-${specimenId}`)).toHaveText('permit');
      await beat(page, LARGE);

      // 3. The committee approves for a year.
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      await page.getByTestId('access-decision-justification-input').fill('Finalidade compatível com o consentimento');
      await page.getByTestId('access-decision-start-input').fill(day(new Date(today.getTime() - 86_400_000)));
      await page.getByTestId('access-decision-end-input').fill(day(new Date(today.getTime() + 365 * 86_400_000)));
      await beat(page, SMALL);
      await page.getByTestId('access-decision-submit').click();
      await expect(page.getByTestId('access-request-access-check')).toContainText('Liberado');
      await beat(page, MEDIUM);

      // 4. Released, naming the decision behind it.
      await page.getByTestId('access-request-distribute').click();
      await expect(page.getByTestId('access-request-distribution-status')).toContainText('Disponibilizada em');
      await beat(page, LARGE);
    } finally {
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, { headers }).catch(() => {});
    }
  });
});

// W6 reel: consent revocation (RF010 AC5/AC6/AC7, #1309) judged on governed
// purpose codes (#1347). A participant signs a term whose two permissions
// each name a DUO purpose; an access request for one of them is evaluated as
// permit, the consent is revoked for that purpose only, and the same request
// is re-evaluated as deny, so the committee cannot approve it. Not shown: the
// revocation itself is recorded off camera through the API, because the
// product has no operator UI for revoking a consent or reading its history;
// AccessPolicy (#663) has no UI either and is not shown.
test.describe('Human-paced e2e showcase reel — W6 consent revocation', () => {
  const boxes: SeededStorageBox[] = [];
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-w6-revoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('RF010 AC6/AC7 a consent revoked for the requested purpose turns an access request from permit to deny', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const studyId = `showcase-revoke-study-${stamp}`;
    const protocolId = `showcase-revoke-protocol-${stamp}`;
    const healthCode = `DUO:showcase-revoke-hmb-${stamp}`;
    const diseaseCode = `DUO:showcase-revoke-ds-${stamp}`;
    const healthKey = 'showcase-health';
    const diseaseKey = 'showcase-disease';
    const title = `0 Showcase TCLE revogação ${stamp}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId, { protocolVersion: '1.0' });
    await seedDuoConcept(healthCode);
    await seedDuoConcept(diseaseCode);

    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `0 Showcase Revogação ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');

    try {
      // A term whose permissions name governed purposes, signed for both.
      const term = await request.post(`${apiBaseURL}/api/e-consent/consent-templates`, {
        headers,
        data: {
          title,
          content: 'Termo com finalidades codificadas pela DUO.',
          permissions: [
            { key: healthKey, label: 'Pesquisa em saúde', required: false, purposeCode: healthCode },
            { key: diseaseKey, label: 'Pesquisa da doença', required: false, purposeCode: diseaseCode },
          ],
        },
      });
      expect(term.status(), await term.text()).toBe(201);
      const termId = String((await term.json()).data._id);
      const signed = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
        headers,
        data: { participantId: participant.participantId, consentTemplateId: termId, responses: { [healthKey]: true, [diseaseKey]: true } },
      });
      expect(signed.status(), await signed.text()).toBe(201);
      const consentId = String((await signed.json()).data._id);

      const box = await seedStorageBoxLocation();
      boxes.push(box);
      const sample = await request.post(`${apiBaseURL}/api/samples`, {
        headers,
        data: {
          participantId: participant.participantId,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 5,
          quality: 'GOOD',
          linkedProject: 'Showcase revogação de consentimento',
          registeredAt: new Date().toISOString(),
          boxId: box.boxId,
          positionCode: box.positionCode,
          collectionId: governed!.collectionId,
        },
      });
      expect([201, 202], await sample.text()).toContain(sample.status());
      const specimenId = (await sample.json()).data.specimenId as string;
      // Off camera (RF021 AC6): the specimen in custody, so the revoked purpose is the only refusal.
      await assignGovernedCustody(request, apiBaseURL!, headers, governed!, specimenId, organizationId);

      // 1. A request for the health purpose, registered by the operator.
      await page.goto('/access-requests');
      await beat(page, LARGE);
      await page.getByTestId('access-request-requester-input').fill('Dra. Pesquisadora Solicitante');
      await page.getByTestId('access-request-organization-select').selectOption(organizationId);
      await page.getByTestId('access-request-study-input').fill(studyId);
      await page.getByTestId('access-request-protocol-input').fill(protocolId);
      await page.getByTestId('access-request-purpose-input').fill('Pesquisa em saúde com amostras de plasma');
      await page.getByTestId('access-request-duo-select').selectOption(healthCode);
      await page.getByTestId('access-request-item-id-1').fill(specimenId);
      await beat(page, MEDIUM);
      await page.getByTestId('access-request-submit').click();
      await expect(page.getByTestId('access-request-detail')).toBeVisible();
      await page.getByTestId('access-request-detail').scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 2. Evaluated: the signed consent permits this purpose.
      await page.getByTestId('access-request-evaluate').click();
      await expect(page.getByTestId(`access-request-item-result-${specimenId}`)).toHaveText('permit');
      await beat(page, LARGE);

      // Off camera: the product has no operator UI for revoking a consent, so
      // the participant's revocation of the health purpose goes through the API.
      const revoked = await request.post(`${apiBaseURL}/api/e-consent/consents/${consentId}/revoke`, {
        headers,
        data: { scope: [healthKey], reason: 'Participante retirou o consentimento para pesquisa em saúde' },
      });
      expect(revoked.status(), await revoked.text()).toBe(200);

      // 3. Re-evaluated: the revoked purpose is denied, and the reason names it.
      await page.getByTestId('access-request-evaluate').click();
      await expect(page.getByTestId(`access-request-item-result-${specimenId}`)).toHaveText('deny');
      await expect(page.getByTestId('access-request-overall')).toHaveText(/: incompatível$/);
      await expect(page.getByTestId(`access-request-item-${specimenId}`)).toContainText(healthCode);
      await beat(page, LARGE);

      // 4. The committee cannot approve an incompatible request.
      await page.getByTestId('access-decision-justification-input').fill('Tentativa de aprovação após a revogação');
      await beat(page, SMALL);
      await page.getByTestId('access-decision-submit').click();
      await expect(page.getByTestId('access-request-detail-error')).toContainText('incompatível');
      await expect(page.getByTestId('access-request-decision-status')).toContainText('pending');
      await beat(page, MEDIUM);

      // 5. It records the refusal instead.
      await page.getByTestId('access-decision-status-select').selectOption('rejected');
      await page.getByTestId('access-decision-justification-input').fill('Consentimento revogado para a finalidade solicitada');
      await beat(page, SMALL);
      await page.getByTestId('access-decision-submit').click();
      await expect(page.getByTestId('access-request-decision-status')).toContainText('rejected');
      await beat(page, LARGE);
    } finally {
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, { headers }).catch(() => {});
      await db.collection('consent_templates').deleteMany({ title });
      await db.collection('terminologyConcepts').deleteMany({ code: { $in: [healthCode, diseaseCode] } });
      await db.collection('patientConsents').deleteMany({ participantId: participant.participantId });
      await db.collection('consentPermissions').deleteMany({ participantId: participant.participantId });
      await client.close();
    }
  });
});

// W9 reel (#1396): RF009 telemetry and RF015 alerts. A freezer's readings
// go through the real ingest endpoint, are persisted in InfluxDB, and the
// out-of-range ones open a temperature incident the operator inspects in
// Facility Management's Incidents tab. The same persisted readings then show
// in its "Controle de Temperatura" and "Histórico de Leituras" tabs
// (RNF016 C3) and in the Dashboard's temperature chart (RF009 C1, #1522).
// Deliberately not demoed: the notification attempt the alert dispatches,
// which is recorded by the backend but has no UI that shows it (RF015 C2).
test.describe('Human-paced e2e showcase reel — W9 telemetry and alerts', () => {
  // POST /api/iot/telemetry is gated by the machine ingest secret (#1091).
  const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('RF009 an out-of-range freezer reading persisted in InfluxDB opens an alert the operator inspects', async ({ page, request }) => {
    const session = await realLogin(request);
    // Pin the UI language before any goto, as the reel's other cases do: every label asserted here is the pt-BR one.
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);
    const sensorName = 'Freezer -80 °C · Sala de criopreservação';
    const sensor: SeededSensor = await seedSensorWithPolicy(-90, -60);
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');

    try {
      // The incident takes its name from the sensor's metadata on the first
      // reading, so the readable name is set before any reading arrives.
      await db.collection('sensorMetadata').updateOne({ sensorId: sensor.sensorId }, { $set: { sensorName } });

      // Returns the reading's id, which keys its row in the readings history.
      const postReading = async (temperature: number): Promise<string> => {
        const res = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
          headers: ingestHeaders(),
          data: { sensorId: sensor.sensorId, temperature, timestamp: new Date().toISOString() },
        });
        expect(res.status(), await res.text()).toBe(200);
        const { telemetryReadingId } = await res.json();
        expect(telemetryReadingId).toBeTruthy();
        return String(telemetryReadingId);
      };

      // Off camera: two readings above the -60 °C limit. The second is sent
      // only once the first has opened the incident, so it updates that one.
      const firstReadingId = await postReading(-52);
      await expect
        .poll(async () => (await findTemperatureIncident(sensor.sensorId))?.samplesOutOfRange ?? null, { timeout: 15_000 })
        .toBe(1);
      const secondReadingId = await postReading(-45);
      await expect
        .poll(async () => (await findTemperatureIncident(sensor.sensorId))?.samplesOutOfRange ?? null, { timeout: 15_000 })
        .toBe(2);

      // Both readings are persisted in InfluxDB, not only acknowledged.
      await expect
        .poll(async () => (await queryTemperaturePoints(sensor.sensorId)).map((p) => p.value).sort((a, b) => a - b), { timeout: 15_000 })
        .toEqual([-52, -45]);

      const incidentId = String((await findTemperatureIncident(sensor.sensorId))._id);

      // 1. Facility Management, then its Incidents tab.
      await page.goto('/facility-management');
      await beat(page, LARGE);
      await page.getByTestId('facility-tab-incidents').click();
      await beat(page, MEDIUM);

      // 2. The open alert for the freezer: its latest reading and its count.
      const row = page.getByTestId(`incident-row-${incidentId}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(sensorName);
      await expect(row).toContainText('-45.0°C');
      await expect(row.locator('td').nth(4)).toHaveText('2');
      await row.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 3. Its details: the current reading and the range the readings spanned.
      await page.getByTestId(`incident-details-button-${incidentId}`).click();
      const panel = page.locator('.incident-detail-panel');
      await expect(panel).toContainText('Detalhes do Incidente');
      await expect(panel).toContainText('-45.0°C / -52.0°C');
      await panel.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 4. "Controle de Temperatura": the freezer's card shows its newest persisted reading. (RNF016 C3)
      await page.getByTestId('facility-tab-temperature').click();
      const card = page.getByTestId(`temperature-sensor-card-${sensor.sensorId}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('-45.0°C');
      await card.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 5. "Histórico de Leituras": both persisted readings, each above the alert threshold. (RNF016 C3)
      await page.getByTestId('facility-tab-history').click();
      const newestRow = page.getByTestId(`history-row-${secondReadingId}`);
      const firstRow = page.getByTestId(`history-row-${firstReadingId}`);
      await expect(newestRow).toContainText(sensor.sensorId);
      await expect(newestRow).toContainText('-45.0°C');
      await expect(newestRow).toContainText('Alerta');
      await expect(firstRow).toContainText('-52.0°C');
      await expect(firstRow).toContainText('Alerta');
      await newestRow.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // 6. The Dashboard's temperature chart draws the same readings, its legend naming the newest. (RF009 C1)
      await page.goto('/dashboard');
      await beat(page, MEDIUM);
      const legend = page.getByTestId(`dashboard-temperature-sensor-${sensor.sensorId}`);
      await expect(legend).toContainText('-45.0°C');
      await expect(page.getByTestId(`dashboard-temperature-line-${sensor.sensorId}`)).toBeAttached();
      await page.locator('.temperature-card').scrollIntoViewIfNeeded();
      await beat(page, LARGE);
    } finally {
      await removeSeededSensor(sensor);
      await client.close();
    }
  });
});

// W8 reel (#1399): physical storage and specimen state. An operator moves a
// stored specimen to another freezer, shelf, rack, box and position through
// the sample page's storage panel (RF017), reads its derived status (RF006
// AC2/AC3), and closes it once a total withdrawal has depleted it (RF026
// AC7). Deliberately not demoed: a disposition run from planned to executed,
// custody assignment, and the cryovial container, position and
// rack-to-location chain, because no UI calls them;
// tests/e2e/physical-chain.spec.ts and tests/e2e/specimen-status-v2.spec.ts
// cover them at the API. The specimen carries the compliance-graph inputs
// (consent template, clinical, pharmacology, SPREC, sealed Merkle root),
// because opening its page revalidates the graph and a blocked graph makes it
// unavailable (#532, #537).

// The sealed sample hash, computed the way the backend's generateSampleHash
// does, without importing backend source across npm roots.
function sampleMerkleRoot(sample: Record<string, any>): string {
  const deepSort = (value: any): any => {
    if (Array.isArray(value)) return value.map(deepSort);
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc: Record<string, any>, key) => {
        acc[key] = deepSort(value[key]);
        return acc;
      }, {});
    }
    return value;
  };
  const text = (value: unknown) => String(value || '').trim();
  const asObject = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, any>) : {});
  const pharmacology = asObject(sample.pharmacologyData);
  const payload = {
    participant_identity: {
      participantId: text(sample.participantId),
      participantName: text(sample.participantName || sample.patientName),
    },
    clinicalData: asObject(sample.clinicalData),
    sprec: asObject(sample.sprec),
    pharmacologyData: {
      ...pharmacology,
      treatmentStatus: text(pharmacology.treatmentStatus || pharmacology.treatment_status).toUpperCase(),
      medicationName: text(pharmacology.medicationName || pharmacology.medication_name || pharmacology.drug_name),
      atcCode: text(pharmacology.atcCode || pharmacology.atc_code || pharmacology.medication_code).toUpperCase().replace(/^ATC:/i, ''),
      atcClass: text(pharmacology.atcClass || pharmacology.atc_level_1 || pharmacology.medication_drug_class).toUpperCase(),
      lastDoseDate: pharmacology.lastDoseDate || pharmacology.last_dose_date || null,
      washoutStartDate: pharmacology.washoutStartDate || pharmacology.washout_start_date || null,
      washoutEndDate: pharmacology.washoutEndDate || pharmacology.washout_end_date || null,
    },
    rcsScore: sample.rcsScore ?? null,
    finalGrade: sample.finalGrade ?? null,
    calculationTrace: sample.calculationTrace ?? null,
    axisPenalties: sample.axisPenalties ?? null,
  };
  return createHash('sha256').update(JSON.stringify(deepSort(payload))).digest('hex');
}

test.describe('Human-paced e2e showcase reel — W8 storage and specimen state', () => {
  const boxes: SeededStorageBox[] = [];
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-w8-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('RF017/RF006 an operator moves a specimen through freezer, shelf, rack, box and position, and closes it once depleted', async ({ page, request }) => {
    const session = await realLogin(request);
    // Pin the UI language before any goto, as the reel's other cases do: every label asserted here is the pt-BR one.
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };
    const stamp = `${Date.now()}`.slice(-6);

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    await seedActiveConsent(participant.participantId);
    const boxA = await seedStorageBoxLocation();
    const boxB = await seedStorageBoxLocation();
    boxes.push(boxA, boxB);

    // The destination tree gets readable names, which the storage summary shows.
    const freezerName = `Freezer -80 °C · Sala 2 ${stamp}`;
    const shelfName = 'Prateleira 1';
    const rackName = 'Rack A';
    const boxName = 'Caixa 01';
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    try {
      const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
      const containers = db.collection('storageContainers');
      await containers.updateOne({ _id: new ObjectId(boxB.freezerId) }, { $set: { name: freezerName } });
      await containers.updateOne({ _id: new ObjectId(boxB.shelfId) }, { $set: { name: shelfName } });
      await containers.updateOne({ _id: new ObjectId(boxB.rackId) }, { $set: { name: rackName } });
      await db.collection('storageBoxes').updateOne({ _id: new ObjectId(boxB.boxId) }, { $set: { name: boxName } });
    } finally {
      await client.close();
    }

    const sample = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'Showcase W8',
        registeredAt: new Date().toISOString(),
        boxId: boxA.boxId,
        positionCode: boxA.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(sample.status());
    const specimenId = (await sample.json()).data.specimenId as string;

    // Off camera: the compliance-graph inputs, so opening the page clears the graph instead of blocking the specimen.
    const graphClient = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await graphClient.connect();
    try {
      const db = graphClient.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
      await db.collection('patientConsents').updateOne(
        { participantId: participant.participantId, status: 'ACTIVE' },
        { $set: { consentTemplateId: participant.consentTemplateId } },
      );
      const samples = db.collection('samples');
      await samples.updateOne({ specimenId }, {
        $set: {
          consentTemplateId: participant.consentTemplateId,
          clinicalData: { orphaCode: 'ORPHA:999001', cid: 'E75.2' },
          pharmacologyData: { treatmentStatus: 'NAIVE' },
          matrixType: 'fluid',
          sprec: {
            sampleType: 'BLD',
            primaryContainer: 'SST',
            preCentrifugation: 'A',
            centrifugation: 'A',
            secondCentrifugation: 'A',
            postCentrifugationDelay: 'A',
            longTermStorage: 'C',
          },
          sealedRcsAssessmentId: null,
          sealedSpecimenPreanalyticsId: null,
        },
      });
      const stored = await samples.findOne({ specimenId });
      expect(stored, `sample ${specimenId} not found`).not.toBeNull();
      await samples.updateOne({ specimenId }, { $set: { merkleRoot: sampleMerkleRoot(stored!) } });
    } finally {
      await graphClient.close();
    }
    const graph = await request.get(`${apiBaseURL}/api/samples/${specimenId}/compliance-graph`, { headers });
    const graphText = await graph.text();
    expect(graph.status(), graphText).toBe(200);
    const graphBody = JSON.parse(graphText).data;
    expect(graphBody.isReleasable, graphText).toBe(true);
    expect(graphBody.suggestedStatus, graphText).toBe('AVAILABLE');

    const currentStatus = page.getByText('Status Atual:', { exact: true }).locator('xpath=..');

    // 1. The specimen's page: available, stored in box A at A1.
    await page.goto(`/samples/${specimenId}`);
    await beat(page, LARGE);
    await expect(currentStatus).toContainText('Disponível');
    await expect(page.getByText(/ \/ Poço A1$/)).toBeVisible();

    // 2. Moved through the picker to the named freezer, shelf, rack and box, at B3.
    await page.getByRole('button', { name: 'Gerenciar Armazenagem' }).click();
    await beat(page, MEDIUM);
    await page.getByLabel('Freezer').selectOption(boxB.freezerId);
    await beat(page, SMALL);
    await page.getByLabel('Prateleira').selectOption('0');
    await beat(page, SMALL);
    await page.getByLabel('Rack').selectOption('0');
    await beat(page, SMALL);
    await page.getByLabel('Caixa').selectOption(boxB.boxId);
    await beat(page, SMALL);
    await page.getByLabel('Especificar posição exata').check();
    await page.getByLabel('Posição de destino').fill('B3');
    await beat(page, MEDIUM);
    await page.getByRole('button', { name: 'Confirmar Movimentação' }).click();
    const summary = page.getByText(`${freezerName}/${shelfName}/${rackName}/${boxName} / Poço B3`, { exact: true });
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await summary.scrollIntoViewIfNeeded();
    await beat(page, LARGE);

    // The move is persisted, not only shown.
    const location = await request.get(`${apiBaseURL}/api/storage/sample/${specimenId}`, { headers });
    expect(location.status()).toBe(200);
    const locationBody = (await location.json()).data;
    expect(locationBody.box.boxId).toBe(boxB.boxId);
    expect(locationBody.box.position).toBe('B3');

    // 3. Off camera: a total withdrawal depletes it; the status follows and closing is offered.
    const withdraw = await request.post(`${apiBaseURL}/api/samples/${specimenId}/withdraw`, {
      headers,
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Operadora do Biobanco',
        linkedProject: 'Showcase W8',
      },
    });
    expect(withdraw.status(), await withdraw.text()).toBe(200);
    await page.reload();
    await beat(page, LARGE);
    await expect(currentStatus).toContainText('Totalmente Retirada');
    await expect(page.getByTestId('sample-detail-close-button')).toBeVisible();

    // 4. Closed after the confirmation: the status reads closed and the action is gone.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('sample-detail-close-button').click();
    await expect(currentStatus).toContainText('Encerrada');
    await expect(page.getByTestId('sample-detail-close-button')).toHaveCount(0);
    await beat(page, LARGE);

    const closed = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers });
    expect(closed.status()).toBe(200);
    const closedBody = (await closed.json()).data;
    expect(closedBody.specimenStatus).toBe('closed');
    expect(closedBody.quantityStatus).toBe('depleted');
  });
});

// Login and sample inventory reel: the real login (a rejected password, then
// the right one) and the Inventário de Amostras listing specimens registered
// through the real API, a search narrowing it to one, and that specimen's
// page. Each specimen gets its own seeded box, since the seeder hands out one
// position per box. Deliberately not demoed: batch delete and label printing,
// which other cases cover.
test.describe('Human-paced e2e showcase reel — login and sample inventory', () => {
  const boxes: SeededStorageBox[] = [];
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-inventory-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('Inventário de Amostras: an operator signs in, browses the real inventory, searches a specimen and opens it', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    // Off camera: one participant and a few specimens of different types.
    const session = await realLogin(request);
    const headers = { Authorization: `Bearer ${session.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    await seedActiveConsent(participant.participantId);
    const kinds = [
      { sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD', extractionProtocol: 'TUBE_EDTA', quantity: 5, linkedProject: 'Coorte Doenças Raras' },
      { sampleType: 'SERUM', sampleOrigin: 'VENOUS_BLOOD', extractionProtocol: 'TUBE_SERUM', quantity: 3, linkedProject: 'Coorte Doenças Raras' },
      { sampleType: 'PBMC', sampleOrigin: 'VENOUS_BLOOD', extractionProtocol: 'TUBE_HEPARIN', quantity: 2, linkedProject: 'Estudo Imunogenética' },
      { sampleType: 'DBS', sampleOrigin: 'CAPILLARY_BLOOD', extractionProtocol: 'FILTER_PAPER', quantity: 1, linkedProject: 'Triagem Neonatal' },
    ];
    const specimenIds: string[] = [];
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    for (const [i, kind] of kinds.entries()) {
      const box = await seedStorageBoxLocation();
      boxes.push(box);
      // The storage column shows the tree's names, so they read as a real biobank's.
      const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
      const containers = db.collection('storageContainers');
      await containers.updateOne({ _id: new ObjectId(box.freezerId) }, { $set: { name: `Freezer -80 °C · Sala ${i < 2 ? 1 : 2}` } });
      await containers.updateOne({ _id: new ObjectId(box.shelfId) }, { $set: { name: `Prateleira ${i + 1}` } });
      await containers.updateOne({ _id: new ObjectId(box.rackId) }, { $set: { name: 'Rack A' } });
      await db.collection('storageBoxes').updateOne({ _id: new ObjectId(box.boxId) }, { $set: { name: `Caixa 0${i + 1}` } });
      const res = await request.post(`${apiBaseURL}/api/samples`, {
        headers,
        data: {
          participantId: participant.participantId,
          ...kind,
          quality: 'GOOD',
          registeredAt: new Date().toISOString(),
          boxId: box.boxId,
          positionCode: box.positionCode,
          collectionId: governed!.collectionId,
        },
      });
      if ([201, 202].includes(res.status())) specimenIds.push((await res.json()).data.specimenId as string);
    }
    // Off camera, as in the storage case: the compliance-graph inputs, so each specimen's page shows it releasable rather than blocked.
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
    await db.collection('patientConsents').updateOne(
      { participantId: participant.participantId, status: 'ACTIVE' },
      { $set: { consentTemplateId: participant.consentTemplateId } },
    );
    const samples = db.collection('samples');
    for (const specimenId of specimenIds) {
      await samples.updateOne({ specimenId }, {
        $set: {
          consentTemplateId: participant.consentTemplateId,
          clinicalData: { orphaCode: 'ORPHA:999001', cid: 'E75.2' },
          pharmacologyData: { treatmentStatus: 'NAIVE' },
          matrixType: 'fluid',
          sprec: {
            sampleType: 'BLD',
            primaryContainer: 'SST',
            preCentrifugation: 'A',
            centrifugation: 'A',
            secondCentrifugation: 'A',
            postCentrifugationDelay: 'A',
            longTermStorage: 'C',
          },
          sealedRcsAssessmentId: null,
          sealedSpecimenPreanalyticsId: null,
        },
      });
      const stored = await samples.findOne({ specimenId });
      expect(stored, `sample ${specimenId} not found`).not.toBeNull();
      await samples.updateOne({ specimenId }, { $set: { merkleRoot: sampleMerkleRoot(stored!) } });
    }
    await client.close();
    const graph = await request.get(`${apiBaseURL}/api/samples/${specimenIds[0]}/compliance-graph`, { headers });
    expect(graph.status(), await graph.text()).toBe(200);
    expect(specimenIds.length, 'at least two specimens registered').toBeGreaterThanOrEqual(2);

    // 1. A rejected login, then the real one. (RF003)
    await page.goto('/login');
    await expect(page.getByTestId('login-page')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('login-username-input').fill(testUser);
    await beat(page, SMALL);
    await page.getByTestId('login-password-input').fill('senha-errada');
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('login-password-input').fill(testPass);
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await page.waitForURL('**/system-management');
    await beat(page, LARGE);

    // 2. The inventory, reached from the sidebar, listing the registered specimens.
    await page.getByText('Inventário de Amostras', { exact: true }).first().click();
    await page.waitForURL('**/samples');
    await expect(page.getByTestId('samples-page-title')).toBeVisible();
    // Earlier scenes register specimens too, so the inventory holds more than this
    // scene's rows. The list is newest-first (10 per page), so this scene's own
    // specimens are on page 1; each is listed once.
    const rows = page.locator('[data-testid^="sample-row-"]');
    for (const specimenId of specimenIds) {
      await expect(rows.filter({ has: page.getByText(specimenId, { exact: true }) })).toHaveCount(1);
    }
    await beat(page, LARGE);
    await page.getByTestId('samples-table').scrollIntoViewIfNeeded();
    await beat(page, MEDIUM);

    // 3. A search by its specimen id narrows the list to one specimen.
    const target = specimenIds[0];
    await page.getByTestId('samples-search-input').scrollIntoViewIfNeeded();
    await page.getByTestId('samples-search-input').fill(target);
    await beat(page, SMALL);
    await page.getByTestId('samples-search-button').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ has: page.getByText(target, { exact: true }) })).toBeVisible();
    await beat(page, MEDIUM);

    // 4. That specimen's own page.
    await page.locator('[data-testid^="sample-edit-button-"]').first().click();
    await page.waitForURL(/\/samples\/[^/]+$/);
    await expect(page.getByText('Status Atual:', { exact: true })).toBeVisible();
    await beat(page, LARGE);
    await page.getByText('Armazenagem e Projeto').first().scrollIntoViewIfNeeded();
    await beat(page, LARGE);
  });
});

// W5 reel (security, LGPD and RBAC): user management through the real UI
// (RF003: a user created, its role changed and the account inactivated), the
// live session a role change ends (RNF008 AC7, RNF021 AC2), a user listing and
// ending their own sessions on Segurança da Conta (RNF021 AC6), the Logs
// screen with its session view (RF012, RNF009) and the read-only Permissões
// tab (RNF008 AC2). Each ended session is checked off camera through the API,
// as auth-access-security.spec.ts does. Deliberately not demoed: the MFA
// reset, the administrator password set and the auditor grant, which
// auth-access-security.spec.ts covers, and the audit chain's hash check, which
// needs a known event hash (audit-chain-integrity.spec.ts). The fixture users
// stay in place: deletion is logical (RF003 AC4).
test.describe('Human-paced e2e showcase reel — W5 security, LGPD and RBAC', () => {
  const password = 'Fixture@123456-forte';
  // A short suffix keeps the username and email unique on a reused volume
  // (RF003 AC1) while they still read as a name on camera.
  const suffix = () => Date.now().toString(36).slice(-4);

  test('RF003/RNF008 an administrator creates a user, changes its role, which ends its session, and inactivates it', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';
    const username = `marina.souza.${suffix()}`;
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    // 1. The administrator signs in.
    await page.goto('/login');
    await expect(page.getByTestId('login-page')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('login-username-input').fill(testUser);
    await beat(page, SMALL);
    await page.getByTestId('login-password-input').fill(testPass);
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await page.waitForURL('**/system-management');
    await beat(page, LARGE);

    // 2. A new user through the real form. (RF003 AC1)
    await page.goto('/system-management?tab=users');
    await expect(page.getByTestId('users-table')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('new-user-button').click();
    await expect(page.getByTestId('new-user-form')).toBeVisible();
    await beat(page, LARGE);
    await page.getByTestId('new-user-name-input').fill('Marina Souza');
    await beat(page, SMALL);
    await page.getByTestId('new-user-email-input').fill(`${username}@example.com`);
    await beat(page, SMALL);
    await page.getByTestId('new-user-username-input').fill(username);
    await beat(page, SMALL);
    await page.getByTestId('new-user-password-input').fill(password);
    await beat(page, SMALL);
    // The form opens on Técnico but its untouched default sends access type
    // 1, which registers an external user; choosing the role sends 2.
    await page.getByTestId('new-user-role-select').selectOption('Coordenador');
    await beat(page, SMALL);
    await page.getByTestId('new-user-role-select').selectOption('Técnico');
    await expect(page.getByTestId('new-user-role-select')).toHaveValue('Técnico');
    await beat(page, SMALL);
    const created = page.waitForResponse(
      (response) => response.url().includes('/api/users/register') && response.request().method() === 'POST'
    );
    await page.getByTestId('new-user-submit-button').click();
    const createdResponse = await created;
    expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
    expect(createdResponse.request().postDataJSON(), 'the form registers a technician').toMatchObject({
      roleName: 'Técnico',
      accessType: 2,
    });
    const createdBody = await createdResponse.json();
    const userID: string = createdBody.data?._id || createdBody.data?.id;
    expect(userID, 'the register response names the new user').toBeTruthy();
    await expect(page).toHaveURL(/system-management/);
    const row = page.locator('tr', { has: page.getByTestId(`edit-user-button-${userID}`) });
    await expect(row).toContainText('Marina Souza');
    await expect(row.locator('.role-badge').first()).toContainText('Técnico');
    await expect(row.locator('.status-badge').first()).toHaveText('Ativo');
    await row.scrollIntoViewIfNeeded();
    await beat(page, LARGE);

    // Off camera: the new user enrols the second factor and opens a session,
    // as on a first login.
    const target = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const targetStatus = () =>
      request.get(`${apiBaseURL}/api/user/security/status`, { headers: { Authorization: `Bearer ${target.token}` } });
    expect((await targetStatus()).status(), 'the session works before the role change').toBe(200);

    // 3. A role change through the edit form ends that live session.
    // (RF003 AC3, RNF008 AC7, RNF021 AC2)
    await page.getByTestId(`edit-user-button-${userID}`).click();
    await expect(page.getByTestId('new-user-form')).toBeVisible();
    await beat(page, LARGE);
    await page.getByTestId('new-user-role-select').selectOption('Coordenador');
    await beat(page, MEDIUM);
    const roleSaved = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${userID}`) && response.request().method() === 'PUT'
    );
    await page.getByTestId('new-user-submit-button').click();
    const roleResponse = await roleSaved;
    expect(roleResponse.status(), await roleResponse.text()).toBe(200);
    await expect(page).toHaveURL(/system-management/);
    await expect(row.locator('.role-badge').first()).toContainText('Coordenador');
    await row.scrollIntoViewIfNeeded();
    await beat(page, LARGE);
    expect((await targetStatus()).status(), 'the role change ended the session').toBe(401);

    // 4. Inactivation keeps the account's record. (RF003 AC4, RNF022 AC5)
    await page.getByTestId(`edit-user-button-${userID}`).click();
    await expect(page.getByTestId('new-user-form')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('new-user-status-select').scrollIntoViewIfNeeded();
    await page.getByTestId('new-user-status-select').selectOption('Inativo');
    await beat(page, SMALL);
    const statusSaved = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${userID}`) && response.request().method() === 'PUT'
    );
    await page.getByTestId('new-user-submit-button').click();
    const statusResponse = await statusSaved;
    expect(statusResponse.status(), await statusResponse.text()).toBe(200);
    await expect(page).toHaveURL(/system-management/);
    await expect(row.locator('.status-badge').first()).toHaveText('Inativo');
    await row.scrollIntoViewIfNeeded();
    await beat(page, LARGE);
  });

  test('RNF021 AC6/RF012/RNF008 AC2 a user ends their own sessions, then the administrator reads the Logs and the permissions tab', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';
    const username = `rafael.lima.${suffix()}`;
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    // Off camera: a Técnico with an enrolled second factor and a session on
    // another device. The first-login enrolment is inline, not through
    // completeFirstLoginMfa, so the TOTP secret is kept for the UI login below.
    const admin = await realLogin(request);
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: 'Rafael Lima', email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const qr = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, { data: { username, password } });
    expect(qr.ok(), await qr.text()).toBeTruthy();
    const secret: string = (await qr.json()).data?.secret;
    expect(secret).toBeTruthy();
    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();
    const otherToken: string = (await enable.json()).data.token;
    const otherStatus = () =>
      request.get(`${apiBaseURL}/api/user/security/status`, { headers: { Authorization: `Bearer ${otherToken}` } });
    expect((await otherStatus()).status(), 'the other session works before').toBe(200);

    // 1. The user signs in with password and second factor. The beats before
    // the code keep this login in a later second than the enrolment above, so
    // the two sessions' tokens differ.
    await page.goto('/login');
    await expect(page.getByTestId('login-page')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('login-username-input').fill(username);
    await beat(page, SMALL);
    await page.getByTestId('login-password-input').fill(password);
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await expect(page.getByTestId('two-factor-section')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('login-mfa-code-input').fill(computeTotp(secret));
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await page.waitForURL('**/dashboard');
    await beat(page, LARGE);

    // 2. Segurança da Conta lists both sessions, this one marked current, and
    // the user ends the other one. (RNF021 AC6)
    await page.goto('/user/security');
    await expect(page.getByTestId('security-page-title')).toBeVisible();
    const sessions = page.getByTestId('session-item');
    await expect(sessions).toHaveCount(2);
    await expect(page.locator('[data-testid="session-item"][data-session-current="true"]')).toHaveCount(1);
    await page.getByTestId('sessions-list').scrollIntoViewIfNeeded();
    await beat(page, LARGE);
    await page
      .locator('[data-testid="session-item"][data-session-current="false"] [data-testid^="revoke-session-button-"]')
      .click();
    await expect(page.getByTestId('security-confirm-proceed-button')).toBeVisible();
    await beat(page, MEDIUM);
    const ended = page.waitForResponse(
      (response) => response.url().includes('/api/auth/sessions/') && response.request().method() === 'DELETE'
    );
    await page.getByTestId('security-confirm-proceed-button').click();
    expect((await ended).status()).toBe(200);
    await expect(sessions).toHaveCount(1);
    await beat(page, MEDIUM);
    expect((await otherStatus()).status(), 'the ended session is refused').toBe(401);

    // 3. Sair ends the current session too. (RNF021 AC2, RF001 AC4)
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL('**/login');
    await expect(page.getByTestId('login-page')).toBeVisible();
    await beat(page, LARGE);

    // 4. The administrator signs in and opens Logs. (RF012, RNF009)
    await page.getByTestId('login-username-input').fill(testUser);
    await beat(page, SMALL);
    await page.getByTestId('login-password-input').fill(testPass);
    await beat(page, SMALL);
    await page.getByTestId('login-submit-button').click();
    await page.waitForURL('**/system-management');
    await beat(page, MEDIUM);
    await page.locator('a[href="/logs"]').first().click();
    await page.waitForURL('**/logs');
    await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
    await expect(page.locator('.logs-table-container')).toBeVisible();
    await beat(page, LARGE);
    await page.locator('.logs-table-container').scrollIntoViewIfNeeded();
    await beat(page, MEDIUM);

    // The session view, narrowed to sessions their own users ended: the one
    // ended above is among them, its owner shown as a pseudonym.
    const reasonsLoaded = page.waitForResponse(
      (response) => response.url().includes('/api/logs/sessions') && response.url().includes('revocationReason=user_request')
    );
    await page.getByLabel('Motivo da revogação').selectOption('user_request');
    expect((await reasonsLoaded).status()).toBe(200);
    await expect(page.getByTestId('session-audit-reason').first()).toHaveText('Solicitação do usuário');
    await page.getByTestId('session-audit-table').scrollIntoViewIfNeeded();
    await beat(page, LARGE);

    // 5. The Permissões tab: the seeded roles and the permissions enforcement
    // reads, shown read-only. (RNF008 AC2)
    await page.goto('/system-management?tab=security');
    await expect(page.getByTestId('security-page')).toBeVisible();
    await beat(page, MEDIUM);
    await page.getByTestId('security-nav-permissions').click();
    await expect(page.getByTestId('security-permissions-readonly-note')).toBeVisible();
    const manageSystem = page.getByTestId('security-permission-toggle-administrator-manageSystem');
    await expect(manageSystem).toBeChecked();
    await expect(manageSystem).toBeDisabled();
    await beat(page, LARGE);
    await page.getByTestId('security-permission-role-auditor').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('security-permission-toggle-auditor-viewAuditLogs')).toBeChecked();
    await beat(page, LARGE);
  });
});

// W10 reel (#1483): a sample's scientific files, an ingestion result and the
// MIABIS export. RF007's upload is the sample page's own Arquivos section,
// driven by the selectors sample-files-section-ui.spec.ts proves. The
// replace has no UI: the new version goes through PUT .../replace off
// camera, as a client system sends it, and the page, reloaded, lists the
// file under its new name in the same row, whose download carries the
// replacement. RF029's ingestion is a machine endpoint, as the W9 readings
// are: a Specimen record goes through POST /api/ingestion/records off
// camera and the operator finds the accepted specimen in the inventory.
// RF020 AC5's MIABIS export has no page either: the browser opens the
// export endpoint itself, on the record of a collection registered off
// camera.
test.describe('Human-paced e2e showcase reel — W10 files, ingestion and MIABIS export', () => {
  const boxes: SeededStorageBox[] = [];
  const organizationIds: string[] = [];
  // #1497 (RF004 AC2): the collection this reel's specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`showcase-w10-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async ({ request }) => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('RF007 an operator uploads a scientific file on the sample page, and its replacement is listed and downloaded in its place', async ({ page, request }) => {
    const session = await realLogin(request);
    const headers = { Authorization: `Bearer ${session.token}` };
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);

    // Off camera: a stored specimen, registered as sample-files-section-ui.spec.ts does.
    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    const box = await seedStorageBoxLocation();
    boxes.push(box);
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'Coorte Doenças Raras',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202], await create.text()).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId as string;
    const original = Buffer.from('specimen_id,analyte,value\nS-1,glucose,92\n');
    // The names reach the screen, so they read as a lab's; the specimen is new each run, so its file list holds only these.
    const fileName = 'perfil-metabolico.csv';

    // 1. The sample's page and its Arquivos section.
    await page.goto(`/samples/${specimenId}`);
    await expect(page.getByTestId('sample-detail-page-title')).toBeVisible();
    await beat(page, LARGE);
    await page.getByTestId('sample-files-open-upload-button').scrollIntoViewIfNeeded();
    await beat(page, MEDIUM);

    // 2. The upload, through the section's own form. (RF007)
    await page.getByTestId('sample-files-open-upload-button').click();
    await beat(page, SMALL);
    await page.getByTestId('file-upload-input').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: original });
    await beat(page, SMALL);
    await page.getByTestId('sample-files-upload-submit').click();
    await expect(page.getByTestId('sample-files-upload-submit')).not.toBeVisible();
    await expect(page.getByText(fileName, { exact: true })).toBeVisible();
    await beat(page, LARGE);

    // Off camera: the stored row, then its replacement, sent as a client system sends it. (RF007 AC4)
    const list = await request.get(`${apiBaseURL}/api/samples/${specimenId}/files`, { headers });
    expect(list.ok(), await list.text()).toBeTruthy();
    const uploaded = (await list.json()).data.find((file: { fileName: string }) => file.fileName === fileName);
    expect(uploaded, `${fileName} listed`).toBeTruthy();
    const fileID = String(uploaded._id);
    const replacement = Buffer.from('specimen_id,analyte,value\nS-1,glucose,94\nS-1,lactate,1.1\n');
    const replacementName = 'perfil-metabolico-v2.csv';
    const replace = await request.put(`${apiBaseURL}/api/samples/${specimenId}/files/${fileID}/replace`, {
      headers,
      multipart: {
        changeReason: 'Correção do valor de glicose',
        file: { name: replacementName, mimeType: 'text/csv', buffer: replacement },
      },
    });
    expect(replace.status(), await replace.text()).toBe(200);
    expect((await replace.json()).data.versionNumber).toBe(2);

    // 3. Reloaded, the page lists the file under its new name, in the same row. (RF007 AC4)
    await page.reload();
    const row = page.getByTestId(`sample-file-row-${fileID}`);
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByText(replacementName, { exact: true })).toBeVisible();
    await expect(page.getByText(fileName, { exact: true })).toHaveCount(0);
    await beat(page, LARGE);

    // 4. The download, clicked on camera, carries the replacement's bytes.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`sample-file-download-button-${fileID}`).click(),
    ]);
    expect(download.suggestedFilename()).toBe(replacementName);
    const downloaded = await readFile((await download.path())!);
    expect(downloaded.equals(replacement)).toBe(true);
    await beat(page, MEDIUM);
  });

  test('RF029 a specimen record a client system sends is accepted by ingestion and the operator finds it in the inventory', async ({ page, request }) => {
    const session = await realLogin(request);
    const headers = { Authorization: `Bearer ${session.token}` };
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Off camera: the record's references, as ingestion-records.spec.ts seeds
    // them -- a participant with an active consent and a collection site.
    // The ingested specimen references the site, so its delete is refused
    // and the site stays; the name is never drawn, and the stamp keeps the
    // next run's create a 201 rather than a reuse.
    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    await seedActiveConsent(participant.participantId);
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `Hospital Parceiro ${stamp}`, acronym: 'HPAR', organizationType: 'biobank', countryCode: 'BR' },
    });
    expect(org.status(), await org.text()).toBe(201);
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    // Off camera: the record arrives through the ingestion endpoint. (RF029)
    const ingest = await request.post(`${apiBaseURL}/api/ingestion/records`, {
      headers,
      data: {
        entityType: 'Specimen',
        payload: {
          specimenId: 'client-claimed',
          participantId: participant.participantId,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 5,
          registeredAt: new Date().toISOString(),
          collectionSite: organizationId,
          collectionId: governed!.collectionId,
        },
        provenance: {
          sourceSystem: 'urn:system:showcase-w10',
          retrievedAt: new Date().toISOString(),
          purpose: 'e2e_proof',
          sourceRecordId: `showcase-w10-${stamp}`,
        },
      },
    });
    expect(ingest.status(), await ingest.text()).toBe(201);
    const outcome = await ingest.json();
    expect(outcome).toMatchObject({ success: true, status: 'accepted', entityType: 'Specimen' });
    const specimenId = outcome.entityId as string;

    // 1. The inventory, searched by the server's specimen id.
    await page.goto('/samples');
    await expect(page.getByTestId('samples-page-title')).toBeVisible();
    await beat(page, LARGE);
    const rows = page.locator('[data-testid^="sample-row-"]');
    await page.getByTestId('samples-search-input').scrollIntoViewIfNeeded();
    await page.getByTestId('samples-search-input').fill(specimenId);
    await beat(page, SMALL);
    await page.getByTestId('samples-search-button').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ has: page.getByText(specimenId, { exact: true }) })).toBeVisible();
    await beat(page, MEDIUM);

    // 2. The ingested specimen's own page.
    await page.locator('[data-testid^="sample-edit-button-"]').first().click();
    await page.waitForURL(/\/samples\/[^/]+$/);
    await expect(page.getByText('Status Atual:', { exact: true })).toBeVisible();
    await beat(page, LARGE);
  });

  test('RF020 AC5 the MIABIS export carries a collection registered in the biobank', async ({ page, request }) => {
    const session = await realLogin(request);
    const headers = { Authorization: `Bearer ${session.token}` };
    // The collection id is the text the shot highlights, so it reads as a
    // lab's; a run cut off before its finally left these rows behind, and
    // the deletes clear them (the deletes are hard) before they are entered.
    const biobankId = 'bb-doencas-raras';
    const collectionId = 'col-doencas-raras';
    await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, { headers }).catch(() => {});
    await request.delete(`${apiBaseURL}/api/biobanks/${biobankId}`, { headers }).catch(() => {});

    // Off camera: a biobank and a collection, entered as miabis-export.spec.ts enters them.
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: 'Biobanco de Doenças Raras', countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    try {
      const biobank = await request.post(`${apiBaseURL}/api/biobanks`, {
        headers,
        data: {
          biobankId,
          biobankName: 'Biobanco de Doenças Raras',
          biobankDescription: 'Biobanco da demonstração da exportação MIABIS',
          legalEntityId: organizationId,
          biobankStatus: 'active',
          countryCode: 'BR',
          contactInformation: { email: 'contato@example.org' },
        },
      });
      expect(biobank.ok(), await biobank.text()).toBeTruthy();
      const collection = await request.post(`${apiBaseURL}/api/collections`, {
        headers,
        data: { collectionId, collectionName: 'Coleção Doenças Raras', governanceRegime: 'biorepository' },
      });
      expect(collection.ok(), await collection.text()).toBeTruthy();

      // Off camera: the export's record for that collection. (RF020 AC5)
      const res = await request.get(`${apiBaseURL}/api/biobanks/miabis/export`, { headers });
      expect(res.ok(), await res.text()).toBeTruthy();
      const data = (await res.json()).data;
      const record = data.collections.find((entry: { miabis: { id: string } }) => entry.miabis.id === collectionId);
      expect(record, `collection ${collectionId} in the export`).toBeTruthy();
      expect(record.nationalExtensions.governanceRegime).toBe('biorepository');
      expect(data.conformanceClaimed).toBe(false);

      // 1. The export itself, opened in the browser, on that collection's record.
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${apiBaseURL}/api/biobanks/miabis/export`);
      await expect(page.getByText(collectionId).first()).toBeVisible();
      await beat(page, LARGE);
      await page.evaluate((id) => (window as unknown as { find: (text: string) => boolean }).find(id), collectionId);
      await beat(page, LARGE);
    } finally {
      await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, { headers }).catch(() => {});
      await request.delete(`${apiBaseURL}/api/biobanks/${biobankId}`, { headers }).catch(() => {});
    }
  });
});

// W11 reel (#1474): the two W11 flows an operator sees in the UI.
//
//  - RNF027 C1/C2: an administrator signs in and reaches the Backup page by
//    keyboard alone, every stop showing its focus, as rnf027-interface.spec.ts
//    proves in three browsers.
//  - RNF010 C1/C5: a backup run from the Backup page exports MongoDB, Neo4j
//    and InfluxDB, and its restore test verifies every store. The page then
//    shows the RPO and RTO the policy holds (RNF010 C2/C3).
//
// Deliberately not demoed: the request metrics, the platform alerts, the
// monitoring runs, the availability record and the deep health route. They
// are the Administrador's API (/api/monitoring/*, /api/availability,
// /api/health) and no screen shows them, so the reel does not fabricate one.
// The restore test has no UI either: it runs off camera through
// POST /api/backup/restore-test on the backup the reel created, and its result
// is asserted. The page's Restaurar button replaces the live database, so it
// is never clicked.
test.describe('Human-paced e2e showcase reel — W11 keyboard navigation and backup restore test', () => {
  test('RNF027 an administrator signs in and reaches the Backup page by keyboard alone', async ({ page }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });

    // 1. The login form by keyboard: the username field takes focus on load,
    // Tab moves to the password, Enter submits.
    await page.goto('/login');
    await expect(page.getByTestId('login-username-input')).toBeFocused();
    await beat(page, MEDIUM);
    await page.keyboard.type(testUser, { delay: 80 });
    await beat(page, SMALL);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('login-password-input')).toBeFocused();
    await page.keyboard.type(testPass, { delay: 60 });
    await beat(page, SMALL);
    await page.keyboard.press('Enter');
    await page.waitForURL('**/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();
    await beat(page, LARGE);

    // 2. The sidebar by keyboard, from its first link down to Backup, as
    // rnf027-interface.spec.ts walks it. Each stop is centred so the caption
    // never hides the focused link.
    const backupLink = page.locator('aside#app-sidebar nav.sidebar-nav a[href="/backup"]');
    await expect(backupLink).toBeVisible();
    const firstNav = page.locator('aside#app-sidebar nav.sidebar-nav a').first();
    await firstNav.focus();
    await expect(firstNav).toBeFocused();
    await beat(page, MEDIUM);
    let reached = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'center' }));
      await beat(page, SMALL / 2);
      if (await backupLink.evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    await beat(page, MEDIUM);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/backup$/);
    await expect(page.getByRole('heading', { name: 'Gerenciamento de Backup' })).toBeVisible();
    await beat(page, LARGE);
  });

  test('RNF010 an administrator runs a backup of every store and its restore test verifies it', async ({ page, request }) => {
    const session = await realLogin(request);
    const headers = { Authorization: `Bearer ${session.token}` };
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);

    // 1. The backup run from the page.
    await page.goto('/backup');
    await expect(page.getByRole('heading', { name: 'Gerenciamento de Backup' })).toBeVisible();
    await beat(page, LARGE);
    const performed = page.waitForResponse((res) => res.url().includes('/api/backup/perform') && res.request().method() === 'POST');
    await page.locator('.create-backup-button').click();
    const run = (await (await performed).json()).data;
    // The run names its folder by path; the table lists it by that folder's name.
    const fileName = String(run.path).split(/[\\/]/).pop()!;
    await expect(page.locator('.status-message.success')).toBeVisible({ timeout: 15_000 });
    await beat(page, MEDIUM);

    // 2. The run is listed with its state and checksum.
    const row = page.locator('.backups-table tbody tr', { hasText: fileName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.backup-status-badge')).toHaveAttribute('data-status', 'success');
    await row.scrollIntoViewIfNeeded();
    await beat(page, LARGE);

    // Off camera: the run exported every store, and its restore test verifies
    // the checksum and each store's counts. No screen shows the restore test.
    expect(run.stores.neo4j.status).toBe('exported');
    expect(run.stores.influxdb.status).toBe('exported');
    const restoreTest = await request.post(`${apiBaseURL}/api/backup/restore-test/${fileName}`, { headers });
    expect(restoreTest.status(), await restoreTest.text()).toBe(200);
    const result = (await restoreTest.json()).data;
    expect(result.success, result.error).toBe(true);
    expect(result.checksumVerified).toBe(true);
    expect(result.stores.neo4j.status, result.stores.neo4j.error).toBe('verified');
    expect(result.stores.influxdb.status, result.stores.influxdb.error).toBe('verified');

    // 3. The policy's recovery targets, RPO and RTO, on the same page.
    const rpo = page.locator('#backup-policy-rpo');
    await rpo.scrollIntoViewIfNeeded();
    await expect(rpo).toBeVisible();
    await expect(page.locator('#backup-policy-rto')).toBeVisible();
    await beat(page, LARGE);
  });
});

// W6 reel: a consent term's revision and a collection's regime conversion.
//  - RF010 AC1/AC5/AC8: an operator publishes a new version of a term from
//    the builder at /admin/tcle/edit/:id, which supersedes the earlier one.
//    The builder reports the invitation sweep to the participant still pending
//    on the old version, and /consents shows the policy change notice sent to
//    the holder of a consent in force under it, as
//    tcle-publication-sweep.spec.ts and consent-policy-change-notice.spec.ts
//    prove.
//  - RF020 AC4: an operator converts a biorepository collection to a biobank
//    from its governance panel, with the biobank's context, an approval in
//    force and a justification, and the decision history records the
//    regime_change event, as specimen-quality-inventory.spec.ts proves
//    through the API.
//
// Deliberately not demoed: the emails themselves, which the test stack's SMTP
// catcher accepts and no screen shows; the invitation's token is asserted off
// camera. The term's first version, its pending participant and its holder are
// seeded, as both e2e specs do. The collection's approval and its first
// biorepository context are recorded off camera through the API, since the W6
// collection governance case above already shows both on screen, and the
// access policy the biobank names is created through the API because
// AccessPolicy has no UI.
test.describe('Human-paced e2e showcase reel — W6 term revision and regime conversion', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('RF010 AC1/AC5/AC8 an operator publishes a revised term, inviting the pending participant and notifying the holder in force', async ({ page, request }) => {
    const session = await realLogin(request);
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const title = `0 Showcase TCLE revisão ${stamp}`;
    const versionGroupId = `showcase-tcle-revision-${stamp}`;
    const permissionKey = 'showcase-research';
    // Eight-digit participant ids, the form the patient lookup reads directly.
    const pending = String(86_000_000 + Math.floor(Math.random() * 1_000_000));
    const holder = String(87_000_000 + Math.floor(Math.random() * 1_000_000));
    const participantIds = [pending, holder];
    const holderConsentId = `showcase-tcle-holder-${stamp}`;

    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');

    try {
      const inserted = await db.collection('consent_templates').insertOne({
        title,
        content: '<p>Versão 1 do termo de consentimento para pesquisa com amostras.</p>',
        htmlContent: '<p>Versão 1 do termo de consentimento para pesquisa com amostras.</p>',
        version: 'v1',
        versionGroupId,
        caae: '',
        active: true,
        permissions: [{ key: permissionKey, label: 'Uso das amostras em pesquisa', required: true }],
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2027-12-31T23:59:59.000Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const v1Id = inserted.insertedId;
      // One participant still pending on v1, one holding a consent in force under it.
      await db.collection('patients').insertMany([
        { participantId: pending, status: 'PENDING_CONSENT', consentTemplateId: v1Id.toString(), createdAt: new Date(), updatedAt: new Date() },
        { participantId: holder, status: 'ACTIVE', consentTemplateId: v1Id.toString(), createdAt: new Date(), updatedAt: new Date() },
      ]);
      await db.collection('participantIdentities').insertMany(participantIds.map((participantId) => ({
        participantId,
        email: `showcase-tcle-${participantId}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })));
      await db.collection('patientConsents').insertOne({
        consentId: holderConsentId,
        participantId: holder,
        consentTemplateId: v1Id.toString(),
        consentVersion: 'v1',
        responses: { [permissionKey]: true },
        status: 'ACTIVE',
        signedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. The builder opens the term in force and the operator revises its text.
      await page.goto(`/admin/tcle/edit/${v1Id.toString()}`);
      const editor = page.getByRole('textbox', { name: 'Editor do corpo do TCLE' });
      await expect(editor).toContainText('Versão 1 do termo', { timeout: 15_000 });
      await beat(page, LARGE);
      await editor.fill('Versão 2 do termo de consentimento para pesquisa com amostras, revisada pelo operador.');
      await beat(page, SMALL);
      // RF010 AC1: the revision records the modality chosen in the builder.
      await page.getByLabel('Modalidade de Consentimento').selectOption('dynamic');
      await beat(page, MEDIUM);

      // 2. Saved as a new version: the builder reports the invitation sweep.
      await page.getByRole('button', { name: 'Salvar nova versão do TCLE' }).click();
      const published = page.getByRole('alert').filter({ hasText: 'Nova versão criada' });
      await expect(published).toContainText('1 de 1 participantes pendentes', { timeout: 15_000 });
      await published.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // Off camera: v2 supersedes v1, the pending participant holds a fresh
      // invitation token, and the holder's notice is recorded as delivered.
      const v2 = await db.collection('consent_templates').findOne({ versionGroupId, _id: { $ne: v1Id } });
      expect(v2?.version).toBe('v2');
      expect(v2?.previousPolicyId).toBe(v1Id.toString());
      expect(v2?.consentModel).toBe('dynamic');
      const invited = await db.collection('patients').findOne({ participantId: pending });
      expect(invited?.consentTokenHash).toMatch(/^[0-9a-f]{64}$/);
      const notice = await db.collection('consentCommunicationEvents').findOne({ consentId: holderConsentId });
      expect(notice).toMatchObject({
        communicationType: 'policy_change_notice',
        contentTemplateId: 'consent.policy_change_notice.v1',
        sourceEventType: 'ConsentTemplate',
        sourceEventId: String(v2?._id),
        deliveryStatus: 'delivered',
      });

      // 3. The holder's consent history lists the policy change notice.
      await page.goto(`/consents?participantId=${holder}`);
      const noticeRow = page.getByTestId('consent-communication-consent.policy_change_notice.v1');
      await expect(noticeRow).toContainText('Atualização do termo', { timeout: 15_000 });
      await expect(noticeRow).toContainText('delivered');
      await noticeRow.scrollIntoViewIfNeeded();
      await beat(page, LARGE);
    } finally {
      await db.collection('consentCommunicationEvents').deleteMany({ consentId: holderConsentId });
      await db.collection('patientConsents').deleteMany({ participantId: { $in: participantIds } });
      await db.collection('participantIdentities').deleteMany({ participantId: { $in: participantIds } });
      await db.collection('patients').deleteMany({ participantId: { $in: participantIds } });
      await db.collection('consent_templates').deleteMany({ versionGroupId });
      await client.close();
    }
  });

  test('RF020 AC4 an operator converts a biorepository collection to a biobank with its justification', async ({ page, request }) => {
    const session = await realLogin(request);
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `showcase-regime-${stamp}`, studyId: `showcase-regime-study-${stamp}`, protocolId: `showcase-regime-protocol-${stamp}` };
    const justification = 'Ampliação para uso futuro em pesquisas compatíveis com o consentimento';
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    // The organization pickers read the first page sorted by name.
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `0 Showcase Regime ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    await client.connect();
    const db = client.db(process.env.E2E_MONGO_DB || 'bioavanced_test');
    let accessPolicyId = '';

    try {
      // Off camera: an approval in force and the biorepository's first context.
      const approval = await request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/approvals`, {
        headers,
        data: {
          authority: 'CEP Hospital Universitário',
          caae: '00000000.0.0000.0000',
          documentUri: 'https://docs.example.org/parecer-cep.pdf',
          documentChecksum: `sha256:${'e'.repeat(64)}`,
          effectivePeriod: { start: '2026-01-01', end: '2030-12-31' },
          status: 'active',
          responsibleOrganizationId: organizationId,
        },
      });
      expect(approval.status(), await approval.text()).toBe(201);
      const approvalId = (await approval.json()).data.approvalId as string;
      const created = await request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/events`, {
        headers,
        data: {
          justification: 'Contexto inicial do biorrepositório aprovado pelo CEP',
          governanceContext: {
            studyId: ids.studyId,
            protocolId: ids.protocolId,
            protocolVersion: '1.0',
            caae: '00000000.0.0000.0000',
            responsibleOrganizationId: organizationId,
            responsibleInvestigatorId: 'Dra. Pesquisadora Responsável',
            ethicsApprovalId: approvalId,
            validityPeriod: { start: '2026-01-01', end: '2030-12-31' },
            plannedEndDate: '2030-12-31',
          },
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      // Off camera: the biobank's access policy, which has no UI.
      const policy = await request.post(`${apiBaseURL}/api/access-policies`, {
        headers,
        data: {
          policyName: `Showcase biobanco ${stamp}`,
          policyVersion: '1.0.0',
          applicableEntityTypes: ['AccessRequest'],
          decisionEffect: 'review_required',
          ruleExpression: 'all-conditions',
          effectivePeriod: { start: new Date(Date.now() - 60_000).toISOString() },
          roleCodes: ['researcher'],
          organizationScopeIds: [organizationId],
          resourceScopes: ['Specimen'],
          conditions: [{ consent: 'compatible' }],
          decisionReasonsRequired: true,
        },
      });
      expect(policy.status(), await policy.text()).toBe(201);
      accessPolicyId = (await policy.json()).data.accessPolicyId as string;

      // 1. The collection's governance: a biorepository with its first decision.
      await page.goto('/system-management?tab=collections');
      await beat(page, LARGE);
      await page.getByTestId(`governance-collection-button-${ids.collectionId}`).click();
      await expect(page.getByTestId('collection-governance-panel')).toBeVisible();
      await expect(page.getByTestId('collection-governance-regime')).toContainText('Biorrepositório');
      await beat(page, MEDIUM);

      // 2. The conversion: the biobank's context, the approval it rests on, and why.
      const regime = page.getByTestId('governance-event-regime-select');
      await regime.scrollIntoViewIfNeeded();
      await regime.selectOption('biobank');
      await beat(page, SMALL);
      await page.getByTestId('governance-context-broad-purpose-input').fill('Pesquisa em saúde com amostras do biobanco');
      await page.getByTestId('governance-context-policy-input').fill(accessPolicyId);
      await page.getByTestId('governance-context-committee-input').fill('Comitê de Acesso do Biobanco');
      await page.getByTestId('governance-context-custodian-select').selectOption(organizationId);
      await page.getByTestId('governance-context-future-use-input').fill('Uso compatível com o consentimento');
      await page.getByTestId('governance-context-consent-model-broad').check();
      await page.getByTestId('governance-context-ethics-rule-select').selectOption('when_required_by_policy');
      await page.getByTestId(`governance-event-approval-${approvalId}`).check();
      await beat(page, SMALL);
      await page.getByTestId('governance-event-justification-input').fill(justification);
      await beat(page, SMALL);
      await page.getByTestId('governance-event-submit').click();

      // 3. The history records the conversion with its justification.
      const events = page.getByTestId('collection-governance-events');
      await expect(events).toContainText('Conversão de regime');
      await expect(events).toContainText(justification);
      await expect(page.getByTestId('collection-governance-regime')).toContainText('Biobanco');
      await events.scrollIntoViewIfNeeded();
      await beat(page, LARGE);

      // Off camera: the regime_change event follows the created one.
      const governance = await request.get(`${apiBaseURL}/api/collections/${ids.collectionId}/governance`, { headers });
      expect(governance.status(), await governance.text()).toBe(200);
      const recorded = (await governance.json()).data;
      expect(recorded.governanceRegime).toBe('biobank');
      expect(recorded.events.map((e: { decisionType: string; previousRegime: string | null; newRegime: string }) => [e.decisionType, e.previousRegime, e.newRegime])).toEqual([
        ['created', null, 'biorepository'],
        ['regime_change', 'biorepository', 'biobank'],
      ]);
      expect(recorded.events[1]).toMatchObject({ justification, approvalIds: [approvalId] });
    } finally {
      await request.delete(`${apiBaseURL}/api/collections/${ids.collectionId}`, { headers }).catch(() => {});
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, { headers }).catch(() => {});
      if (accessPolicyId) await db.collection('accessPolicies').deleteMany({ accessPolicyId });
      await client.close();
    }
  });
});
