import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// Real-backend proof for two RF008 report defects.
//
// #748 (AC#1): #739 wired period, collection, type, origin and location into
// the sample query and #732 publishes them per report type, but
// ReportQueryPage rendered none of them. The page now renders the dimensions
// the type's catalog lists, and an export sends them.
//
// #1077: the export catalog bounded the CSV only; the stored Report that
// POST /generate persists carried the raw custody-ledger rows, operator
// user agent and ledger hashes included.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

function validSampleFields(sampleType: string, linkedProject: string) {
  return {
    sampleType,
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject,
    registeredAt: new Date().toISOString(),
  };
}

test.describe('RF008 report filters and bounded report data (#748, #1077) — real backend', () => {
  const seededBoxes: SeededStorageBox[] = [];
  // #1497 (RF004 AC2): the collection these specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`rf008-report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('#748: the samples query page filters an export by storage box and sample type', async ({ page, request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);

    const plasmaBox = await seedStorageBoxLocation();
    const serumBox = await seedStorageBoxLocation();
    seededBoxes.push(plasmaBox, serumBox);

    // The create response names the Mongo _id, which the export catalog does
    // not carry, so each specimen is found in the CSV by a per-run
    // linkedProject tag -- a catalog column.
    const runTag = `RF008 #748 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createSample = async (sampleType: string, box: SeededStorageBox) => {
      const linkedProject = `${runTag} ${sampleType}`;
      const res = await request.post(`${apiBaseURL}/api/samples`, {
        headers: auth,
        data: {
          participantId: participant.participantId,
          ...validSampleFields(sampleType, linkedProject),
          boxId: box.boxId,
          positionCode: box.positionCode,
          collectionId: governed!.collectionId,
        },
      });
      expect([201, 202], await res.text()).toContain(res.status());
      return linkedProject;
    };
    const plasmaSample = await createSample('PLASMA', plasmaBox);
    const serumSample = await createSample('SERUM', serumBox);

    await seedRealAuth(page, admin);
    await page.goto('/reports/query/samples');

    const inventory = page.locator('.report-query-section-card', { hasText: 'Inventário' });
    await expect(inventory).toBeVisible();
    for (const label of ['Coleção', 'Tipo de amostra', 'Origem', 'Caixa de armazenamento', 'Posição na caixa']) {
      await expect(inventory.getByText(label, { exact: true })).toBeVisible();
    }

    const exportCsv = async () => {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Exportar' }).click();
      const download = await downloadPromise;
      return readFile((await download.path())!, 'utf-8');
    };

    // #1215: the location filter is a freezer-then-box picker built from
    // GET /storage/freezers and the freezer's tree, not a text box for an id.
    const pickBox = async (box: SeededStorageBox) => {
      await inventory.getByLabel('Caixa de armazenamento — freezer', { exact: true }).selectOption(box.freezerId);
      await inventory.getByLabel('Caixa de armazenamento', { exact: true }).selectOption(box.boxId);
    };

    // The box filter narrows the export to the one box's specimen.
    await pickBox(plasmaBox);
    const byBox = await exportCsv();
    expect(byBox).toContain(plasmaSample);
    expect(byBox).not.toContain(serumSample);

    // The type select sends the MIABIS ID. PLASMA's specimen does not match
    // SERUM, so the same box now exports nothing.
    await inventory.getByLabel('Tipo de amostra').selectOption({ label: 'Soro' });
    const byBoxAndType = await exportCsv();
    expect(byBoxAndType).not.toContain(plasmaSample);
    expect(byBoxAndType.split('\n')[0]).toBe('total,message');

    // Control: the serum box with the serum type exports its specimen, so the
    // empty result above is the filter, not a broken export.
    await pickBox(serumBox);
    const serumExport = await exportCsv();
    expect(serumExport).toContain(serumSample);
  });

  // #1214: the page used to pick sections from hardcoded key sets, so these
  // two types offered SPREC and clinical filters their handlers never read.
  // With the live catalog loaded, withdrawal history offers only its period,
  // and results -- whose handler reads no filter -- offers none.
  test('#1214: report types render only the filters their handler reads', async ({ page, request }) => {
    const admin = await realLogin(request);
    await seedRealAuth(page, admin);

    await page.goto('/reports/query/withdrawalHistory');
    const inventory = page.locator('.report-query-section-card', { hasText: 'Inventário' });
    await expect(inventory.getByText('Data inicial', { exact: true })).toBeVisible();
    await expect(page.getByText('Relatório de Amostras / Qualidade')).toHaveCount(0);
    await expect(page.getByText('Filtro SPREC - Matriz')).toHaveCount(0);

    await page.goto('/reports/query/results');
    await expect(page.getByText('Nenhum filtro específico foi definido para este relatório.', { exact: false })).toBeVisible();
    await expect(page.getByText('Relatório de Pacientes / Clínico')).toHaveCount(0);

    // Control: the samples page still offers the grade select, now sending
    // the key the backend reads.
    await page.goto('/reports/query/samples');
    await expect(page.getByLabel('Filtro RCS-GOV - Grade final')).toBeVisible();
  });

  // #735 (RF008 AC#6): a template created through the templates API was
  // stored and editable but never listed on the report menu, so it could not
  // generate anything. It is now a card that opens its own query page,
  // grouped as its handler's system type.
  test('#735: a custom report template is selectable on the menu and exports through its handler', async ({ page, request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const code = `e2e_735_${suffix}`;
    const name = `Inventário e2e ${suffix}`;

    const created = await request.post(`${apiBaseURL}/api/report-templates`, {
      headers: auth,
      data: { code, name, description: 'Modelo criado pelo teste #735.', handlerKey: 'sample' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const templateId = (await created.json()).data._id;

    try {
      await seedRealAuth(page, admin);
      await page.goto('/reports');
      const card = page.locator('.report-card', { hasText: name });
      await expect(card).toBeVisible();
      await expect(card.getByText('Modelo criado pelo teste #735.')).toBeVisible();
      await card.getByRole('button').click();
      await expect(page).toHaveURL(new RegExp(`/reports/query/${code}$`));

      // Labelled from the template, with the sample handler's sections.
      await expect(page.getByText(name).first()).toBeVisible();
      await expect(page.getByLabel('Filtro RCS-GOV - Grade final')).toBeVisible();
      const inventory = page.locator('.report-query-section-card', { hasText: 'Inventário' });
      await expect(inventory.getByText('Caixa de armazenamento', { exact: true })).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Exportar' }).click();
      const csv = await readFile((await (await downloadPromise).path())!, 'utf-8');
      // The sample handler's declared columns, or its no-data fallback.
      const header = csv.split('\n')[0];
      expect(header === 'total,message' || header.split(',').includes('specimenId'), header).toBe(true);
    } finally {
      await request.delete(`${apiBaseURL}/api/report-templates/${templateId}`, { headers: auth });
    }
  });

  test('#1077: a generated withdrawal report stores no operator user agent, identity or ledger hash', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);

    const linkedProject = `RF008 #1077 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: auth,
      data: {
        participantId: participant.participantId,
        ...validSampleFields('PLASMA', linkedProject),
        boxId: box.boxId,
        positionCode: box.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202], await create.text()).toContain(create.status());
    const created = (await create.json()).data;
    // #1216: the create response names the specimen by its canonical
    // specimenId only, and the sample routes resolve it.
    const specimenId = created.specimenId as string;
    expect(specimenId).toBeTruthy();

    const leakyAgent = `e2e-1077-leaky-agent-${Date.now()}`;
    const withdraw = await request.post(`${apiBaseURL}/api/samples/${specimenId}/withdraw`, {
      headers: { ...auth, 'User-Agent': leakyAgent },
      data: { withdrawalType: 'Total', withdrawalResponsible: 'E2E 1077 Responsible', linkedProject },
    });
    expect(withdraw.status(), await withdraw.text()).toBe(200);

    const generate = await request.post(`${apiBaseURL}/api/reports/generate`, {
      headers: auth,
      data: { reportType: 'withdrawal_history' },
    });
    expect(generate.status(), await generate.text()).toBe(201);
    const reportID = (await generate.json()).reportID as number;

    // Read the stored document back, the surface a later reader gets.
    const stored = await request.get(`${apiBaseURL}/api/reports/${reportID}`, { headers: auth });
    expect(stored.status()).toBe(200);
    const reportData = JSON.parse((await stored.json()).reportData);
    const rows = reportData.withdrawals as Array<Record<string, unknown>>;

    // CONTROL: the ledger row is really in the stored report. It is found by
    // this run's linkedProject: the ledger's specimenId is the specimen's
    // business id, not the Mongo _id the create response returns.
    const row = rows.find((entry) => entry.linkedProject === linkedProject);
    expect(row, JSON.stringify(rows.slice(0, 3))).toBeTruthy();
    // #1216: the specimenId the create response returned is the one the
    // ledger, and so the report, carries.
    expect(row!.specimenId).toBe(specimenId);

    expect(JSON.stringify(reportData)).not.toContain(leakyAgent);
    for (const column of ['userAgent', 'ipAddress', 'userId', 'userName', 'responsible', 'hash', 'previousHash', '_id']) {
      expect(Object.keys(row!)).not.toContain(column);
    }
  });
});
