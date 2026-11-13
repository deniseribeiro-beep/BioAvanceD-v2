import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { SIGNATURE_PNG_DATA_URL } from './helpers/consentSignature';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { createRealParticipant, seedStudy, closeSeedDb } from './helpers/seedParticipant';
import { findOrganizationInList } from './helpers/listOrganizations';

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
  // ethicsApprovalId (#588, RF021 AC#3/ELM-0060) is required on Study.
  { path: 'studies', singular: 'study', idField: 'studyId', nameField: 'studyTitle', extraFields: { ethicsApprovalId: ['CAAE-e2e-crud'] } },
  // effectivePeriod (#588, RF021 AC#3/ELM-0072) is required on Protocol.
  { path: 'protocols', singular: 'protocol', idField: 'protocolId', nameField: 'protocolName', extraFields: { effectivePeriod: { start: '2026-01-01' }, protocolType: 'processing', protocolVersion: '1.0', documentUri: 'object://protocols/e2e-crud.pdf' } },
  // governanceRegime (RF004 AC2, V2E-0427) is required on Collection.
  { path: 'collections', singular: 'collection', idField: 'collectionId', nameField: 'collectionName', extraFields: { governanceRegime: 'biobank' } },
];

for (const { path, singular, idField, nameField, extraFields } of entities) {
  test.describe(`${path} CRUD (#320)`, () => {
    test(`creates, lists, fetches and updates a ${singular}`, async ({ request }) => {
      const admin = await realLogin(request);
      const id = `${path}-${Date.now()}`;

      const createResponse = await request.post(`${apiBaseURL}/api/${path}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { [idField]: id, [nameField]: `e2e ${path} ${id}`, ...extraFields },
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
        data: { [idField]: `${path}-${Date.now()}-invalid`, ...extraFields },
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

// #326 (RF021, narrowed — see issue comment: full ethics/versioning scope
// split out to #578, then #588-#592). #588 added Study.ethicsApprovalId
// and Protocol.effectivePeriod (asserted by the generic CRUD loop above,
// via extraFields); this block covers the remaining gap: protocolVersion/
// approvalStatus round-trip through create — the fields exist and persist,
// just weren't asserted by the generic protocols CRUD loop above.
test.describe('protocol version/approvalStatus round-trip (#326)', () => {
  test('persists protocolVersion and approvalStatus through create', async ({ request }) => {
    const admin = await realLogin(request);
    const id = `protocols-version-${Date.now()}`;

    const createResponse = await request.post(`${apiBaseURL}/api/protocols`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        protocolId: id,
        protocolName: `e2e protocol ${id}`,
        protocolVersion: '2.1',
        protocolType: 'processing',
        documentUri: 'object://protocols/e2e-version.pdf',
        approvalStatus: 'rejected',
        effectivePeriod: { start: '2026-01-01' },
      },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.data.protocolVersion).toBe('2.1');
    expect(created.data.approvalStatus).toBe('rejected');

    const getResponse = await request.get(`${apiBaseURL}/api/protocols/${id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(getResponse.status()).toBe(200);
    const fetched = await getResponse.json();
    expect(fetched.data.protocolVersion).toBe('2.1');
    expect(fetched.data.approvalStatus).toBe('rejected');
  });
});

// #1535 (RF021 AC1): the backend generates studyId and protocolId when the
// caller sends none, and versions a protocol by its required protocolVersion
// (a single controlled version string, not a supersession chain: #589).
test.describe('study and protocol identifiers and protocol version (RF021 AC1)', () => {
  test('generates studyId and protocolId, requires a protocolVersion and records a revised one', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const study = await request.post(`${apiBaseURL}/api/studies`, {
      headers,
      data: { studyTitle: `e2e RF021 AC1 study ${run}`, ethicsApprovalId: [`CAAE-e2e-rf021-ac1-${run}`] },
    });
    expect(study.status(), await study.text()).toBe(201);
    const studyId = (await study.json()).data.studyId as string;
    expect(studyId).toMatch(uuid);
    const fetchedStudy = await request.get(`${apiBaseURL}/api/studies/${studyId}`, { headers });
    expect(fetchedStudy.status(), await fetchedStudy.text()).toBe(200);
    expect((await fetchedStudy.json()).data.studyId).toBe(studyId);

    const protocolFields = {
      protocolName: `e2e RF021 AC1 protocol ${run}`,
      protocolType: 'processing',
      documentUri: 'object://protocols/e2e-rf021-ac1-v1.0.pdf',
      effectivePeriod: { start: '2026-01-01' },
    };
    const unversioned = await request.post(`${apiBaseURL}/api/protocols`, { headers, data: protocolFields });
    expect(unversioned.status(), await unversioned.text()).toBe(422);

    const protocol = await request.post(`${apiBaseURL}/api/protocols`, { headers, data: { ...protocolFields, protocolVersion: '1.0' } });
    expect(protocol.status(), await protocol.text()).toBe(201);
    const protocolId = (await protocol.json()).data.protocolId as string;
    expect(protocolId).toMatch(uuid);
    expect(protocolId).not.toBe(studyId);

    const revised = await request.put(`${apiBaseURL}/api/protocols/${protocolId}`, {
      headers,
      data: { protocolVersion: '1.1', documentUri: 'object://protocols/e2e-rf021-ac1-v1.1.pdf' },
    });
    expect(revised.status(), await revised.text()).toBe(200);
    const blanked = await request.put(`${apiBaseURL}/api/protocols/${protocolId}`, { headers, data: { protocolVersion: '  ' } });
    expect(blanked.status(), await blanked.text()).toBe(422);

    const fetched = await request.get(`${apiBaseURL}/api/protocols/${protocolId}`, { headers });
    expect(fetched.status(), await fetched.text()).toBe(200);
    expect((await fetched.json()).data).toMatchObject({
      protocolId,
      protocolVersion: '1.1',
      documentUri: 'object://protocols/e2e-rf021-ac1-v1.1.pdf',
    });
  });
});

// #325 (RF020, narrowed — see issue comment: full MIABIS-institutional
// scope split out to #576 since organization.routes.js has no PUT/DELETE
// and Collection is Fase-1-only). Covers create + list via
// /api/organizations; GET /:id and DELETE /:id have since landed and serve
// the read-back and the cleanup (#1279).
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
    const organizationId = created.data.organizationId as string;

    try {
      await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

      const getResponse = await request.get(`${apiBaseURL}/api/organizations/${organizationId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(getResponse.status()).toBe(200);
      expect((await getResponse.json()).data.officialName).toBe(officialName);

      // #1279: the list is sorted by officialName and paged, and the test
      // volume persists across runs. At the default page this fixture fell
      // past row 100 once other specs' organizations sorted ahead of it.
      // Page through the list (#1282), and delete the fixture below so this
      // spec stops adding to the count.
      const listed = await findOrganizationInList(request, apiBaseURL!, admin.token,
        (item) => item.organizationId === organizationId);
      expect(listed).toBeTruthy();
    } finally {
      await request.delete(`${apiBaseURL}/api/organizations/${organizationId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }).catch(() => {});
    }
  });

  test('rejects creating an organization missing its required countryCode', async ({ request }) => {
    const admin = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `e2e org invalid ${Date.now()}` },
    });

    // 422, not 400, since 6da2bf31 (#884) made model-validation failures
    // answer 422 repo-wide. This assertion was left on the old status and has
    // been red on every e2e gate run since 2026-09-02; the product is correct
    // and the spec was stale.
    expect(response.status()).toBe(422);
  });
});

