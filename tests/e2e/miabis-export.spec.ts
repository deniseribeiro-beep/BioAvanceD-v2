import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';

// RF020 AC5-AC8 (#1322), MAP-V2-010/011: GET /api/biobanks/miabis/export
// against the real backend. A biobank and a collection entered through their
// own routes come back as MIABIS records, the collection's governanceRegime
// as a national extension, and the biobank's status in the round-trip loss
// report. #1482 adds RF020 AC1 (a Network registered under a stored
// Organization), AC4 (an edit that converts a collection's regime is
// refused) and AC5 (the export carries only the MAP-V2-010/011 elements).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// RF020 AC5: the MIABIS elements of MAP-V2-010 and MAP-V2-011, as
// miabisExport.service.js's BIOBANK_MAPPING and COLLECTION_MAPPING name them.
// A stored record carries every one of them (null when empty) and no other.
const BIOBANK_ELEMENTS = [
  'id', 'acronym', 'name', 'description', 'url', 'juristicPerson', 'country',
  'contactInformation', 'infrastructuralCapabilities', 'organisationalCapabilities',
  'bioprocessingAndAnalyticalCapabilities', 'qualityManagementStandards',
];
const COLLECTION_ELEMENTS = [
  'id', 'acronym', 'name', 'description', 'url', 'contactInformation',
  'materialTypes', 'dataCategories', 'diseases', 'inclusionCriteria',
  'exclusionCriteria', 'useAndAccessConditions', 'storageTemperatures', 'sex',
  'ageLow', 'ageHigh', 'numberOfSubjects', 'publications', 'sampleSource',
  'ageLowUnit', 'ageHighUnit', 'sampleCollectionSettings', 'collectionDesigns',
  'inclusionCriteriaDescription', 'duoCodes', 'accessConditionsText',
];

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

