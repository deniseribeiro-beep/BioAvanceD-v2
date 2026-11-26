import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';

// #1464 (RF003 AC3: the role is assigned as chosen): the new-user form opens
// on Técnico. Before the fix its untouched default sent access type 1, so
// POST /api/users/register granted external_user and GET /api/users read the
// account back as Usuário Externo while the form had said Técnico. An
// administrator here leaves the role select alone, submits, and reads the
// account back as Técnico from the API and from the users table.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.describe('New user form default role (#1464) -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test('the untouched default role registers a Técnico and reads back as Técnico (#1464, RF003 AC3)', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const username = `tec.1464.${stamp}`;

    await page.goto('/users/new');
    await expect(page.getByTestId('new-user-form')).toBeVisible();
    await page.getByTestId('new-user-name-input').fill(`#1464 default ${stamp}`);
    await page.getByTestId('new-user-email-input').fill(`${username}@example.com`);
    await page.getByTestId('new-user-username-input').fill(username);
    await page.getByTestId('new-user-password-input').fill('Tecnico@12345-forte');
    // The role select is left as the form opens it.
    await expect(page.getByTestId('new-user-role-select')).toHaveValue('Técnico');

    const created = page.waitForResponse(
      (response) => response.url().includes('/api/users/register') && response.request().method() === 'POST'
    );
    await page.getByTestId('new-user-submit-button').click();
    const createdResponse = await created;
    expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
    expect(createdResponse.request().postDataJSON(), 'the default sends the Técnico access type').toMatchObject({
      roleName: 'Técnico',
      accessType: 2,
    });
    const createdBody = await createdResponse.json();
    const userID = String(createdBody.data?._id || createdBody.data?.id || '');
    expect(userID, 'the register response names the new user').toBeTruthy();

    const list = await request.get(`${apiBaseURL}/api/users`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(list.ok(), await list.text()).toBeTruthy();
    const row = ((await list.json()).data as Array<Record<string, unknown>>).find(
      (user) => String(user._id || user.id) === userID
    );
    expect(row, 'GET /api/users lists the new user').toBeTruthy();
    expect(row!.roleName, 'the account reads back as the role the form showed').toBe('Técnico');

    await expect(page).toHaveURL(/system-management/);
    const tableRow = page.locator('tr', { has: page.getByTestId(`edit-user-button-${userID}`) });
    await expect(tableRow.locator('.role-badge').first()).toContainText('Técnico');
  });
});
