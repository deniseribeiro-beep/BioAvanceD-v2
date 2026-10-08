import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  seedStudy,
  seedProtocol,
  seedActiveConsent,
  seedDuoConcept,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { deleteOrganizations } from './helpers/listOrganizations';

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

const seededStorageBoxes: SeededStorageBox[] = [];

async function createRealSample(request: any, token: string): Promise<string> {
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
  return (await create.json()).data.specimenId;
}

test.afterAll(async () => {
  await Promise.all(
    seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
  );
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
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  // AC#1: a request names a real organization and an approved protocol.
  async function createRequestForSample(
    request: any,
    token: string,
    opts: { studyId: string; duoCode?: string }
  ): Promise<any> {
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { officialName: `RF024 ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    const protocolId = `rf024-protocol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await seedProtocol(protocolId, { protocolVersion: '1.2' });

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
        organizationId,
        studyId: opts.studyId,
        protocolId,
        requestedPurpose: 'RF024 e2e — pesquisa em biomarcadores oncológicos',
        duoCode: opts.duoCode,
        requestedItems: [{ itemType: 'specimen', itemId: specimenId }],
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()).data;
    expect(created).toMatchObject({ organizationId, protocolId, protocolVersion: '1.2' });
    return created;
  }

  // An approval needs a passing evaluation (AC#6): seed the ACTIVE consent
  // for the request's real participant, then evaluate it compatible.
  async function evaluateCompatible(request: any, token: string, accessRequestId: string): Promise<void> {
    const url = `${apiBaseURL}/api/access-requests/${accessRequestId}/evaluate`;
    const first = await request.post(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(first.status()).toBe(200);
    await seedActiveConsent((await first.json()).data.consentCompatibility[0].participantId);
    const second = await request.post(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(second.status()).toBe(200);
    expect((await second.json()).data.overallCompatible).toBe(true);
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

    // AC#6 - an evaluated but incompatible request cannot be approved.
    const incompatibleApproval = await request.post(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`,
      {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { status: 'approved', justification: 'Aprovação sem consentimento ativo — RF024 e2e' },
      }
    );
    expect(incompatibleApproval.status()).toBe(400);
    expect((await incompatibleApproval.json()).message).toMatch(/incompatível/);

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
    // AC#4 - the policy version, the configuration release key and the instant.
    expect(decisionBody.committeeDecision.policyVersion).toBeTruthy();
    expect(decisionBody.committeeDecision).toHaveProperty('configurationReleaseId');
    expect(decisionBody.committeeDecision.decidedAt).toBeTruthy();
    expect(decisionBody.committeeDecision.decisionId).toBeTruthy();
    // AC#3 - no AccessPolicy covers this request's organization, so the
    // effect was review_required, which this committee decision resolved.
    expect(decisionBody.committeeDecision).toMatchObject({ policyEffect: 'review_required', appliedPolicies: [] });

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
    // AC#7 - the distribution names the decision that authorized it.
    expect(distributeBody.distributionDecisionId).toBe(decisionBody.committeeDecision.decisionId);
  });

  test('an AccessPolicy permits, a newer deny version refuses the approval, and the decision names each version (AC#3, RNF008 AC4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const studyId = `rf024-study-${Date.now()}`;
    await seedStudy(studyId);
    const accessRequest = await createRequestForSample(request, admin.token, { studyId });
    await evaluateCompatible(request, admin.token, accessRequest.accessRequestId);

    // A permit policy scoped to this request's own organization.
    const policyBody = {
      policyName: `RF024 e2e ${Date.now()}`,
      policyVersion: '1.0.0',
      applicableEntityTypes: ['AccessRequest'],
      decisionEffect: 'permit',
      ruleExpression: 'all-conditions',
      effectivePeriod: { start: new Date(Date.now() - 60_000).toISOString() },
      roleCodes: ['researcher'],
      organizationScopeIds: [accessRequest.organizationId],
      resourceScopes: ['Specimen'],
      conditions: [{ consent: 'compatible', study: 'active' }],
      decisionReasonsRequired: true,
    };
    const created = await request.post(`${apiBaseURL}/api/access-policies`, { headers: auth, data: policyBody });
    expect(created.status(), await created.text()).toBe(201);
    const accessPolicyId = (await created.json()).data.accessPolicyId;

    const evaluateUrl = `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/evaluate`;
    const permitted = (await (await request.post(evaluateUrl, { headers: auth })).json()).data;
    expect(permitted.policyDecision).toMatchObject({
      effect: 'permit',
      appliedPolicies: [expect.objectContaining({ accessPolicyId, policyVersion: '1.0.0', decisionEffect: 'permit' })],
    });

    // A new version, never an edit: 1.1.0 denies, and it is the one in force.
    const denyVersion = await request.post(`${apiBaseURL}/api/access-policies/${accessPolicyId}/versions`, {
      headers: auth,
      data: { ...policyBody, policyVersion: '1.1.0', decisionEffect: 'deny' },
    });
    expect(denyVersion.status(), await denyVersion.text()).toBe(201);
    const stale = await request.post(`${apiBaseURL}/api/access-policies/${accessPolicyId}/versions`, {
      headers: auth,
      data: { ...policyBody, policyVersion: '1.0.1' },
    });
    expect(stale.status()).toBe(422);
    const versions = (await (await request.get(`${apiBaseURL}/api/access-policies/${accessPolicyId}`, { headers: auth })).json()).data;
    expect(versions.map((v: any) => v.policyVersion)).toEqual(['1.1.0', '1.0.0']);

    const denied = (await (await request.post(evaluateUrl, { headers: auth })).json()).data;
    expect(denied.overallCompatible).toBe(true);
    expect(denied.policyDecision.effect).toBe('deny');

    const approval = await request.post(`${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`, {
      headers: auth,
      data: { status: 'approved', justification: 'Aprovação contra uma política que nega — RF024 e2e' },
    });
    expect(approval.status()).toBe(400);
    expect((await approval.json()).message).toMatch(/negada pela política de acesso/);

    const rejection = await request.post(`${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`, {
      headers: auth,
      data: { status: 'rejected', justification: 'Negada pela política de acesso — RF024 e2e' },
    });
    expect(rejection.status()).toBe(200);
    expect((await rejection.json()).data.committeeDecision).toMatchObject({
      status: 'rejected',
      policyEffect: 'deny',
      appliedPolicies: [{ accessPolicyId, policyVersion: '1.1.0', decisionEffect: 'deny' }],
    });
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
    await evaluateCompatible(request, admin.token, toRevoke.accessRequestId);
    const approve = await request.post(`${apiBaseURL}/api/access-requests/${toRevoke.accessRequestId}/decision`, {
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
    expect(approve.status(), await approve.text()).toBe(200);

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
    await evaluateCompatible(request, admin.token, accessRequest.accessRequestId);
    const approve = await request.post(`${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/decision`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        status: 'approved',
        justification: 'Aprovado com vigência já expirada — RF024 e2e',
        approvalPeriod: { start: '2020-01-01T00:00:00.000Z', end: '2020-01-31T00:00:00.000Z' },
      },
    });
    expect(approve.status(), await approve.text()).toBe(200);

    const expiredCheck = await request.get(
      `${apiBaseURL}/api/access-requests/${accessRequest.accessRequestId}/access-check`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect((await expiredCheck.json()).data).toMatchObject({ allowed: false, reason: 'expired' });
  });
});

test.describe('Workflows and omics data (RF027) — real backend', () => {
  test('registers a workflow run, links an input file, qualifies the assay, and records a genomic reference (AC#1/2/3/4/5/6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const sampleID = await createRealSample(request, admin.token);

    // A real, already-uploaded scientific file (RF007) to link as the
    // workflow run's input — RF027 AC#3 links to files that already
    // exist elsewhere, it doesn't own new file bytes (#716 slice 2/4).
    const fileContent = Buffer.from('RF027 e2e fixture — deterministic raw sequencing bytes for input linkage');
    const upload = await request.post(`${apiBaseURL}/api/samples/${sampleID}/files/upload`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          // sample-file.controller.js's fileFilter only allows
          // .raw/.zip/.csv/.xls/.xlsx/.pdf/.txt — .fastq isn't in that
          // list, so this uses .raw (matches the "raw sequencing data"
          // fixture content, and is the closest allowed extension).
          name: 'reads.raw',
          mimeType: 'application/octet-stream',
          buffer: fileContent,
        },
      },
    });
    expect(upload.status()).toBe(201);
    const fileID = (await upload.json()).data._id;

    // AC#1/2/4: register the workflow, version, container image,
    // parameters/dependencies, and start/end/executor/status.
    const startedAt = new Date().toISOString();
    const createRun = await request.post(`${apiBaseURL}/api/workflow-runs`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        workflowId: 'variant-calling-pipeline',
        workflowVersion: '2.3.1',
        createdBy: `User/${admin.user._id}`,
        containerImageDigest: 'sha256:e2e0000000000000000000000000000000000000000000000000000000000',
        softwareDependencies: [{ name: 'bwa', version: '0.7.17' }],
        parameters: { threads: 8 },
        startedAt,
        completedAt: new Date().toISOString(),
        runStatus: 'succeeded',
      },
    });
    expect(createRun.status()).toBe(201);
    const runBody = await createRun.json();
    expect(runBody.data.workflowId).toBe('variant-calling-pipeline');
    expect(runBody.data.createdBy).toBe(`User/${admin.user._id}`);
    const workflowRunId = runBody.data.workflowRunId;

    // AC#3: link the real, already-uploaded file as an input.
    const link = await request.post(`${apiBaseURL}/api/workflow-runs/${workflowRunId}/files`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { fileId: fileID, direction: 'input' },
    });
    expect(link.status()).toBe(200);
    expect((await link.json()).data.inputFileIds).toContain(fileID);

    // AC#6: qualification for the assay this run's outputs feed into.
    const qualification = await request.post(`${apiBaseURL}/api/omics-qualifications`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        targetAssay: 'RNA-seq',
        qcRuleSetVersion: 'RNA_QC_1.0',
        qcMetrics: [{ metric: 'RIN', value: 8.2 }],
        qualificationDecision: 'eligible',
      },
    });
    expect(qualification.status()).toBe(201);
    expect((await qualification.json()).data.qualificationDecision).toBe('eligible');

    // AC#5: genomic reference, "quando aplicável" — this run is a
    // genomics-modality run, so it applies here.
    const omicsRun = await request.post(`${apiBaseURL}/api/omics-runs`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        modality: 'genomics',
        referenceAssembly: 'GRCh38',
        fileLinks: [{ role: 'variant', fileId: fileID }],
      },
    });
    expect(omicsRun.status()).toBe(201);
    const omicsRunBody = await omicsRun.json();
    expect(omicsRunBody.data.modality).toBe('genomics');
    expect(omicsRunBody.data.referenceAssembly).toBe('GRCh38');
  });

  test('registers an omics run without a genomic reference when not applicable (AC#5 "quando aplicável")', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const omicsRun = await request.post(`${apiBaseURL}/api/omics-runs`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { modality: 'proteomics' },
    });
    expect(omicsRun.status()).toBe(201);
    expect((await omicsRun.json()).data.referenceAssembly).toBeNull();
  });
});

// RF008 (Relatórios) — Wave 4 kickoff (#723). The report pipeline
// (reports.routes.js) already existed; this block proves it end to end
// against the real backend, criterion by criterion, and files what it
// can't prove as red-first gaps rather than writing around them.
test.describe('Reports (RF008) — real backend', () => {
  // #737: buildPreviewData (#726) dispatches only via a ReportTemplate
  // lookup by `code` -- if the 14 system rows aren't there, every report
  // type silently returns the no-preview fallback and CSV export is empty.
  // Nothing seeded them on any live stack before #737 wired the idempotent
  // seed into server.js's boot path (this assertion was red: `data: []`).
  // Codes mirror report-template-seed.service.js's SYSTEM_REPORT_TEMPLATES
  // (hardcoded here rather than imported -- tests/e2e never requires
  // backend source, see #729).
  const SYSTEM_REPORT_TEMPLATE_CODES = [
    'samples_by_patient',
    'patients',
    'samples',
    'sample_analysis',
    'temperature',
    'temperature_control',
    'sensors',
    'equipment',
    'results',
    'audit',
    'withdrawal_history',
    'tissue_origin_history',
    'extracellular_network',
    'access_logs',
  ];

  // The live preview handlers cap their result sets (handleSample: 100,
  // handleSamplesByPatient: 20 patients) with no deterministic ordering, so
  // asserting "my freshly created specimen is in the samples report" is
  // only honest through a filter that narrows the set to it: the
  // samples_by_patient report + the `keyword` filter, which matches the
  // pseudonymized participantId (reports.routes.js#handleSamplesByPatient).
  async function createRealSampleWithParticipant(
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

  async function previewReport(request: any, token: string, type: string, filters: Record<string, unknown>) {
    return request.post(`${apiBaseURL}/api/reports/${type}/preview`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { filters },
    });
  }

  test('the system report templates exist on the running stack without a manual seed step (#737)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const response = await request.get(`${apiBaseURL}/api/report-templates`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(response.ok(), await response.text()).toBe(true);

    const templates = (await response.json()).data as Array<{
      code: string;
      isSystemDefined?: boolean;
      templateStatus: string;
    }>;
    const activeSystemCodes = templates
      .filter((template) => template.isSystemDefined && template.templateStatus === 'active')
      .map((template) => template.code);

    for (const code of SYSTEM_REPORT_TEMPLATE_CODES) {
      expect(activeSystemCodes, `system report template "${code}" is missing`).toContain(code);
    }
  });

  // AC#1 names six filter dimensions (período, coleção, tipo, origem,
  // estado, localização). All six are wired into the sample-rooted
  // handlers' shared buildSampleQuery as of #739 -- `estado` via the
  // canonical specimenStatus mapping (#531), the other five directly on
  // Sample's own fields. This test proves two of them narrow real data
  // both ways: `estado` (status) and `tipo` (sampleType).
  test('applies the AC#1 filters to the specimens behind a report', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealSampleWithParticipant(request, admin.token);

    const available = await previewReport(request, admin.token, 'samples_by_patient', {
      keyword: participantId,
      status: 'AVAILABLE',
    });
    expect(available.ok(), await available.text()).toBe(true);
    const availableBody = await available.json();
    expect(availableBody.data.total).toBe(1);
    expect(availableBody.data.patients[0].participantId).toBe(participantId);
    expect(availableBody.data.patients[0].sampleCount).toBe(1);

    // Same participant, a status the fresh specimen is not in. Since #741
    // the patient list is narrowed to owners of matching samples whenever
    // a sample-level filter is active -- regardless of whether that filter
    // matched anything elsewhere in the collection -- so the participant
    // row itself must be absent, not merely carry sampleCount 0.
    const quarantined = await previewReport(request, admin.token, 'samples_by_patient', {
      keyword: participantId,
      status: 'QUARANTINE',
    });
    expect(quarantined.ok(), await quarantined.text()).toBe(true);
    const quarantinedBody = await quarantined.json();
    const patient = quarantinedBody.data.patients.find((entry: any) => entry.participantId === participantId);
    expect(patient, 'a participant with no quarantined specimen must not appear').toBeUndefined();

    // `tipo` (#739): the fixture specimen is PLASMA. Matching type keeps
    // it; a different valid MIABIS type drops it. Before #739 both calls
    // returned the same row, because sampleType never reached the query.
    const plasma = await previewReport(request, admin.token, 'samples_by_patient', {
      keyword: participantId,
      sampleType: 'PLASMA',
    });
    expect(plasma.ok(), await plasma.text()).toBe(true);
    const plasmaBody = await plasma.json();
    expect(plasmaBody.data.patients[0].participantId).toBe(participantId);
    expect(plasmaBody.data.patients[0].sampleCount).toBe(1);

    const serum = await previewReport(request, admin.token, 'samples_by_patient', {
      keyword: participantId,
      sampleType: 'SERUM',
    });
    expect(serum.ok(), await serum.text()).toBe(true);
    const serumBody = await serum.json();
    expect(
      serumBody.data.patients.find((entry: any) => entry.participantId === participantId),
      'a participant with no SERUM specimen must not appear'
    ).toBeUndefined();
  });

  // AC#2: "Restringir os dados conforme AccessPolicy, papel e consentimento."
  // Three real gates, each proven with the backend's own refusal rather
  // than the frontend's: no session at all; a genuine non-admin session
  // (Técnico holds viewReports but has no organization assignment, so
  // #340/#341's org-scope resolution is 'none' → hard 403 on every
  // organization-scoped report type and on the saved-reports listing);
  // and the manageReportTemplates gate (Coordenador+Administrador only,
  // #726) refusing that same Técnico.
  test('restricts report data by session, role and organization scope (AC#2)', async ({ request }) => {
    const admin = await realLogin(request);

    const unauthenticated = await request.post(`${apiBaseURL}/api/reports/samples/preview`, {
      data: { filters: {} },
    });
    expect(unauthenticated.status()).toBe(401);

    const username = `tecnico.rf008.${Date.now()}`;
    const password = 'Tecnico@123-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF008 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const tecnico = await completeFirstLoginMfa(request, apiBaseURL!, username, password);

    const scopedPreview = await previewReport(request, tecnico.token, 'samples', {});
    expect(scopedPreview.status(), await scopedPreview.text()).toBe(403);

    const savedReports = await request.get(`${apiBaseURL}/api/reports`, {
      headers: { Authorization: `Bearer ${tecnico.token}` },
    });
    expect(savedReports.status(), await savedReports.text()).toBe(403);

    const createTemplate = await request.post(`${apiBaseURL}/api/report-templates`, {
      headers: { Authorization: `Bearer ${tecnico.token}` },
      data: { code: `rf008_tecnico_${Date.now()}`, name: 'should be refused', handlerKey: 'sample', templateStatus: 'active' },
    });
    expect(createTemplate.status(), await createTemplate.text()).toBe(403);
  });

  // AC#3 / RNF007: patient-rooted reports carry the pseudonymized
  // participantId, never civil identity -- patientName/birthDate live on
  // the segregated ParticipantIdentity entity (#561/#575), not on the
  // Patient document the report handlers read, and the keyword filter
  // deliberately no longer resolves against names (#574).
  test('omits civil identity from patient-rooted report data (AC#3, RNF007)', async ({ request }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealSampleWithParticipant(request, admin.token);

    for (const type of ['patients', 'samples_by_patient']) {
      const preview = await previewReport(request, admin.token, type, { keyword: participantId });
      expect(preview.ok(), await preview.text()).toBe(true);
      const body = await preview.json();
      const patient = body.data.patients.find((entry: any) => entry.participantId === participantId);
      expect(patient, `${type}: participant ${participantId} not in preview`).toBeTruthy();
      expect(patient).not.toHaveProperty('patientName');
      expect(patient).not.toHaveProperty('birthDate');
      expect(patient).not.toHaveProperty('identityDocument');
      for (const sample of patient.samples || []) {
        expect(sample).not.toHaveProperty('patientName');
      }
    }
  });

  // AC#4: the two enabled export formats (CSV via GET /:type/export, PDF via
  // GET /:type/export/pdf) work against real data; anything else is not a
  // route at all. AC#5: each export is recorded on the real audit trail --
  // by the global auditRequest middleware (audit.middleware.js, mounted in
  // app.js), which logs action=EXPORT / entity=Report with the full path,
  // not by reports.routes.js itself (see #723's first progress comment).
  test('exports only in enabled formats and records each export event (AC#4, AC#5)', async ({ request }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealSampleWithParticipant(request, admin.token);
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const csv = await request.get(`${apiBaseURL}/api/reports/samples_by_patient/export?keyword=${participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(csv.status(), await csv.text()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(/attachment; filename=report_\d+\.csv/);
    const csvBody = await csv.text();
    const [header, ...rows] = csvBody.split('\n');
    expect(header.split(',')).toContain('participantId');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(csvBody).toContain(participantId);

    const pdf = await request.get(`${apiBaseURL}/api/reports/samples_by_patient/export/pdf?keyword=${participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(pdf.status(), await pdf.text()).toBe(200);
    const pdfBody = await pdf.json();
    expect(pdfBody.format).toBe('pdf');
    expect(pdfBody.data.patients.some((entry: any) => entry.participantId === participantId)).toBe(true);

    const disabledFormat = await request.get(`${apiBaseURL}/api/reports/samples_by_patient/export/xlsx`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(disabledFormat.status()).toBe(404);

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch, 2);
  });

  // AC#6: "Permitir a criação de novos modelos de relatório sem depender
  // de uma lista fixa." A template created through the API (#726) is
  // immediately usable for preview, generation and export under its own
  // code -- nothing in the dispatch path knows the fixed list any more.
  test('a report template created at runtime is usable for preview, generation and export (AC#6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealSampleWithParticipant(request, admin.token);
    const code = `rf008_e2e_${Date.now()}`;

    const create = await request.post(`${apiBaseURL}/api/report-templates`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        code,
        name: 'RF008 e2e custom template',
        description: 'Created by the RF008 real-backend spec',
        handlerKey: 'samplesByPatient',
        templateStatus: 'active',
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const templateId = (await create.json()).data._id;
    expect(templateId).toBeTruthy();

    let reportId: string | null = null;
    try {
      const preview = await previewReport(request, admin.token, code, { keyword: participantId });
      expect(preview.ok(), await preview.text()).toBe(true);
      const previewBody = await preview.json();
      expect(previewBody.data.total).toBe(1);
      expect(previewBody.data.patients[0].participantId).toBe(participantId);

      const generate = await request.post(`${apiBaseURL}/api/reports/generate`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { reportType: code, filters: { keyword: participantId } },
      });
      expect(generate.status(), await generate.text()).toBe(201);
      const generated = await generate.json();
      reportId = generated._id;
      expect(generated.reportType).toBe(code);
      expect(JSON.parse(generated.reportData).patients[0].participantId).toBe(participantId);

      const fetched = await request.get(`${apiBaseURL}/api/reports/${reportId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(fetched.status(), await fetched.text()).toBe(200);
      expect((await fetched.json()).reportType).toBe(code);

      const csv = await request.get(`${apiBaseURL}/api/reports/${code}/export?keyword=${participantId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(csv.status()).toBe(200);
      expect(await csv.text()).toContain(participantId);
    } finally {
      if (reportId) {
        await request.delete(`${apiBaseURL}/api/reports/${reportId}`, {
          headers: { Authorization: `Bearer ${admin.token}` },
        });
      }
      const remove = await request.delete(`${apiBaseURL}/api/report-templates/${templateId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(remove.status(), await remove.text()).toBe(200);
    }
  });

  // The operator-facing leg: the only live frontend caller of the report
  // pipeline today is ReportQueryPage's Exportar button → GET /:type/export
  // (per #726's dispatch-wiring note), reached from the ReportsPage card
  // grid. Proves the real UI drives the real backend to a real CSV file.
  test('an operator reaches a CSV export through the real UI (/reports → query page → download)', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    await createRealSampleWithParticipant(request, admin.token);

    // Pin the UI language so the card/button labels below are deterministic
    // (i18n/index.ts#initLanguage reads `app_language` before the browser
    // locale) -- the same trap issue #5's Portuguese-label guessing hit.
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, admin);

    await page.goto('/reports');
    const card = page.locator('.report-card', { hasText: 'Amostras por Paciente' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Gerar Relatório' }).click();
    await expect(page).toHaveURL(/\/reports\/query\/samplesByPatient$/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^relatorio_.*\.csv$/);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    const csv = fs.readFileSync(downloadedPath!, 'utf8');
    expect(csv.split('\n')[0].split(',')).toContain('participantId');
  });

  // #733: `audit` and `access_logs` were two menu entries over one `logs`
  // query. RF008 names AuditEvent, so `audit` now reads the hash-chained
  // audit_events trail. The login itself is audited, so the trail is never
  // empty here.
  test('the audit report reads the AuditEvent trail, distinct from access_logs (#733)', async ({ request }) => {
    const admin = await realLogin(request);

    const audit = await previewReport(request, admin.token, 'audit', {});
    expect(audit.ok(), await audit.text()).toBe(true);
    const auditData = (await audit.json()).data;
    expect(auditData.logs).toBeUndefined();
    expect(Array.isArray(auditData.auditEvents)).toBe(true);
    expect(auditData.auditEvents.length).toBeGreaterThan(0);
    for (const row of auditData.auditEvents) {
      expect(row.eventId).toBeTruthy();
      expect(row.actorPseudonym).toMatch(/^USR-/);
      expect(row.eventHash).toBeUndefined();
      expect(row.entityId).toBeUndefined();
    }

    const accessLogs = await previewReport(request, admin.token, 'access_logs', {});
    expect(accessLogs.ok(), await accessLogs.text()).toBe(true);
    const accessLogsData = (await accessLogs.json()).data;
    expect(accessLogsData.auditEvents).toBeUndefined();
    expect(Array.isArray(accessLogsData.logs)).toBe(true);
  });
});
