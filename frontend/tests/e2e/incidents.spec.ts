import { test, expect, type Page, type Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function setupIncidentsPage(page: Page) {
  const auth = createAdminAuthContext();
  await injectSessionToken(page, auth.token);

  let incidentState = {
    _id: '507f1f77bcf86cd799439013',
    sensorKey: 'sensor-freezer-01',
    sensorName: 'Sensor Freezer 01',
    openedAt: '2026-04-10T10:00:00.000Z',
    closedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    currentTemperature: -2.5,
    maxTemperature: -2.0,
    minTemperature: -8.0,
    samplesOutOfRange: 4,
    status: 'open',
    notes: [],
    escalationLevel: 0,
    lastEscalatedAt: null,
  } as any;

  await page.route('http://localhost:3000/api/**', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/api/auth/verify') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: auth.user, valid: true } }),
      });
      return;
    }

    if (url.includes('/api/auth/login') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { token: auth.token, user: auth.user } }),
      });
      return;
    }

    if (url.includes('/api/auth/keepalive') && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
      return;
    }

    if (/\/api\/incidents(?:\?.*)?$/.test(url) && method === 'GET') {
      const parsed = new URL(url);
      const status = parsed.searchParams.get('status');
      const incidents = status && status !== 'all'
        ? (incidentState.status === status ? [incidentState] : [])
        : [incidentState];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, incidents, total: incidents.length, limit: 100, skip: 0 }),
      });
      return;
    }

    if (/\/api\/incidents\/507f1f77bcf86cd799439013\/acknowledge(?:\?.*)?$/.test(url) && method === 'PUT') {
      incidentState = {
        ...incidentState,
        status: 'acknowledged',
        acknowledgedAt: '2026-04-10T10:05:00.000Z',
        acknowledgedBy: auth.user.id,
        notes: [...incidentState.notes, { action: 'acknowledged', message: 'Incidente reconhecido', timestamp: '2026-04-10T10:05:00.000Z', userId: auth.user.id }],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Incidente reconhecido' }) });
      return;
    }

    if (/\/api\/incidents\/507f1f77bcf86cd799439013\/resolve(?:\?.*)?$/.test(url) && method === 'PUT') {
      incidentState = {
        ...incidentState,
        status: 'resolved',
        closedAt: '2026-04-10T10:10:00.000Z',
        notes: [...incidentState.notes, { action: 'resolved', message: 'Incidente resolvido', timestamp: '2026-04-10T10:10:00.000Z', userId: auth.user.id }],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Incidente resolvido' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });

  await page.goto('/facility-management?tab=incidents');
  await expect(page.getByTestId('facility-tab-incidents')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('incident-row-507f1f77bcf86cd799439013')).toBeVisible();
}

test.describe('Facility Incidents - Critical flow', () => {
  test('carrega lista de incidentes e aplica filtro de status', async ({ page }) => {
    await setupIncidentsPage(page);

    await expect(page.getByTestId('incidents-refresh-button')).toBeVisible();
    await expect(page.getByTestId('incident-row-507f1f77bcf86cd799439013')).toBeVisible();

    await page.getByTestId('incidents-status-filter').selectOption('resolved');
    await expect(page.locator('[data-testid="incident-row-507f1f77bcf86cd799439013"]')).toHaveCount(0);

    await page.getByTestId('incidents-status-filter').selectOption('open');
    await expect(page.getByTestId('incident-row-507f1f77bcf86cd799439013')).toBeVisible();
  });
});
