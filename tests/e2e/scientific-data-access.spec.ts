import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  seedStudy,
  seedActiveConsent,
  seedDuoConcept,
  closeSeedDb,
  type SeededStorageBox,
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
  return (await create.json()).data.sampleID;
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
});
