import { APIRequestContext, expect } from '@playwright/test';
import { realLogin } from './realAuth';

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

/**
 * #1282: finds an organization in GET /api/organizations by paging through
 * it, so a spec asserting "the list contains my fixture" holds however many
 * organizations the persistent test volume has collected. The route sorts by
 * officialName and returns at most 500 rows a page (#1279, #1280).
 */
export async function findOrganizationInList(
  request: APIRequestContext,
  apiBaseURL: string,
  token: string,
  matches: (organization: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown> | undefined> {
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request.get(`${apiBaseURL}/api/organizations?limit=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const items = ((await response.json()).data ?? []) as Record<string, unknown>[];
    const found = items.find(matches);
    if (found) return found;
    if (items.length < PAGE_SIZE) return undefined;
  }
  return undefined;
}

/**
 * #1282: deletes the organizations a spec created, so the persistent test
 * volume stops collecting them. Call it from the spec's afterAll, after the
 * spec's own cleanup of the records that reference them (storage trees,
 * equipment). Best effort, like the other afterAll cleanups: a failed delete
 * never fails the run. DELETE /api/organizations/:id checks no references, so
 * users, samples and assays the spec leaves behind keep the id.
 */
export async function deleteOrganizations(
  request: APIRequestContext,
  apiBaseURL: string,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  const admin = await realLogin(request).catch(() => null);
  if (!admin) return;
  await Promise.all(
    organizationIds.map((id) =>
      request.delete(`${apiBaseURL}/api/organizations/${id}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }).catch(() => {})
    )
  );
}
