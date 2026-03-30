
const { test, expect } = require('@playwright/test');

test('cadastro de amostra pelo inventário', async ({ page }) => {
  await page.addInitScript(() => {
    const jwtLikeToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6MSwidXNlcm5hbWUiOiJxYS11c2VyIiwiYWNjZXNzVHlwIjoiMn0.';
    localStorage.setItem('token', jwtLikeToken);
    localStorage.setItem('api_port', '3000');
  });

  await page.route('**/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          valid: true,
          user: {
            id: 1,
            userID: 'qa-user',
            name: 'QA User',
            username: 'qa-user',
            accessType: 2,
            roleName: 'Técnico',
          },
        },
      }),
    });
  });

  // Mock para samples POST
  await page.route('**/api/samples', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sampleID: '507f1f77bcf86cd799439011',
            patientID: '12345678',
            operationMode: 'STRICT',
            topology: {
              synced: true,
              fallbackQueued: false,
            },
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  // Mock para locations
  await page.route('**/api/locations*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
});
