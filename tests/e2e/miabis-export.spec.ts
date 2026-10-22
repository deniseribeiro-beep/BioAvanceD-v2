import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';

// RF020 AC5-AC8 (#1322), MAP-V2-010/011: GET /api/biobanks/miabis/export
// against the real backend. A biobank and a collection entered through their
// own routes come back as MIABIS records, the collection's governanceRegime
// as a national extension, and the biobank's status in the round-trip loss
// report.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const organizationIds: string[] = [];

test.afterAll(async ({ request }) => {
  await deleteOrganizations(request, apiBaseURL!, organizationIds);
});

test('exports a stored biobank and collection by the MIABIS mapping, with the national extension and the round-trip loss', async ({ request }) => {
  const session = await realLogin(request);
  const headers = { Authorization: `Bearer ${session.token}` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const biobankId = `miabis-export-bb-${stamp}`;
  const collectionId = `miabis-export-col-${stamp}`;

  try {
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `MIABIS Export ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const biobank = await request.post(`${apiBaseURL}/api/biobanks`, {
      headers,
      data: {
        biobankId,
        biobankName: `Biobanco ${stamp}`,
        biobankDescription: 'Biobanco do teste de exportação MIABIS',
        legalEntityId: organizationId,
        biobankStatus: 'active',
        countryCode: 'BR',
        contactInformation: { email: 'contato@example.org' },
      },
    });
    expect(biobank.ok(), await biobank.text()).toBeTruthy();

    const collection = await request.post(`${apiBaseURL}/api/collections`, {
      headers,
      data: { collectionId, collectionName: `Coleção ${stamp}`, governanceRegime: 'biorepository' },
    });
    expect(collection.ok(), await collection.text()).toBeTruthy();

    const res = await request.get(`${apiBaseURL}/api/biobanks/miabis/export`, { headers });
    expect(res.ok(), await res.text()).toBeTruthy();
    const data = (await res.json()).data;

    const biobankRecord = data.biobanks.find((record: { miabis: { id: string } }) => record.miabis.id === biobankId);
    expect(biobankRecord, `biobank ${biobankId} in the export`).toBeTruthy();
    expect(biobankRecord.miabis).toMatchObject({
      id: biobankId,
      name: `Biobanco ${stamp}`,
      juristicPerson: organizationId,
      country: 'BR',
    });

    const collectionRecord = data.collections.find((record: { miabis: { id: string } }) => record.miabis.id === collectionId);
    expect(collectionRecord, `collection ${collectionId} in the export`).toBeTruthy();
    expect(collectionRecord.nationalExtensions.governanceRegime).toBe('biorepository');

    expect(data.roundTripLoss.dropped).toContainEqual({ entity: 'Biobank', id: biobankId, field: 'biobankStatus' });
    expect(data.conformanceClaimed).toBe(false);
  } finally {
    await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, { headers }).catch(() => {});
    await request.delete(`${apiBaseURL}/api/biobanks/${biobankId}`, { headers }).catch(() => {});
  }
});