// RF020 AC5: the export uses only the MAP-V2-010/011 mapping. It names those
// two rows and no release, claims no conformance, emits only Biobank and
// Collection (no Network, which no MAP row maps), and each record carries
// exactly the mapped elements; a canonical field outside them is not in the
// MIABIS record but in the round-trip loss report.
test('exports only by the MAP-V2-010/011 mapping: its elements, no release, no conformance claim, no unmapped entity', async ({ request }) => {
  const session = await realLogin(request);
  const headers = { Authorization: `Bearer ${session.token}` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const biobankId = `miabis-mapping-bb-${stamp}`;
  const collectionId = `miabis-mapping-col-${stamp}`;

  try {
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `MIABIS Mapping ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const biobank = await request.post(`${apiBaseURL}/api/biobanks`, {
      headers,
      data: {
        biobankId,
        biobankName: `Biobanco ${stamp}`,
        biobankDescription: 'Biobanco do teste do mapping MIABIS',
        legalEntityId: organizationId,
        biobankStatus: 'active',
        countryCode: 'BR',
        contactInformation: { email: 'contato@example.org' },
      },
    });
    expect(biobank.ok(), await biobank.text()).toBeTruthy();

    const collection = await request.post(`${apiBaseURL}/api/collections`, {
      headers,
      data: { collectionId, collectionName: `Coleção ${stamp}`, governanceRegime: 'biobank' },
    });
    expect(collection.ok(), await collection.text()).toBeTruthy();

    const res = await request.get(`${apiBaseURL}/api/biobanks/miabis/export`, { headers });
    expect(res.ok(), await res.text()).toBeTruthy();
    const data = (await res.json()).data;

    expect(Object.keys(data).sort()).toEqual([
      'biobanks', 'collections', 'conformanceClaimed', 'generatedAt', 'mappingReleaseId',
      'mappings', 'roundTripLoss', 'standard', 'standardVersion',
    ]);
    expect(data.standard).toBe('MIABIS');
    expect(data.standardVersion).toBe('3.0');
    expect(data.mappings).toEqual([
      { mappingId: 'MAP-V2-010', canonicalEntity: 'Biobank', target: 'Biobank', relationship: 'partial', status: 'prepared Phase 1' },
      { mappingId: 'MAP-V2-011', canonicalEntity: 'Collection', target: 'Collection', relationship: 'partial', status: 'prepared Phase 1' },
    ]);
    expect(data.mappingReleaseId).toBeNull();
    expect(data.conformanceClaimed).toBe(false);

    const biobankRecord = data.biobanks.find((record: { miabis: { id: string } }) => record.miabis.id === biobankId);
    expect(biobankRecord, `biobank ${biobankId} in the export`).toBeTruthy();
    expect(Object.keys(biobankRecord.miabis).sort()).toEqual([...BIOBANK_ELEMENTS].sort());
    expect(biobankRecord.nationalExtensions).toEqual({});

    const collectionRecord = data.collections.find((record: { miabis: { id: string } }) => record.miabis.id === collectionId);
    expect(collectionRecord, `collection ${collectionId} in the export`).toBeTruthy();
    expect(Object.keys(collectionRecord.miabis).sort()).toEqual([...COLLECTION_ELEMENTS].sort());
    expect(collectionRecord.nationalExtensions).toEqual({ governanceRegime: 'biobank' });

    expect(data.roundTripLoss.dropped).toContainEqual({ entity: 'Biobank', id: biobankId, field: 'biobankStatus' });
  } finally {
    await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, { headers }).catch(() => {});
    await request.delete(`${apiBaseURL}/api/biobanks/${biobankId}`, { headers }).catch(() => {});
  }
});

// RF020 AC4: no silent conversion. An edit naming another governanceRegime
// is refused, and the stored and exported regime stay as they were; the
// governed conversion through a governance event is proven in
// specimen-quality-inventory.spec.ts.
test('refuses an edit that converts a collection\'s regime, and the export keeps the stored regime', async ({ request }) => {
  const session = await realLogin(request);
  const headers = { Authorization: `Bearer ${session.token}` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const collectionId = `miabis-regime-col-${stamp}`;

  try {
    const collection = await request.post(`${apiBaseURL}/api/collections`, {
      headers,
      data: { collectionId, collectionName: `Coleção ${stamp}`, governanceRegime: 'biorepository' },
    });
    expect(collection.ok(), await collection.text()).toBeTruthy();

    const edit = await request.put(`${apiBaseURL}/api/collections/${collectionId}`, {
      headers,
      data: { governanceRegime: 'biobank' },
    });
    expect(edit.status(), await edit.text()).toBe(422);
    expect(await edit.json()).toMatchObject({
      success: false,
      error: 'Campo imutável',
      details: ['governanceRegime não pode ser alterado por edição'],
    });

    const stored = await request.get(`${apiBaseURL}/api/collections/${collectionId}`, { headers });
    expect(stored.ok(), await stored.text()).toBeTruthy();
    expect((await stored.json()).data.governanceRegime).toBe('biorepository');

    const res = await request.get(`${apiBaseURL}/api/biobanks/miabis/export`, { headers });
    expect(res.ok(), await res.text()).toBeTruthy();
    const collectionRecord = (await res.json()).data.collections
      .find((record: { miabis: { id: string } }) => record.miabis.id === collectionId);
    expect(collectionRecord, `collection ${collectionId} in the export`).toBeTruthy();
    expect(collectionRecord.nationalExtensions.governanceRegime).toBe('biorepository');
  } finally {
    await request.delete(`${apiBaseURL}/api/collections/${collectionId}`, { headers }).catch(() => {});
  }
});

// RF020 AC1: a Network is registered with its metadata under a stored
// Organization (juristicPerson, P1X-0005) and read back; a juristicPerson that
// names no stored Organization is refused.
test('registers a network with its metadata under a stored organization, and refuses an unknown juristic person', async ({ request }) => {
  const session = await realLogin(request);
  const headers = { Authorization: `Bearer ${session.token}` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const networkId = `miabis-network-${stamp}`;
  const missingNetworkId = `miabis-network-missing-${stamp}`;

  try {
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `MIABIS Network ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const metadata = {
      acronym: `RB-${stamp}`,
      name: `Rede de Biobancos ${stamp}`,
      description: 'Rede do teste de metadados institucionais',
      url: 'https://rede.example.org',
      countryCodes: ['BR'],
      contactInformation: { email: 'rede@example.org' },
      networkStatus: 'active',
      commonCollaborationTopics: ['data-sharing'],
      networkType: 'research',
    };

    const created = await request.post(`${apiBaseURL}/api/networks`, {
      headers,
      data: { networkId, juristicPerson: organizationId, ...metadata },
    });
    expect(created.status(), await created.text()).toBe(201);

    const read = await request.get(`${apiBaseURL}/api/networks/${networkId}`, { headers });
    expect(read.ok(), await read.text()).toBeTruthy();
    expect((await read.json()).data).toMatchObject({ networkId, juristicPerson: organizationId, ...metadata });

    const missing = `org-missing-${stamp}`;
    const refused = await request.post(`${apiBaseURL}/api/networks`, {
      headers,
      data: { networkId: missingNetworkId, juristicPerson: missing, ...metadata },
    });
    expect(refused.status(), await refused.text()).toBe(404);
    expect((await refused.json()).message).toBe(`juristicPerson ${missing} não encontrado`);

    const absent = await request.get(`${apiBaseURL}/api/networks/${missingNetworkId}`, { headers });
    expect(absent.status()).toBe(404);
  } finally {
    await request.delete(`${apiBaseURL}/api/networks/${networkId}`, { headers }).catch(() => {});
    await request.delete(`${apiBaseURL}/api/networks/${missingNetworkId}`, { headers }).catch(() => {});
  }
});
