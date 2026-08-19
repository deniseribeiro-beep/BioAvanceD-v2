import { test, expect, type Page } from '@playwright/test';
import { realLogin } from '../e2e/helpers/realAuth';

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
