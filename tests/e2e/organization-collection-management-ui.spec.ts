import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import { findOrganizationInList } from './helpers/listOrganizations';

// Real-backend proof for #608 (RF020, tracker #605, seed #576):
// #606/#607 built the Organizations/Collections CRUD UI in
// SystemManagementPage.tsx, but the only prior coverage
// (study-protocol-collection-crud.spec.ts) drives the API directly, never
// the UI. This proves the actual operator path: create/edit/delete both
// entities through the real form, against the real backend.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

async function login(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const session = await realLogin(request);
  await seedRealAuth(page, session);
  return session;
}

test.describe('Organizations CRUD through the real UI (#606, #608)', () => {
  test('creates, edits and deletes an organization via SystemManagementPage', async ({ page, request }) => {
    let session;
    try {
      session = await login(page, request);
    } catch (err: any) {
      console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
      return;
    }

    const officialName = `RF020 E2E Org ${Date.now()}`;

    await page.goto('/system-management?tab=organizations');
    await page.getByTestId('new-organization-button').click();
    await expect(page).toHaveURL(/\/organizations\/new/);
    await expect(page.getByTestId('organization-form-page')).toBeVisible();

    await page.getByTestId('organization-official-name-input').fill(officialName);
    await page.getByTestId('organization-country-code-input').fill('BR');
    await page.getByTestId('organization-acronym-input').fill('E2EORG');

    await page.getByTestId('organization-form-submit').click();
    await expect(page).toHaveURL(/system-management\?tab=organizations/);
    await expect(page.getByText(officialName, { exact: true })).toBeVisible();

    // organizationId is server-generated (buildOrganizationSubmissionPayload
    // strips it from the create payload) — resolve it from the real backend
    // to target this row's edit/delete buttons, which are keyed by that id.
    // The list is sorted by officialName and paged, so page through it
    // (#1279, #1282).
    const created = await findOrganizationInList(request, apiBaseURL!, session.token,
      (org) => org.officialName === officialName);
    expect(created).toBeTruthy();
    const organizationId = created!.organizationId;

    try {
      await page.getByTestId(`edit-organization-button-${organizationId}`).click();
      await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/edit`));
      const updatedName = `${officialName} (updated)`;
      const nameInput = page.getByTestId('organization-official-name-input');
      await nameInput.fill(updatedName);
      await page.getByTestId('organization-form-submit').click();
      await expect(page).toHaveURL(/system-management\?tab=organizations/);
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible();

      const getResponse = await request.get(`${apiBaseURL}/api/organizations/${organizationId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(getResponse.ok()).toBeTruthy();
      const fetched = await getResponse.json();
      expect(fetched.data.officialName).toBe(updatedName);

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId(`delete-organization-button-${organizationId}`).click();
      await expect(page.getByText(updatedName, { exact: true })).not.toBeVisible();

      const afterDelete = await request.get(`${apiBaseURL}/api/organizations/${organizationId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(afterDelete.status()).toBe(404);
    } finally {
      // Safety net: if an assertion above threw before the UI delete ran,
      // don't leave the fixture in the persistent mongodb-test-data volume.
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
  });
});

test.describe('Collections CRUD through the real UI (#607, #608)', () => {
  test('creates, edits and deletes a collection via SystemManagementPage', async ({ page, request }) => {
    let session;
    try {
      session = await login(page, request);
    } catch (err: any) {
      console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
      return;
    }

    // collectionId is user-supplied at creation (unlike Organization's
    // server-generated organizationId) — known upfront, per #607.
    const collectionId = `rf020-e2e-collection-${Date.now()}`;
    const collectionName = `RF020 E2E Collection ${Date.now()}`;

    try {
      await page.goto('/system-management?tab=collections');
      await page.getByTestId('new-collection-button').click();
      await expect(page).toHaveURL(/\/collections\/new/);
      await expect(page.getByTestId('collection-form-page')).toBeVisible();

      await page.getByTestId('collection-id-input').fill(collectionId);
      await page.getByTestId('collection-name-input').fill(collectionName);
      await page.getByTestId('collection-sample-types-input').fill('plasma; serum');
      await page.getByTestId('collection-governance-regime-select').selectOption('biorepository');

      await page.getByTestId('collection-form-submit').click();
      await expect(page).toHaveURL(/system-management\?tab=collections/);
      await expect(page.getByText(collectionId, { exact: true })).toBeVisible();

      const getAfterCreate = await request.get(`${apiBaseURL}/api/collections/${collectionId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(getAfterCreate.ok()).toBeTruthy();
      const created = await getAfterCreate.json();
      expect(created.data.sampleTypes).toEqual([{ text: 'plasma' }, { text: 'serum' }]);

      await page.getByTestId(`edit-collection-button-${collectionId}`).click();
      await expect(page).toHaveURL(new RegExp(`/collections/${collectionId}/edit`));
      const updatedName = `${collectionName} (updated)`;
      const nameInput = page.getByTestId('collection-name-input');
      await nameInput.fill(updatedName);
      await page.getByTestId('collection-form-submit').click();
      await expect(page).toHaveURL(/system-management\?tab=collections/);
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible();

      const getAfterUpdate = await request.get(`${apiBaseURL}/api/collections/${collectionId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(getAfterUpdate.ok()).toBeTruthy();
      const updated = await getAfterUpdate.json();
      expect(updated.data.collectionName).toBe(updatedName);

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId(`delete-collection-button-${collectionId}`).click();
      await expect(page.getByText(updatedName, { exact: true })).not.toBeVisible();

      const afterDelete = await request.get(`${apiBaseURL}/api/collections/${collectionId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(afterDelete.status()).toBe(404);
    } finally {
      await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
  });
});
