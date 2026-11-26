import { test, expect } from '@playwright/test';
import { SIGNATURE_PNG_DATA_URL } from './helpers/consentSignature';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  closeSeedDb,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
} from './helpers/seedParticipant';
import type { SeededStorageBox } from './helpers/seedParticipant';
import {
  closeNeo4jDriver,
  waitForEthicalConsentStatus,
  waitForSampleGovernedBy,
  readConsentNeighbourhood,
  countTelemetryReadingNodes,
} from './helpers/queryNeo4j';
import { bindSensor, unbindSensor, closeSeedSensorDb } from './helpers/seedSensor';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';
import { MongoClient } from 'mongodb';

// Real backend only, with no request stubbed: every case here reads the live
// API, MongoDB and Neo4j. Moved out of intake-wizard.spec.ts (#1571), whose
// first describe stubs requests. Run via `npm run test:e2e:docker`.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.describe('Participant identity segregation (RF005/RNF007) — real backend (#327, entity+read-path landed in #363)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  const seededBoxes: SeededStorageBox[] = [];
  // RF004 AC2 (#1497): every specimen this describe creates names a governed collection.
  let governedCollection: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governedCollection = await seedGovernedCollection(`intake-identity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  });

  test.afterAll(async () => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governedCollection);
    await closeGovernedCollectionDb();
    await closeSeedDb();
    await closeNeo4jDriver();
    await closeSeedSensorDb();
  });

  // Same signature fields as pipeline-continuity.spec.ts's RF023 describe
  // (normalizeSignaturePayload needs both non-empty).
  async function signConsent(
    request: import('@playwright/test').APIRequestContext,
    token: string,
    participant: { participantId: string; consentTemplateId: string }
  ): Promise<string> {
    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        signatureName: 'RF023 e2e signer',
        signatureImageBase64: SIGNATURE_PNG_DATA_URL,
      },
    });
    expect(response.ok()).toBe(true);
    const consentId = String((await response.json())?.data?._id || '');
    expect(consentId).toBeTruthy();
    return consentId;
  }

  // The body of pipeline-continuity.spec.ts's createSampleMongoId; returns the
  // sample's Mongo _id, the outbox aggregateId and graph key of its events.
  async function createSampleMongoId(
    request: import('@playwright/test').APIRequestContext,
    token: string,
    participantId: string
  ): Promise<string> {
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RNF007 AC3 #1503 identity-segregation e2e fixture',
        registeredAt: new Date().toISOString(),
        collectionId: governedCollection!.collectionId,
        boxId: box.boxId,
        positionCode: box.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId;
    const read = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(read.status()).toBe(200);
    return String((await read.json()).data._id);
  }

  // dict-07_ALINHAMENTO_CODIGO.md row 1 / migration table row 2: the
  // target model requires patientName/birthDate/identityDocument to live
  // in a segregated ParticipantIdentity entity, not as direct fields on
  // the scientific Participant record — "Segregar, cifrar e não projetar
  // ao grafo". #363 landed the ParticipantIdentity entity/collection and
  // stripped these fields from GET /api/patients/:id's response; the
  // Patient document itself still carries them internally pending a
  // larger follow-up migrating its other ~20 consumers off it.
  test('AC#1/AC#2: patientName/birthDate are not returned as direct fields on the participant resource', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const get = await request.get(`${apiBaseURL}/api/patients/${participant.participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(get.status()).toBe(200);
    const resource = (await get.json()).data;

    // AC#1: participantId is the canonical research identifier — it must
    // still be present on the participant resource.
    expect(resource.participantId).toBeTruthy();

    // AC#2: civil identity (name, exact birth date, contacts, civil
    // identifiers) belongs in ParticipantIdentity under reinforced
    // controls, not as direct fields alongside the scientific record.
    expect(resource.patientName).toBeUndefined();
    expect(resource.birthDate).toBeUndefined();
    expect(resource.identityDocument).toBeUndefined();
  });

  // RNF007 AC#3 / RNF028 C2 (#1503): ParticipantIdentity is never projected
  // to Neo4j. The participant gets a signed consent and one sample, so the
  // outbox holds a CONSENT_UPSERTED and a SPECIMEN_UPSERTED event that name
  // them, and the worker has projected both (the sample is GOVERNED_BY the
  // consent in the graph). Neither the outbox payloads nor the consent node
  // and every node within two hops of it carry an identity key, nor the name
  // or birth date createRealParticipant wrote.
  // RF023 AC9: no civil identity or PII reaches the outbox or the graph.
  test('AC#3: no participant identity fields appear in the Neo4j-facing outbox payload', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const participantId = participant.participantId;
    const consentId = await signConsent(request, admin.token, participant);
    const sampleMongoId = await createSampleMongoId(request, admin.token, participantId);

    await waitForSampleGovernedBy(sampleMongoId, consentId);

    // No API surface exists to inspect the outbox (same gap
    // seedParticipant.ts documents for consent/location fixtures) — read
    // the `graph_projection_outbox` collection directly, the same one
    // neo4jOutbox.service.js's COLLECTION_NAME writes to.
    const client = new MongoClient(mongoUri);
    await client.connect();
    try {
      const events = await client
        .db(mongoDbName)
        .collection('graph_projection_outbox')
        .find({
          $or: [
            { aggregateId: participantId },
            { 'payload.participantId': participantId },
            { aggregateId: { $in: [consentId, sampleMongoId] } },
          ],
        })
        .toArray();

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.aggregateType === 'Sample' && e.eventType === 'SPECIMEN_UPSERTED')).toBe(true);
      expect(events.some((e) => e.aggregateType === 'EthicalConsent')).toBe(true);

      for (const event of events) {
        const serialized = JSON.stringify(event.payload || {});
        expect(serialized).not.toMatch(/patientName/);
        expect(serialized).not.toMatch(/birthDate/);
        expect(serialized).not.toMatch(/identityDocument/);
        expect(serialized).not.toContain('RF004 e2e participant');
        expect(serialized).not.toContain('1990-01-01');
      }
    } finally {
      await client.close();
    }

    const neighbourhood = await readConsentNeighbourhood(consentId);
    expect(neighbourhood.consent).not.toBeNull();
    const graphJson = JSON.stringify([neighbourhood.consent, ...neighbourhood.neighbours]);
    for (const forbidden of ['patientName', 'birthDate', 'identityDocument', 'RF004 e2e participant', '1990-01-01']) {
      expect(graphJson).not.toContain(forbidden);
    }
  });

  // RNF019 C8 (#1503): raw telemetry stays in InfluxDB. A reading posted
  // through the ingest endpoint appends no outbox event and reaches no graph
  // node. The consent signed after it, once ACTIVE in Neo4j, shows the worker
  // drained the outbox past the reading, so the zero counts are not a race.
  // RF023 AC9: no raw TelemetryReading is projected.
  test('AC#3 (RNF019 C8): a raw telemetry reading reaches neither the outbox nor Neo4j', async ({ request }) => {
    const sensorId = `rnf019-c8-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await bindSensor(sensorId);
    try {
      // machineIngestGate.js fails closed on a missing/mismatched secret.
      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: { 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' },
        data: { sensorId, temperature: -47.5, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);
      const { telemetryReadingId } = await reading.json();
      expect(telemetryReadingId).toBeTruthy();

      const admin = await realLogin(request);
      const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
      const consentId = await signConsent(request, admin.token, participant);
      await waitForEthicalConsentStatus(consentId, 'ACTIVE');

      const client = new MongoClient(mongoUri);
      await client.connect();
      try {
        const outboxCount = await client
          .db(mongoDbName)
          .collection('graph_projection_outbox')
          .countDocuments({
            $or: [
              { aggregateType: 'TelemetryReading' },
              { aggregateId: telemetryReadingId },
              { 'payload.telemetryReadingId': telemetryReadingId },
              { 'payload.sensorId': sensorId },
            ],
          });
        expect(outboxCount).toBe(0);
      } finally {
        await client.close();
      }

      expect(await countTelemetryReadingNodes(String(telemetryReadingId), sensorId)).toBe(0);
    } finally {
      await unbindSensor(sensorId);
    }
  });
});
