import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  seedStudy,
  seedActiveConsent,
  seedDuoConcept,
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
  const { boxId, positionCode } = await seedStorageBoxLocation();

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
    // AC#5 ("formato")/dict-02 ELM-0317/ELM-0319 (#679) - format and
    // default pipeline-stage role recorded alongside the file.
    expect(uploadBody.data.fileFormat).toBe('text/csv');
    expect(uploadBody.data.fileRole).toBe('raw');
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

  test('accepts an explicit fileRole and records it (dict-02 ELM-0317, #679)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        fileRole: 'processed',
        file: {
          name: 'processed-data.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('RF007 e2e fileRole fixture'),
        },
      },
    });

    expect(upload.status()).toBe(201);
    const uploadBody = await upload.json();
    expect(uploadBody.data.fileRole).toBe('processed');
  });

  test('rejects an unsupported fileRole (400, dict-02 ELM-0317, #679)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        fileRole: 'not-a-real-role',
        file: {
          name: 'bad-role.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('RF007 e2e invalid fileRole fixture'),
        },
      },
    });

    expect(upload.status()).toBe(400);
  });

  test('replaces a scientific file, recomputing checksum/encryption and auditing the substitution (AC#7, #334)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    const originalContent = Buffer.from('RF007 e2e original file content — before replace');
    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'original.csv',
          mimeType: 'text/csv',
          buffer: originalContent,
        },
      },
    });
    expect(upload.status()).toBe(201);
    const uploadBody = await upload.json();
    const fileID = uploadBody.data._id;
    const originalChecksum = uploadBody.data.checksum;

    const replacementContent = Buffer.from('RF007 e2e replacement file content — after replace, different bytes');
    const expectedNewChecksum = crypto.createHash('sha256').update(replacementContent).digest('hex');

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const replace = await request.put(`${apiBaseURL}/api/samples/${sampleID}/files/${fileID}/replace`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'replacement.csv',
          mimeType: 'text/csv',
          buffer: replacementContent,
        },
      },
    });

    expect(replace.status()).toBe(200);
    const replaceBody = await replace.json();
    expect(replaceBody.data._id).toBe(fileID);
    expect(replaceBody.data.fileName).toBe('replacement.csv');
    expect(replaceBody.data.checksum).toBe(expectedNewChecksum);
    expect(replaceBody.data.checksum).not.toBe(originalChecksum);
    expect(replaceBody.data.encryption.encrypted).toBe(true);
    expect(replaceBody.data.uri).toMatch(/^objstore:\/\/samples\//);

    // AC#7 - substituição is audited, same as upload/access/removal.
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // Round-trip proof: downloading now serves the NEW content, decrypted
    // correctly — proves the replace genuinely swapped the on-disk
    // ciphertext, not just the DB metadata.
    const download = await request.get(`${apiBaseURL}/api/samples/${sampleID}/files/${fileID}/download`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(download.status()).toBe(200);
    const downloadedBytes = await download.body();
    expect(downloadedBytes.equals(replacementContent)).toBe(true);
    const downloadedChecksum = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
    expect(downloadedChecksum).toBe(expectedNewChecksum);
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

test.describe('Access and distribution requests (RF024) — real backend', () => {
  async function createRequestForSample(
    request: any,
    token: string,
    opts: { studyId: string; duoCode?: string }
  ): Promise<any> {
    const sampleID = await createRealSample(request, token);
    const sampleDoc = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sampleDoc.status()).toBe(200);
    const specimenId = (await sampleDoc.json()).data.specimenId;
    expect(specimenId).toBeTruthy();

    const create = await request.post(`${apiBaseURL}/api/access-requests`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        requesterId: `researcher-${Date.now()}`,
        studyId: opts.studyId,
        requestedPurpose: 'RF024 e2e — pesquisa em biomarcadores oncológicos',
        duoCode: opts.duoCode,
        requestedItems: [{ itemType: 'specimen', itemId: specimenId }],
      },
    });
    expect(create.status()).toBe(201);
    return (await create.json()).data;
  }

  test('registers a request, evaluates real consent/DUO/study compatibility, and only an approved in-force decision unblocks distribution (AC#1/2/3/4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const studyId = `rf024-study-${Date.now()}`;
    await seedStudy(studyId);
    const duoCode = `DUO:rf024-${Date.now()}`;
    await seedDuoConcept(duoCode);

    // AC#1 - requester, study, purpose and requested items registered.
    const accessRequest = await createRequestForSample(request, admin.token, { studyId, duoCode });
    expect(accessRequest.studyId).toBe(studyId);
    expect(accessRequest.requestedItems).toHaveLength(1);
    expect(accessRequest.committeeDecision.status).toBe('pending');

    // AC#5 - pending is not an allowed access state.
    const preDecisionCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(preDecisionCheck.status()).toBe(200);
    expect((await preDecisionCheck.json()).data).toMatchObject({ allowed: false, reason: 'pending' });

    // AC#2 - the specimen's real participant has no ACTIVE consent seeded
    // yet, so evaluating now must come back incompatible, not silently ok.
    const earlyEvaluate = await request.post(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/evaluate`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(earlyEvaluate.status()).toBe(200);
    const earlyBody = (await earlyEvaluate.json()).data;
    expect(earlyBody.overallCompatible).toBe(false);
    const participantId = earlyBody.consentCompatibility[0].participantId;
    expect(participantId).toBeTruthy();

    // Seed the real ACTIVE consent for that real participant, then re-evaluate.
    await seedActiveConsent(participantId);
    const evaluate = await request.post(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/evaluate`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(evaluate.status()).toBe(200);
    const evaluateBody = (await evaluate.json()).data;
    expect(evaluateBody.overallCompatible).toBe(true);
    expect(evaluateBody.consentCompatibility[0]).toMatchObject({
      consentValid: true,
      duoCompatible: true,
      studyActive: true,
    });

    // AC#3 - committee decision recorded with justification and validity.
    const decision = await request.post(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`,
      {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          status: 'approved',
          justification: 'Compatibilidade confirmada — RF024 e2e',
          approvalPeriod: {
            start: new Date(Date.now() - 60_000).toISOString(),
            end: new Date(Date.now() + 3_600_000).toISOString(),
          },
        },
      }
    );
    expect(decision.status()).toBe(200);
    const decisionBody = (await decision.json()).data;
    expect(decisionBody.committeeDecision.status).toBe('approved');
    expect(decisionBody.committeeDecision.decidedBy).toBeTruthy();

    // AC#5 - now allowed.
    const allowedCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect((await allowedCheck.json()).data).toMatchObject({ allowed: true, reason: 'approved' });

    // AC#4 - approval linked to real distribution/availability.
    const distribute = await request.post(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/distribute`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(distribute.status()).toBe(200);
    const distributeBody = (await distribute.json()).data;
    expect(distributeBody.distributionStatus).toBe('released');
    expect(distributeBody.distributedAt).toBeTruthy();
  });

  test('blocks access for a rejected decision, and separately for a revoked one (AC#5)', async ({ request }) => {
    const admin = await realLogin(request);
    const studyId = `rf024-study-${Date.now()}`;
    await seedStudy(studyId);

    const rejected = await createRequestForSample(request, admin.token, { studyId });
    await request.post(`${apiBaseURL}/api/access-requests/${rejected.accessRequestId}/evaluate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const rejectDecision = await request.post(
      `${apiBaseURL}/api/access-requests/${rejected.accessRequestId}/decision`,
      {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { status: 'rejected', justification: 'Finalidade fora do escopo do consentimento — RF024 e2e' },
      }
    );
    expect(rejectDecision.status()).toBe(200);

    const rejectedCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${rejected.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect((await rejectedCheck.json()).data).toMatchObject({ allowed: false, reason: 'denied' });

    // A rejected request can never be linked to distribution (AC#4 guard).
    const distributeRejected = await request.post(
      `${apiBaseURL}/api/access-requests/${rejected.accessRequestId}/distribute`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(distributeRejected.status()).toBe(400);

    // Revoked branch — starts from a genuine approval, then gets revoked.
    const toRevoke = await createRequestForSample(request, admin.token, { studyId });
    await request.post(`${apiBaseURL}/api/access-requests/${toRevoke.accessRequestId}/evaluate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    await request.post(`${apiBaseURL}/api/access-requests/${toRevoke.accessRequestId}/decision`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        status: 'approved',
        justification: 'Aprovado antes da revogação — RF024 e2e',
        approvalPeriod: {
          start: new Date(Date.now() - 60_000).toISOString(),
          end: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });

    const revoke = await request.post(`${apiBaseURL}/api/access-requests/${toRevoke.accessRequestId}/revoke`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { justification: 'Participante retirou o consentimento — RF024 e2e' },
    });
    expect(revoke.status()).toBe(200);
    expect((await revoke.json()).data.committeeDecision.status).toBe('revoked');

    const revokedCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${toRevoke.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect((await revokedCheck.json()).data).toMatchObject({ allowed: false, reason: 'revoked' });
  });

  test('blocks access once a real, persisted approval period has expired (AC#5)', async ({ request }) => {
    const admin = await realLogin(request);
    const studyId = `rf024-study-${Date.now()}`;
    await seedStudy(studyId);

    const accessRequest = await createRequestForSample(request, admin.token, { studyId });
    await request.post(`${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/evaluate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    await request.post(`${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        status: 'approved',
        justification: 'Aprovado com vigência já expirada — RF024 e2e',
        approvalPeriod: { start: '2020-01-01T00:00:00.000Z', end: '2020-01-31T00:00:00.000Z' },
      },
    });

    const expiredCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect((await expiredCheck.json()).data).toMatchObject({ allowed: false, reason: 'expired' });
  });
});
