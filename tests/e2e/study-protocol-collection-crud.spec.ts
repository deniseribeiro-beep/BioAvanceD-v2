import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

// Real backend only — see specimen-quality-inventory.spec.ts for the same
// skip rationale. Run via `npm run test:e2e:docker` against the compose
// test stack (or a locally running backend), never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #320: Study/Protocol/Collection previously had no CRUD API — the only
// way any of the three got into Mongo was seedParticipant.ts's test
// fixtures inserting directly. These specs prove the /api/studies,
// /api/protocols and /api/collections routes exist and round-trip a
// real document through the real backend.
const entities = [
  { path: 'studies', singular: 'study', idField: 'studyId', nameField: 'studyTitle' },
  { path: 'protocols', singular: 'protocol', idField: 'protocolId', nameField: 'protocolName' },
  { path: 'collections', singular: 'collection', idField: 'collectionId', nameField: 'collectionName' },
];

for (const { path, singular, idField, nameField } of entities) {
  test.describe(`${path} CRUD (#320)`, () => {
    test(`creates, lists, fetches and updates a ${singular}`, async ({ request }) => {
      const admin = await realLogin(request);
      const id = `${path}-${Date.now()}`;

      const createResponse = await request.post(`${apiBaseURL}/api/${path}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { [idField]: id, [nameField]: `e2e ${path} ${id}` },
      });
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      expect(created.data[idField]).toBe(id);

      const listResponse = await request.get(`${apiBaseURL}/api/${path}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(listResponse.status()).toBe(200);
      const list = await listResponse.json();
      expect(list.data.some((item: Record<string, unknown>) => item[idField] === id)).toBe(true);

      const getResponse = await request.get(`${apiBaseURL}/api/${path}/${id}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(getResponse.status()).toBe(200);
      const fetched = await getResponse.json();
      expect(fetched.data[idField]).toBe(id);

      const updateResponse = await request.put(`${apiBaseURL}/api/${path}/${id}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { [nameField]: `updated ${id}` },
      });
      expect(updateResponse.status()).toBe(200);
      const updated = await updateResponse.json();
      expect(updated.data[nameField]).toBe(`updated ${id}`);
    });

    test(`rejects creating a ${singular} missing its required ${nameField}`, async ({ request }) => {
      const admin = await realLogin(request);

      const response = await request.post(`${apiBaseURL}/api/${path}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { [idField]: `${path}-${Date.now()}-invalid` },
      });

      expect(response.status()).toBe(422);
    });

    test(`404s fetching a nonexistent ${singular}`, async ({ request }) => {
      const admin = await realLogin(request);

      const response = await request.get(`${apiBaseURL}/api/${path}/does-not-exist`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });

      expect(response.status()).toBe(404);
    });
  });
}

// #325 (RF020, narrowed — see issue comment: full MIABIS-institutional
// scope split out to #576 since organization.routes.js has no PUT/DELETE
// and Collection is Fase-1-only). Covers the organization operations that
// actually exist today: create + list via /api/organizations.
test.describe('organizations create+list (#325)', () => {
  test('creates and lists an organization, and records it on the audit trail', async ({ request }) => {
    const admin = await realLogin(request);
    const officialName = `e2e org ${Date.now()}`;

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const createResponse = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName, countryCode: 'BR', organizationType: 'biobank' },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.data.officialName).toBe(officialName);

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    const listResponse = await request.get(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    expect(list.data.some((item: Record<string, unknown>) => item.officialName === officialName)).toBe(true);
  });

  test('rejects creating an organization missing its required countryCode', async ({ request }) => {
    const admin = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `e2e org invalid ${Date.now()}` },
    });

    expect(response.status()).toBe(400);
  });
});
