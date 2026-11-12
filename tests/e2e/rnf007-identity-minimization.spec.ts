import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';

// #1459: real-backend proof of identity segregation and minimization.
// RNF007 AC2 -- only an authorized caller resolves a participant's civil
// identity, only for a stated purpose, and each resolution is audited.
// RNF007 AC4 -- the system-generated label and code carry no name, birth
// date or other civil data. RNF022 AC6 -- labels and report exports carry
// only the pseudonymous participantId, never civil identity.
//
// Real backend only -- see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// The civil identity createRealParticipant writes: its patientName starts
// with NAME_MARKER and its birthDate is BIRTH_DATE.
const NAME_MARKER = 'RF004 e2e participant';
const BIRTH_DATE = '1990-01-01';

// The audit row has no read API keyed by resourceId, so it is read from
// the test stack's Mongo directly, as queryFhirImport.ts does.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function findReidentifyAuditRows(participantId: string) {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
  }
  return client
    .db(mongoDbName)
    .collection('logs')
    .find({
      action: 'REIDENTIFY',
      resourceType: 'ParticipantIdentity',
      resourceId: participantId,
      status: 'success',
    })
    .toArray();
}

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RNF007 e2e fixture project',
    registeredAt: new Date().toISOString(),
  };
}

const seededStorageBoxes: SeededStorageBox[] = [];

async function createSampleForNewParticipant(
  request: any,
  token: string
): Promise<{ specimenId: string; participantId: string }> {
  const participant = await createRealParticipant(request, apiBaseURL!, token);
  const seededStorageBox = await seedStorageBoxLocation();
  seededStorageBoxes.push(seededStorageBox);
  const { boxId, positionCode } = seededStorageBox;

  const create = await request.post(`${apiBaseURL}/api/samples`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      participantId: participant.participantId,
      ...validSampleFields(),
      boxId,
      positionCode,
    },
  });
  expect([201, 202]).toContain(create.status());
  return { specimenId: (await create.json()).data.specimenId, participantId: participant.participantId };
}

test.afterAll(async () => {
  await Promise.all(
    seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
  );
  if (client) {
    await client.close();
    client = null;
  }
  await closeSeedDb();
});

test.describe('RNF007 / RNF022 identity segregation and minimization — real backend', () => {
  test('only an authorized caller re-identifies a participant, for a stated purpose, and each resolution is audited (RNF007 AC2)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealParticipant(request, apiBaseURL!, admin.token);
    const reidentifyUrl = `${apiBaseURL}/api/patients/${participantId}/reidentify`;

    // No stated purpose, no resolution.
    const noReason = await request.post(reidentifyUrl, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(noReason.status(), await noReason.text()).toBe(400);

    const resolved = await request.post(reidentifyUrl, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { reason: 'RNF007 AC2 e2e: confirm identity resolution' },
    });
    expect(resolved.status(), await resolved.text()).toBe(200);
    const resolvedBody = await resolved.json();
    expect(resolvedBody.data.participantId).toBe(participantId);
    expect(resolvedBody.data.patientName).toContain(NAME_MARKER);

    // The resolution is on the audit trail, and the audit row itself
    // records the purpose without the identity it resolved.
    await expect
      .poll(async () => (await findReidentifyAuditRows(participantId)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
    for (const row of await findReidentifyAuditRows(participantId)) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(NAME_MARKER);
      expect(serialized).not.toContain(BIRTH_DATE);
    }

    // A Técnico lacks reidentifyParticipant: the permission gate refuses
    // it before the organization-scope gate is reached.
    const username = `tecnico.rnf007.${Date.now()}`;
    const password = 'Tecnico@123-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RNF007 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const tecnico = await completeFirstLoginMfa(request, apiBaseURL!, username, password);

    const refused = await request.post(reidentifyUrl, {
      headers: { Authorization: `Bearer ${tecnico.token}` },
      data: { reason: 'RNF007 AC2 e2e: unauthorized resolution attempt' },
    });
    const refusedText = await refused.text();
    expect(refused.status(), refusedText).toBe(403);
    expect(JSON.parse(refusedText).message).toBe('Você não tem permissão para esta ação');
    expect(refusedText).not.toContain(NAME_MARKER);
  });

  test('system-generated labels and print jobs carry only opaque codes, never civil identity (RNF007 AC4, RNF022 AC6, RF016 AC8)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { specimenId } = await createSampleForNewParticipant(request, admin.token);

    const printJob = await request.get(`${apiBaseURL}/api/samples/${specimenId}/label/print-job`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(printJob.status(), await printJob.text()).toBe(200);
    const printJobData = (await printJob.json()).data;
    expect(printJobData.barcode).toMatch(/^BR-\d{4}-\d{3,}$/);
    expect(printJobData.sampleId).toBe(specimenId);

    const label = await request.get(`${apiBaseURL}/api/samples/${specimenId}/label`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(label.status(), await label.text()).toBe(200);
    expect(label.headers()['content-type']).toContain('image/svg+xml');
    const svg = await label.text();

    for (const rendered of [svg, JSON.stringify(printJobData)]) {
      expect(rendered).not.toContain(NAME_MARKER);
      expect(rendered).not.toContain(BIRTH_DATE);
    }
  });

  test('report exports carry the pseudonymous participantId and no civil identity (RNF022 AC6, RNF007 AC5)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { participantId } = await createSampleForNewParticipant(request, admin.token);

    const csv = await request.get(`${apiBaseURL}/api/reports/samples_by_patient/export?keyword=${participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(csv.status(), await csv.text()).toBe(200);
    const csvBody = await csv.text();
    expect(csvBody).toContain(participantId);
    const headerCells = csvBody.split('\n')[0].split(',').map((cell) => cell.trim());
    for (const civilField of ['patientName', 'birthDate', 'identityDocument']) {
      expect(headerCells).not.toContain(civilField);
    }
    expect(csvBody).not.toContain(NAME_MARKER);
    expect(csvBody).not.toContain(BIRTH_DATE);

    const pdf = await request.get(`${apiBaseURL}/api/reports/samples_by_patient/export/pdf?keyword=${participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(pdf.status(), await pdf.text()).toBe(200);
    const pdfSerialized = JSON.stringify(await pdf.json());
    expect(pdfSerialized).toContain(participantId);
    expect(pdfSerialized).not.toContain(NAME_MARKER);
    expect(pdfSerialized).not.toContain(BIRTH_DATE);
  });
});
