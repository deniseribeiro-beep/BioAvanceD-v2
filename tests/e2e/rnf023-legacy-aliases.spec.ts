import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin } from './helpers/realAuth';

// RNF023 C4 (#1573): a v2.0.0 contract refuses a legacy alias. The intake
// wizard and the sample create each carry their own alias list, and each
// refuses an alias with 422 NON_CANONICAL_FIELD before any write. The alias
// check runs before any collection or participant check, so neither case
// seeds a collection.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

let mongoClient: MongoClient;

test.beforeAll(async () => {
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
});

test.afterAll(async () => {
  await mongoClient?.close();
});

test.describe('RNF023 C4: the v2.0.0 contracts refuse legacy aliases (#1573) — real backend', () => {
  test('POST /api/intake-wizard refuses patientID and sampleID with 422 NON_CANONICAL_FIELD and writes no sample', async ({ request }) => {
    // RNF023 C4: the intake wizard rejects a legacy alias in a new contract.
    const session = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const linkedProject = `E2E-1573-${suffix}`;

    const response = await request.post(`${apiBaseURL}/api/intake-wizard`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: {
        participant: { patientID: '15730001', patientName: `#1573 e2e patient ${suffix}`, birthDate: '1990-01-01' },
        consent: {},
        specimen: {
          sampleID: `E2E-1573-${suffix}`,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 1,
          linkedProject,
        },
        clinical: {},
        biomarkers: [],
      },
    });

    expect(response.status()).toBe(422);
    expect(await response.json()).toEqual({
      error: 'NON_CANONICAL_FIELD',
      fields: ['patientID', 'sampleID'],
      details: ['patientID: campo não canônico', 'sampleID: campo não canônico'],
    });
    expect(await mongoClient.db(mongoDbName).collection('samples').countDocuments({ linkedProject })).toBe(0);
  });

  test('POST /api/samples refuses patientID and sampleID with 422 NON_CANONICAL_FIELD and writes no sample', async ({ request }) => {
    // RNF023 C4: the sample create rejects a legacy alias in a new contract.
    const session = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const linkedProject = `E2E-1573-${suffix}-b`;

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: {
        patientID: '15730002',
        sampleID: `E2E-1573-${suffix}-b`,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 1,
        linkedProject,
      },
    });

    expect(response.status()).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      error: 'NON_CANONICAL_FIELD',
      fields: ['patientID', 'sampleID'],
      details: ['patientID: campo não canônico', 'sampleID: campo não canônico'],
    });
    expect(await mongoClient.db(mongoDbName).collection('samples').countDocuments({ linkedProject })).toBe(0);
  });
});