// #578 (RF021, narrowed) -> #587 tracker -> #590 (split into
// #593/#594) -> #596. Study/consent/participant linkage (#593/#594) already
// has unit coverage but no real-backend proof; this covers both the
// existence-must-resolve requirement (#593/#594's own scope) and the
// inactive-study rejection (#596's, mirroring #591's Sample-side proof in
// specimen-quality-inventory.spec.ts).
test.describe('Consent/patient study linkage (RF021 AC#4/AC#5) — #593, #594, #596', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('rejects linking a consent to a study that does not exist', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        studyId: 'does-not-exist',
        signatureName: 'e2e signer',
        signatureImageBase64: SIGNATURE_PNG_DATA_URL,
      },
    });

    // consent.controller.js's catch: res.status(error.statusCode || 400) —
    // the not-found path throws a plain Error with no statusCode set.
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/studyId/);
  });

  test('rejects linking a consent to a study that is not active (#596)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const studyId = `study-consent-inactive-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'withdrawn' });

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        studyId,
        signatureName: 'e2e signer',
        signatureImageBase64: SIGNATURE_PNG_DATA_URL,
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/não está ativo/);
  });

  test('links a consent to a study that resolves and is active', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const studyId = `study-consent-active-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'active' });

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        studyId,
        signatureName: 'e2e signer',
        signatureImageBase64: SIGNATURE_PNG_DATA_URL,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.studyId).toBe(studyId);
  });

  test('rejects creating a patient linked to a study that is not active (#596)', async ({ request }) => {
    const admin = await realLogin(request);
    const studyId = `study-patient-inactive-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'closed-to-accrual' });

    // Mirrors createRealParticipant's own consent-template seed step, just
    // inlined so this test can also pass studyId on the create call itself.
    const { consentTemplateId } = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/patients`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: 'placeholder',
        patientName: `e2e patient ${Date.now()}`,
        birthDate: '1990-01-01',
        sex: 'F',
        consentTemplateId,
        studyId,
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.message || body.error).toMatch(/não está ativo/);
  });

  test('links a patient to a study that resolves and is active', async ({ request }) => {
    const admin = await realLogin(request);
    const studyId = `study-patient-active-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'active' });

    const { consentTemplateId } = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/patients`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: 'placeholder',
        patientName: `e2e patient ${Date.now()}`,
        birthDate: '1990-01-01',
        sex: 'F',
        consentTemplateId,
        studyId,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    // The create response deliberately echoes back only participantId (LGPD
    // — paciente.controller.js#cadastrar) — fetch the persisted record to
    // confirm studyId actually landed.
    const participantId = body.data.participantId;
    expect(participantId).toBeTruthy();

    const get = await request.get(`${apiBaseURL}/api/patients/${participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(get.status()).toBe(200);
    const persisted = await get.json();
    expect(persisted.data.studyId).toBe(studyId);
  });
});
