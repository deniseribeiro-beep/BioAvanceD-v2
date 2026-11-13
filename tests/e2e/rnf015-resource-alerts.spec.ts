import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';

// Real-backend proof for #1468, RNF015 C2: the platform alert check reads the
// backend's memory and disk in use and reports both as evaluated rows.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

const RESOURCE_KEYS = ['RESOURCE_MEMORY:backend', 'RESOURCE_DISK:backend'] as const;

interface AlertRow {
  key: string;
  state: string;
  value: unknown;
}

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RNF015 C2 resource alerts — real backend', () => {
  test('the platform alert check evaluates memory and disk in use', async ({ request }) => {
    test.setTimeout(90_000);
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    let results: AlertRow[] = [];
    await expect.poll(async () => {
      const res = await request.get(`${apiBaseURL}/api/monitoring/alerts`, { headers: auth });
      expect(res.status(), await res.text()).toBe(200);
      results = ((await res.json()).data?.results ?? []) as AlertRow[];
      return RESOURCE_KEYS.filter((key) => results.some((row) => row.key === key));
    }, { timeout: 60_000, intervals: [2_000] }).toEqual([...RESOURCE_KEYS]);

    for (const key of RESOURCE_KEYS) {
      const row = results.find((entry) => entry.key === key)!;
      expect(['ok', 'firing'], key).toContain(row.state);
      expect(typeof row.value, key).toBe('number');
      expect(row.value as number, key).toBeGreaterThanOrEqual(0);
      expect(row.value as number, key).toBeLessThanOrEqual(1);
    }
  });
});
