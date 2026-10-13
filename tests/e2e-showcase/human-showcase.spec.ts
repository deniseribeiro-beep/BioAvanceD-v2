import { test, expect, type Page } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { randomBytes, createHash } from 'crypto';
import { realLogin, seedRealAuth } from '../e2e/helpers/realAuth';
import { createRealParticipant, seedStorageBoxLocation, cleanupStorageBoxLocation, closeSeedDb, seedStudy, seedProtocol, seedCollectionEntity, seedActiveConsent, seedDuoConcept, type SeededStorageBox } from '../e2e/helpers/seedParticipant';

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
// seedStorageBoxLocation() fixture gap (#598) -- the equipment sub-domain
// alone is what's demoed for RF017.
test.describe('Human-paced e2e showcase reel — Wave 3 (#646)', () => {
  test.afterAll(async () => {
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
      // RF014 AC4 (#1339): the save is a new release, active at the top of
      // the history, with the one it replaced offering a rollback.
      await page.getByTestId('security-nav-releases').click();
      await expect(page.getByTestId('security-release-row').first()).toHaveAttribute('data-status', 'active');
      await expect(page.getByTestId('security-release-rollback').first()).toBeVisible();
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
  test.afterAll(async () => {
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
//    selectors and seeding shape this segment reuses verbatim.
//  - RNF011 AC#4 / RF029 AC#6's LGPD import surface (`/import/lgpd`, #808)
//    and its quarantine review screen (`/import/quarantine`, #794 item 2).
//    The requirement is "invalid imports are staged or quarantined, without
//    silent correction"; this is the first reel where a human can watch a
//    rejected row survive its own import.
//
// The import API half is proven by lgpd-sample-import.spec.ts (#759/#787),
// which is where the MIABIS ids and the mixed-file CSV shape below come from
// -- the page is a thin surface over that already-green path. The page itself
// had only mocked component coverage (ImportLGPDPage.test.tsx), so this
// segment is the first time it is driven against a real backend at all.
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
      expect(stored?.consentTokenHash).toBeNull();
    } finally {
      await db.collection('patients').deleteMany({ participantId }).catch(() => {});
      await db.collection('patientConsents').deleteMany({ participantId }).catch(() => {});
      await db.collection('consent_templates').deleteMany({ title: TERM_TITLE }).catch(() => {});
    }
  });

  test('RNF011 AC#4 an operator imports a spreadsheet and the rejected row is quarantined, not dropped', async ({ page, request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

    const createdParticipantIds: string[] = [];
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

      // Off camera: three real participants for the spreadsheet to reference,
      // so the uploaded file is a plausible one rather than a file every row
      // of which would fail for the same reason.
      const admin = await realLogin(request);
      for (let i = 0; i < 3; i += 1) {
        const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
        createdParticipantIds.push(participant.participantId);
      }
      const [firstId, secondId, badId] = createdParticipantIds;

      // The MIABIS ids are the real seeded ones (foundation-bootstrap-test);
      // the third row's sampleType is not, which is what gets it rejected.
      // Same mixed-file shape as lgpd-sample-import.spec.ts's #787 block.
      const csv = [
        'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject',
        `${firstId},PLASMA,VENOUS_BLOOD,TUBE_EDTA,5,GOOD,Coorte Wave 5 (showcase)`,
        `${secondId},PLASMA,VENOUS_BLOOD,TUBE_EDTA,3,GOOD,Coorte Wave 5 (showcase)`,
        `${badId},TIPO_QUE_NAO_EXISTE,VENOUS_BLOOD,TUBE_EDTA,5,GOOD,Coorte Wave 5 (showcase)`,
      ].join('\n');

      // 2. The LGPD import surface (#808) -- the only importer that
      //    quarantines its rejected rows.
      await page.goto('/import/lgpd');
      await expect(page.getByRole('heading', { name: 'Importação LGPD' })).toBeVisible();
      await beat(page, LARGE);

      await page.getByTestId('import-lgpd-type').selectOption('samples');
      await beat(page, SMALL);
      await page.getByTestId('import-lgpd-file').setInputFiles({
        name: 'amostras-coorte-wave5.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      });
      await beat(page, MEDIUM);

      await page.getByTestId('import-lgpd-submit').click();

      // 3. The partial outcome, stated as counts rather than a verdict: two
      //    rows landed, one did not, and nothing was corrected for you.
      await expect(page.getByTestId('import-lgpd-counts')).toHaveText(
        '2 de 3 importadas · 1 rejeitadas',
        { timeout: 30_000 }
      );
      await beat(page, MEDIUM);

      await expect(page.getByTestId('import-lgpd-rejected-rows')).toContainText(badId);
      await beat(page, LARGE);

      // 4. The link that closes RNF011 AC#4's loop: the rejected row is
      //    somewhere, and the operator can go there.
      await expect(page.getByTestId('import-lgpd-quarantine-link')).toBeVisible();
      await beat(page, MEDIUM);
      await page.getByTestId('import-lgpd-quarantine-link').click();

      await expect(page).toHaveURL(/\/import\/quarantine\?batchId=/);
      batchId = new URL(page.url()).searchParams.get('batchId');
      await expect(page.getByRole('heading', { name: 'Quarentena de importação' })).toBeVisible();
      await beat(page, LARGE);

      // 5. The batch, with the uploaded file retained beside it (#792/#806)
      //    -- "retido" is the difference between a reviewable rejection and
      //    a silently dropped row.
      await expect(
        page.getByRole('cell', { name: 'amostras-coorte-wave5.csv' })
      ).toBeVisible({ timeout: 15_000 });
      // Scoped to this run's own row: the quarantine listing is cumulative,
      // and the mongodb-test-data volume carries earlier sessions' batches.
      await expect(
        page.getByRole('row', { name: /amostras-coorte-wave5/ })
      ).toContainText('retido');
      await beat(page, MEDIUM);

      // The batchId query param auto-opens the row detail -- no extra click.
      // It renders below the fold at this viewport, though, and toBeVisible()
      // does not scroll: without this the reel asserts a payoff the viewer
      // never sees.
      const rejectedRows = page.getByRole('heading', { name: /Linhas rejeitadas/ });
      await expect(rejectedRows).toBeVisible();
      await rejectedRows.scrollIntoViewIfNeeded();
      await beat(page, MEDIUM);
      await expect(page.getByText(/Linha 4/)).toBeVisible({ timeout: 15_000 });
      await beat(page, LARGE);
    } finally {
      // Same restore-what-the-reel-changed discipline as Waves 3 and 4: the
      // mongodb-test-data volume is persistent, so demo rows would otherwise
      // accumulate in the quarantine listing across every future session.
      if (client) {
        if (createdParticipantIds.length) {
          await db
            .collection('samples')
            .deleteMany({ participantId: { $in: createdParticipantIds } })
            .catch(() => {});
          await db
            .collection('patients')
            .deleteMany({ participantId: { $in: createdParticipantIds } })
            .catch(() => {});
          await db
            .collection('participantIdentities')
            .deleteMany({ participantId: { $in: createdParticipantIds } })
            .catch(() => {});
        }
        if (batchId) {
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

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
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
      },
    });
    expect([201, 202]).toContain(sample.status());
    const specimenId = (await sample.json()).data.specimenId as string;

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

  test.afterAll(async () => {
    await Promise.all(boxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
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
        },
      });
      expect([201, 202], await sample.text()).toContain(sample.status());
      const specimenId = (await sample.json()).data.specimenId as string;

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
