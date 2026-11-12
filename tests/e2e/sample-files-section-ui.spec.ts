import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
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

// Real-backend proof for #647: SampleFilesSection.tsx (RF007's file-upload
// UI) existed but was never imported/mounted anywhere in the app --
// scientific-data-access.spec.ts already proves RF007 AC#3-7 at the API
// layer, but there was no path proving an operator can actually reach this
// through the running app. This mirrors organization-collection-management-
// ui.spec.ts's shape (#608): drive the real component, against the real
// backend, through SampleDetailsPage where it's now mounted.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF007 UI e2e fixture project',
    registeredAt: new Date().toISOString(),
  };
}

let seededStorageBox: SeededStorageBox | null = null;
// #1497 (RF004 AC2): the collection createRealSample's specimen enters.
let governed: GovernedCollection | null = null;

test.beforeAll(async () => {
  governed = await seedGovernedCollection(`rf007-files-ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
});

async function createRealSample(request: any, token: string): Promise<string> {
  const participant = await createRealParticipant(request, apiBaseURL!, token);
  seededStorageBox = await seedStorageBoxLocation();
  const { boxId, positionCode } = seededStorageBox;

  const create = await request.post(`${apiBaseURL}/api/samples`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      participantId: participant.participantId,
      ...validSampleFields(),
      boxId,
      positionCode,
      collectionId: governed!.collectionId,
    },
  });
  expect([201, 202]).toContain(create.status());
  // #1216: the POST handler names the new specimen by its canonical
  // specimenId, which SampleDetailsPage's `/samples/:id` route and the
  // sample-file routes both resolve.
  return (await create.json()).data.specimenId;
}

test.afterAll(async () => {
  if (seededStorageBox) {
    await cleanupStorageBoxLocation(seededStorageBox).catch(() => {});
  }
  await cleanupGovernedCollection(governed);
  await closeGovernedCollectionDb();
  await closeSeedDb();
});

test.describe('Scientific files (RF007) through the real UI (#647)', () => {
  test('uploads, downloads and deletes a scientific file via SampleDetailsPage', async ({ page, request }) => {
    let session;
    try {
      session = await realLogin(request);
    } catch (err: any) {
      console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
      return;
    }
    await seedRealAuth(page, session);

    const sampleID = await createRealSample(request, session.token);
    const fileContent = Buffer.from('RF007 UI e2e raw scientific data payload — deterministic bytes');
    const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');
    const fileName = `rf007-ui-e2e-${Date.now()}.csv`;

    await page.goto(`/samples/${sampleID}`);
    await expect(page.getByTestId('sample-detail-page-title')).toBeVisible();

    await page.getByTestId('sample-files-open-upload-button').click();
    await page.getByTestId('file-upload-input').setInputFiles({
      name: fileName,
      mimeType: 'text/csv',
      buffer: fileContent,
    });
    await page.getByTestId('sample-files-upload-submit').click();
    await expect(page.getByTestId('sample-files-upload-submit')).not.toBeVisible();
    await expect(page.getByText(fileName, { exact: true })).toBeVisible();

    // Real-backend proof the upload actually persisted through the UI path,
    // not just that the row rendered — same checksum/URI shape
    // scientific-data-access.spec.ts proves at the API layer directly.
    const listResponse = await request.get(`${apiBaseURL}/api/samples/${sampleID}/files`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(listResponse.ok()).toBeTruthy();
    const listBody = await listResponse.json();
    const uploaded = listBody.data.find((f: any) => f.fileName === fileName);
    expect(uploaded).toBeTruthy();
    expect(uploaded.checksum).toBe(expectedChecksum);
    expect(uploaded.uri).toMatch(/^objstore:\/\/samples\//);
    // dict-02 ELM-0317/ELM-0319 (#679): the upload form doesn't expose a
    // fileRole control, so the default ('raw') and the fileType-derived
    // MIME fileFormat prove the real upload path populates both.
    expect(uploaded.fileRole).toBe('raw');
    expect(uploaded.fileFormat).toBe('text/csv');
    const fileID = uploaded._id;

    // Download round-trip through the real UI click, not a direct API call.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`sample-file-download-button-${fileID}`).click(),
    ]);
    expect(download.suggestedFilename()).toBe(fileName);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`sample-file-delete-button-${fileID}`).click();
    await expect(page.getByText(fileName, { exact: true })).not.toBeVisible();

    const afterDelete = await request.get(`${apiBaseURL}/api/samples/${sampleID}/files`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(afterDelete.ok()).toBeTruthy();
    const afterDeleteBody = await afterDelete.json();
    expect(afterDeleteBody.data.find((f: any) => f._id === fileID)).toBeUndefined();
  });
});
