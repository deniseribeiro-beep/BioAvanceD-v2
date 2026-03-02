const { test, expect } = require('@playwright/test');

test.describe('RF001 - Fluxo de autenticação', () => {
  const roleScenarios = [
    {
      roleName: 'Administrador',
      accessType: 4,
      username: 'admin.qa',
      expectedRoute: '/system-management',
    },
    {
      roleName: 'Coordenador',
      accessType: 3,
      username: 'coord.qa',
      expectedRoute: '/reports',
    },
    {
      roleName: 'Técnico',
      accessType: 2,
      username: 'tecnico.qa',
      expectedRoute: '/dashboard',
    },
    {
      roleName: 'Usuário Externo',
      accessType: 1,
      username: 'externo.qa',
      expectedRoute: '/assistant',
    },
  ];

  const mockVerify = async (page, user) => {
    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            valid: true,
            user,
          },
        }),
      });
    });
  };

  test('exibe erro com credenciais inválidas', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Credenciais inválidas',
          message: 'Credenciais inválidas',
        }),
      });
    });

    await page.goto('/login');

    await page.locator('input[type="text"]').first().fill('usuario.invalido');
    await page.locator('input[type="password"]').first().fill('SenhaErrada@123');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.error-message')).toContainText(/Credenciais inválidas/i);
  });

  test.describe('credenciais válidas redirecionam conforme role', () => {
    roleScenarios.forEach(({ roleName, accessType, username, expectedRoute }) => {
      test(`login sem MFA (${roleName}) redireciona para ${expectedRoute}`, async ({ page }) => {
        const user = {
          userID: `qa-${accessType}-1`,
          name: `QA ${roleName}`,
          email: `${username}@example.com`,
          username,
          accessType,
          roleName,
        };

        await page.route('**/api/auth/login', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                token: 'header.payload.signature',
                user,
              },
            }),
          });
        });

        await mockVerify(page, user);

        await page.goto('/login');
        await page.locator('input[type="text"]').first().fill(username);
        await page.locator('input[type="password"]').first().fill('SenhaForte@123');
        await page.locator('button[type="submit"]').click();

        await expect(page).toHaveURL(new RegExp(`${expectedRoute}$`));
        await expect(page.locator('.sidebar-nav')).toBeVisible();
        await expect(page.locator(`a.sidebar-link.active[href="${expectedRoute}"]`)).toBeVisible();
      });
    });
  });

  test.describe('MFA mockado redireciona conforme role', () => {
    roleScenarios.forEach(({ roleName, accessType, username, expectedRoute }) => {
      test(`login com MFA (${roleName}) redireciona para ${expectedRoute}`, async ({ page }) => {
        const user = {
          userID: `qa-${accessType}-mfa-1`,
          name: `QA ${roleName}`,
          email: `${username}.mfa@example.com`,
          username,
          accessType,
          roleName,
        };

        await page.route('**/api/auth/login', async (route) => {
          const requestBody = route.request().postDataJSON() || {};
          const hasTwoFactorCode = typeof requestBody.twoFactorCode === 'string' && requestBody.twoFactorCode.length > 0;

          if (!hasTwoFactorCode) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                requiresTwoFactor: true,
              }),
            });
            return;
          }

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                token: 'header.payload.signature',
                user,
              },
            }),
          });
        });

        await mockVerify(page, user);

        await page.goto('/login');
        await page.locator('input[type="text"]').first().fill(username);
        await page.locator('input[type="password"]').first().fill('SenhaForte@123');
        await page.locator('button[type="submit"]').click();

        await expect(page.locator('.two-factor-section')).toBeVisible();
        await page.locator('.two-factor-section input[type="text"]').fill('123456');
        await page.locator('button[type="submit"]').click();

        await expect(page).toHaveURL(new RegExp(`${expectedRoute}$`));
        await expect(page.locator('.sidebar-nav')).toBeVisible();
        await expect(page.locator(`a.sidebar-link.active[href="${expectedRoute}"]`)).toBeVisible();
      });
    });
  });
});
