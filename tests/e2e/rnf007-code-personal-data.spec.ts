import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { generateValidCpf } from './helpers/cpf';
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

// #1463: real-backend proof of RNF007 AC4 for caller-supplied codes.
// A sample barcode (the label's encodedValue) sent by the caller is refused
// with 422 BARCODE_PERSONAL_DATA when it holds a CPF, an e-mail or the
// participant's name, on create and on update, before anything is written.
// The refusal names the kind of personal data, never the value.
//
// Real backend only -- see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// createRealParticipant names the participant `${NAME_MARKER} <Date.now()>`,
// so `participant` is one of its name parts.
const NAME_MARKER = 'RF004 e2e participant';

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

async function seedBox(): Promise<SeededStorageBox> {
  const seededStorageBox = await seedStorageBoxLocation();
  seededStorageBoxes.push(seededStorageBox);
  return seededStorageBox;
}

test.afterAll(async () => {
  await Promise.all(
    seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
  );
  await closeSeedDb();
});

test.describe('RNF007 AC4 caller-supplied codes carry no personal data — real backend', () => {
  // #1497 (RF004 AC2): the collection these specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`rnf007-code-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
  });

  test('refuses a sample barcode holding a CPF, an e-mail or the participant name with BARCODE_PERSONAL_DATA (RNF007 AC4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealParticipant(request, apiBaseURL!, admin.token);
    // A refused create writes nothing, so one free position serves every attempt.
    const { boxId, positionCode } = await seedBox();

    const barcodes = [generateValidCpf(), `rnf007.${Date.now()}@example.com`, `PARTICIPANT-${Date.now()}`];
    for (const barcode of barcodes) {
      const create = await request.post(`${apiBaseURL}/api/samples`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { participantId, ...validSampleFields(), barcode, boxId, positionCode, collectionId: governed!.collectionId },
      });
      const text = await create.text();
      expect(create.status(), text).toBe(422);
      const body = JSON.parse(text);
      expect(body.error).toBe('BARCODE_PERSONAL_DATA');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      expect(text).not.toContain(NAME_MARKER);

      const lookup = await request.get(`${apiBaseURL}/api/samples/by-barcode/${encodeURIComponent(barcode)}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(lookup.status(), await lookup.text()).toBe(404);
    }
  });

  test('accepts an opaque caller-supplied barcode for the same participant (RNF007 AC4 control)', async ({ request }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedBox();
    const barcode = `E2E1463-${Date.now()}`;

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId, ...validSampleFields(), barcode, boxId, positionCode, collectionId: governed!.collectionId },
    });
    expect([201, 202], await create.text()).toContain(create.status());

    // The create body carries no barcode, so the stored code is read back.
    const lookup = await request.get(`${apiBaseURL}/api/samples/by-barcode/${encodeURIComponent(barcode)}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(lookup.status(), await lookup.text()).toBe(200);
  });

  test('refuses a barcode update holding a CPF with BARCODE_PERSONAL_DATA (RNF007 AC4)', async ({ request }) => {
    const admin = await realLogin(request);
    const { participantId } = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedBox();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId, ...validSampleFields(), boxId, positionCode, collectionId: governed!.collectionId },
    });
    expect([201, 202], await create.text()).toContain(create.status());
    const { specimenId } = (await create.json()).data;

    const update = await request.put(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { barcode: generateValidCpf() },
    });
    const text = await update.text();
    expect(update.status(), text).toBe(422);
    expect(JSON.parse(text).error).toBe('BARCODE_PERSONAL_DATA');
  });
});
