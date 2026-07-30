import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedOperationalLocation,
  closeSeedDb,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF007 e2e fixture project',
    registeredAt: new Date().toISOString(),
  };
}

async function createRealSample(request: any, token: string): Promise<string> {
  const participant = await createRealParticipant(request, apiBaseURL!, token);
  const locationID = await seedOperationalLocation();

  const create = await request.post(`${apiBaseURL}/api/samples`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      participantId: participant.participantId,
      ...validSampleFields(),
      locationID,
    },
  });
  expect([201, 202]).toContain(create.status());
  return (await create.json()).data.sampleID;
}

test.afterAll(async () => {
  await closeSeedDb();
});

test.describe('Scientific files (RF007) — real backend', () => {
  test('uploads a scientific file, recording checksum/URI/encryption and auditing it (AC#3/4/5/6/7, RNF029)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const fileContent = Buffer.from('RF007 e2e raw scientific data payload — deterministic bytes for checksum proof');
    const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'raw-data.csv',
          mimeType: 'text/csv',
          buffer: fileContent,
        },
      },
    });

    expect(upload.status()).toBe(201);
    const uploadBody = await upload.json();

    // AC#5/RNF029 - URI, checksum and encryption metadata recorded.
    expect(uploadBody.data.uri).toMatch(/^objstore:\/\/samples\//);
    expect(uploadBody.data.checksum).toBe(expectedChecksum);
    expect(uploadBody.data.checksumAlgorithm).toBe('sha256');
    expect(uploadBody.data.encryption.encrypted).toBe(true);
    expect(uploadBody.data.encryption.algorithm).toBe('aes-256-gcm');
    // AC#5 - access restrictions recorded alongside the file.
    expect(uploadBody.data.accessPolicy).toMatchObject({ view: 'authenticated' });
    // AC#6 - linked to the specimen it was uploaded against.
    expect(uploadBody.data.specimenId).toBeTruthy();

    // AC#7 - upload is audited.
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // RNF029 round-trip - decrypting on download reproduces the original
    // plaintext bytes exactly, proving the at-rest cipher didn't corrupt
    // the file and the checksum recorded really matches what's served back.
    const fileID = uploadBody.data._id;
    const download = await request.get(`${apiBaseURL}/api/samples/${sampleID}/files/${fileID}/download`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(download.status()).toBe(200);
    const downloadedBytes = await download.body();
    const downloadedChecksum = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
    expect(downloadedChecksum).toBe(expectedChecksum);

    // AC#7 - list (access) is also audited.
    const listWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const list = await request.get(`${apiBaseURL}/api/samples/${sampleID}/files`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const listedFile = listBody.data.find((f: any) => f._id === fileID);
    expect(listedFile.checksum).toBe(expectedChecksum);
    expect(listedFile.uri).toMatch(/^objstore:\/\/samples\//);
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, listWatch);
  });

  test('rejects a disallowed file format (AC#1)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'not-allowed.exe',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('not a real executable, just disallowed bytes'),
        },
      },
    });

    expect(upload.status()).toBe(400);
    const body = await upload.json();
    expect(body.success).toBe(false);
  });

  test('rejects a file over the configured size limit (AC#2)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const oversized = Buffer.alloc(101 * 1024 * 1024, 'x'); // limit is 100MB (sample-file.controller.js)

    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'too-big.csv',
          mimeType: 'text/csv',
          buffer: oversized,
        },
      },
    });

    expect(upload.status()).toBe(400);
    const body = await upload.json();
    expect(body.success).toBe(false);
  });
});
