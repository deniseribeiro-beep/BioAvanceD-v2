import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createEdgeBuffer, httpSender, canonicalJson } from '../../api/backend/scripts/telemetry-edge-buffer';
import { bindSensor, unbindSensor, closeSeedSensorDb } from './helpers/seedSensor';
import { queryFreezerReadingIds, queryTemperaturePointFields, queryTemperatureRevisions } from './helpers/queryInflux';
import { realLogin } from './helpers/realAuth';
import { generateValidCpf } from './helpers/cpf';
import { findTelemetryIngestionEvent, closeIngestionDb } from './helpers/queryIngestion';

// Real-backend proof of RNF004 C1/C2 (#1392): the device's durable edge
// buffer keeps each reading on disk until the backend confirms it, and a
// reading whose answer was lost is resent with its stored body, so the
// backend answers it as a replay and InfluxDB holds it once.
// #1518: each entry carries its provenance fields (RNF004 C1), the buffer
// drains in sequence order whatever the device clock says, a late arrival
// included (RNF004 C3), and the server keeps the sequenceNumber and its own
// receivedAt beside the device time, so the clock is not the only order
// (RNF025 C7).
// A late correction of a stored reading is kept beside it, never over it,
// the history reads the correction alone and the original stays readable
// by its id; an identical resend is no correction (RNF025 C8).
// A reading carrying personal data never enters the buffer, so none reaches
// the device's disk or the server (RNF004 C7).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Telemetry edge buffer (#1392, RNF004 C1/C2) — real backend', () => {
  const sensorId = `rnf004-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orderSensorId = `rnf004-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const correctionSensorId = `rnf025-correction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resendSensorId = `rnf025-resend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const piiSensorId = `rnf004-pii-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  test.afterAll(async () => {
    await unbindSensor(sensorId).catch(() => {});
    await unbindSensor(orderSensorId).catch(() => {});
    await unbindSensor(correctionSensorId).catch(() => {});
    await unbindSensor(resendSensorId).catch(() => {});
    await unbindSensor(piiSensorId).catch(() => {});
    await closeSeedSensorDb().catch(() => {});
    await closeIngestionDb().catch(() => {});
  });

  test('a reading whose answer was lost stays buffered, and the next drain persists all three exactly once', async ({}, testInfo) => {
    // TELEMETRY_BINDING_MODE=enforce refuses an unbound sensor's reading.
    await bindSensor(sensorId);

    const dir = testInfo.outputPath('edge-buffer');
    const buffer = createEdgeBuffer({ dir, deviceId: sensorId });
    const now = Date.now();
    const entries = [-3, -2, -1].map((offsetSeconds, index) => buffer.enqueue({
      sensorId, temperature: -75 - index, timestamp: new Date(now + offsetSeconds * 1000).toISOString(),
    }));
    expect(entries.map((entry) => entry.sequenceNumber)).toEqual([0, 1, 2]);

    const answers: any[] = [];
    const send = httpSender({
      endpoint: `${apiBaseURL}/api/iot/telemetry`,
      secret: process.env.TELEMETRY_INGEST_SECRET,
      fetchImpl: async (url: string, init: RequestInit) => {
        const response = await fetch(url, init);
        answers.push(await response.clone().json());
        return response;
      },
    });

    // The first send reaches the backend, which persists it, but its answer
    // is lost on the way back.
    let lost = false;
    const lossy = async (body: Record<string, unknown>) => {
      const answer = await send(body);
      if (!lost) {
        lost = true;
        throw new Error('answer lost');
      }
      return answer;
    };

    const failed = await buffer.drain(lossy);
    expect(failed).toEqual({ acked: 0, deadLettered: 0, retained: 3, stoppedOn: 'error' });
    expect(buffer.pending().map((entry) => entry.sequenceNumber)).toEqual([0, 1, 2]);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ success: true, accepted: true });
    expect(answers[0].replayed).toBeUndefined();

    const drained = await buffer.drain(lossy);
    expect(drained).toEqual({ acked: 3, deadLettered: 0, retained: 0, stoppedOn: null });
    expect(answers).toHaveLength(4);
    // RNF004 C2: the resend carries the stored idempotencyKey, so it is the
    // first reading's replay, not a second write.
    expect(answers[1]).toMatchObject({ replayed: true, telemetryReadingId: answers[0].telemetryReadingId });
    expect(answers[2].replayed).toBeUndefined();
    expect(answers[3].replayed).toBeUndefined();

    expect(buffer.pending()).toEqual([]);
    expect(buffer.deadLetters()).toEqual([]);
    expect(fs.readdirSync(`${dir}/pending`)).toEqual([]);

    const persistedIds = [answers[0], answers[2], answers[3]].map((answer) => answer.telemetryReadingId);
    await expect
      .poll(async () => (await queryFreezerReadingIds(sensorId, 10, 'temperature')).map((point) => point.telemetryReadingId).sort(), { timeout: 15_000 })
      .toEqual([...persistedIds].sort());
    const points = await queryFreezerReadingIds(sensorId, 10, 'temperature');
    expect(points.map((point) => new Date(point.time).toISOString()).sort()).toEqual(entries.map((entry) => entry.observedAt));
  });

  test('entries carry their provenance, drain in sequence order whatever the device clock says, and the server keeps sequence and receipt beside it (#1518)', async ({}, testInfo) => {
    await bindSensor(orderSensorId);

    const dir = testInfo.outputPath('edge-order');
    const buffer = createEdgeBuffer({ dir, deviceId: orderSensorId });
    const now = Date.now();
    // The device time runs backwards against the sequence; the last reading
    // was observed 20 min before it reaches the server (a late arrival).
    const deviceTimes = [now - 1_000, now - 3_000, now - 20 * 60_000];
    const entries = deviceTimes.map((t, index) => buffer.enqueue({
      sensorId: orderSensorId, temperature: -75 - index, timestamp: new Date(t).toISOString(),
    }));

    // RNF004 C1: before any send, each entry is on disk with its provenance.
    entries.forEach((entry, index) => {
      const stored = JSON.parse(fs.readFileSync(`${dir}/pending/${String(entry.sequenceNumber).padStart(12, '0')}.json`, 'utf8'));
      expect(stored).toEqual(entry);
      expect(entry.sourceEventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(entry.deviceId).toBe(orderSensorId);
      expect(entry.observedAt).toBe(entry.body.timestamp);
      expect(entry.sequenceNumber).toBe(index);
      expect(entry.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.payloadHash).toBe(createHash('sha256').update(canonicalJson(entry.body)).digest('hex'));
    });

    const sent: any[] = [];
    const answers: any[] = [];
    const send = httpSender({
      endpoint: `${apiBaseURL}/api/iot/telemetry`,
      secret: process.env.TELEMETRY_INGEST_SECRET,
      fetchImpl: async (url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string));
        const response = await fetch(url, init);
        answers.push(await response.clone().json());
        return response;
      },
    });

    const drained = await buffer.drain(send);
    expect(drained).toEqual({ acked: 3, deadLettered: 0, retained: 0, stoppedOn: null });

    // RNF004 C3: sent in sequence order while the device time decreases.
    expect(sent.map((body) => body.sequenceNumber)).toEqual([0, 1, 2]);
    const sentTimes = sent.map((body) => new Date(body.timestamp).getTime());
    expect(sentTimes[1]).toBeLessThan(sentTimes[0]);
    expect(sentTimes[2]).toBeLessThan(sentTimes[1]);
    expect(answers).toHaveLength(3);
    for (const answer of answers) expect(answer).toMatchObject({ success: true, accepted: true });
    // The late reading is past the clock-skew tolerance: flagged, still stored.
    expect(answers.map((answer) => answer.clockStatus)).toEqual(['synchronized', 'synchronized', 'drift']);
    for (let index = 1; index < answers.length; index += 1) {
      expect(new Date(answers[index].receivedAt).getTime()).toBeGreaterThanOrEqual(new Date(answers[index - 1].receivedAt).getTime());
    }

    // RNF025 C3: the server's receivedAt is kept apart from the device's observedAt, the point's time.
    // RNF025 C7: InfluxDB keeps the sequence and the server's receipt time
    // beside the device time.
    await expect
      .poll(async () => (await queryTemperaturePointFields(orderSensorId, 60)).length, { timeout: 15_000 })
      .toBe(3);
    const points = await queryTemperaturePointFields(orderSensorId, 60);
    // The device clock alone would order them backwards.
    expect(points.map((point) => point.sequenceNumber)).toEqual([2, 1, 0]);

    const bySequence = [...points].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
    expect(bySequence.map((point) => point.sequenceNumber)).toEqual([0, 1, 2]);
    const receivedTimes = bySequence.map((point) => new Date(point.receivedAt as string).getTime());
    expect(receivedTimes[1]).toBeGreaterThanOrEqual(receivedTimes[0]);
    expect(receivedTimes[2]).toBeGreaterThanOrEqual(receivedTimes[1]);
    expect(bySequence.map((point) => new Date(point.receivedAt as string).toISOString()))
      .toEqual(answers.map((answer) => new Date(answer.receivedAt).toISOString()));
    expect(bySequence.map((point) => point.telemetryReadingId))
      .toEqual(answers.map((answer) => answer.telemetryReadingId));
    expect(bySequence.map((point) => ({ sourceEventId: point.sourceEventId, payloadHash: point.payloadHash })))
      .toEqual(entries.map((entry) => ({ sourceEventId: entry.sourceEventId, payloadHash: entry.payloadHash })));
  });

  test('a late correction of a stored reading is kept beside the original, which it names (#1518, RNF025 C8)', async ({ request }, testInfo) => {
    await bindSensor(correctionSensorId);

    const buffer = createEdgeBuffer({ dir: testInfo.outputPath('edge-correction'), deviceId: correctionSensorId });
    const observedAt = new Date(Date.now() - 1_000).toISOString();

    const answers: any[] = [];
    const send = httpSender({
      endpoint: `${apiBaseURL}/api/iot/telemetry`,
      secret: process.env.TELEMETRY_INGEST_SECRET,
      fetchImpl: async (url: string, init: RequestInit) => {
        const response = await fetch(url, init);
        answers.push(await response.clone().json());
        return response;
      },
    });

    const original = buffer.enqueue({ sensorId: correctionSensorId, temperature: -75, timestamp: observedAt });
    expect(await buffer.drain(send)).toEqual({ acked: 1, deadLettered: 0, retained: 0, stoppedOn: null });
    // The original is stored before its correction is sent.
    await expect
      .poll(async () => (await queryTemperatureRevisions(correctionSensorId)).length, { timeout: 15_000 })
      .toBe(1);

    // The device corrects the reading it already sent for the same time: a
    // new source event, so no replay of the first.
    const correction = buffer.enqueue({ sensorId: correctionSensorId, temperature: -70, timestamp: observedAt });
    expect(await buffer.drain(send)).toEqual({ acked: 1, deadLettered: 0, retained: 0, stoppedOn: null });

    expect(answers).toHaveLength(2);
    for (const answer of answers) {
      expect(answer).toMatchObject({ success: true, accepted: true, clockStatus: 'synchronized' });
      expect(answer.replayed).toBeUndefined();
    }
    expect(answers[1].telemetryReadingId).not.toBe(answers[0].telemetryReadingId);

    // Same sensor, time and tags: only the revision tag keeps two series, so
    // the original is not overwritten.
    await expect
      .poll(async () => (await queryTemperatureRevisions(correctionSensorId)).length, { timeout: 15_000 })
      .toBe(2);
    const points = (await queryTemperatureRevisions(correctionSensorId))
      .map((point) => ({ ...point, time: new Date(point.time).toISOString() }))
      .sort((a, b) => (a.revision ?? '').localeCompare(b.revision ?? ''));
    expect(points).toEqual([
      {
        time: observedAt, value: -75, telemetryReadingId: answers[0].telemetryReadingId,
        sourceEventId: original.sourceEventId, revision: null, supersedesTelemetryReadingId: null,
      },
      {
        time: observedAt, value: -70, telemetryReadingId: answers[1].telemetryReadingId,
        sourceEventId: correction.sourceEventId, revision: '1', supersedesTelemetryReadingId: answers[0].telemetryReadingId,
      },
    ]);

    // The history reads the current revision alone; the original stays
    // readable by its id.
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const history = await request.get(`${apiBaseURL}/api/temperature/history?sensorId=${encodeURIComponent(correctionSensorId)}`, { headers: auth });
    expect(history.status(), await history.text()).toBe(200);
    const page = (await history.json()).data;
    expect(page.total).toBe(1);
    expect(page.temperatures[0]).toMatchObject({ logId: answers[1].telemetryReadingId, temperatureValue: -70, revision: '1' });

    const byId = await request.get(`${apiBaseURL}/api/temperature/${encodeURIComponent(answers[0].telemetryReadingId)}`, { headers: auth });
    expect(byId.status(), await byId.text()).toBe(200);
    expect((await byId.json()).data).toMatchObject({ telemetryReadingId: answers[0].telemetryReadingId, temperatureValue: -75 });
  });

  test('an identical resend of a stored reading with no source event is no correction: one point (#1518, RNF025 C8)', async ({ request }) => {
    await bindSensor(resendSensorId);

    // No sourceEventId, deviceMessageId or idempotencyKey: the server keys
    // the reading by its payload alone.
    const body = { sensorId: resendSensorId, temperature: 4, timestamp: new Date(Date.now() - 1_000).toISOString() };
    const answers: any[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: { 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' },
        data: body,
      });
      expect(response.status(), await response.text()).toBe(200);
      const answer = await response.json();
      expect(answer.replayed).toBeUndefined();
      answers.push(answer);
    }

    await expect
      .poll(async () => (await queryTemperatureRevisions(resendSensorId)).length, { timeout: 15_000 })
      .toBe(1);
    const points = await queryTemperatureRevisions(resendSensorId);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ revision: null, supersedesTelemetryReadingId: null, value: 4 });
    expect(answers.map((answer) => answer.telemetryReadingId)).toContain(points[0].telemetryReadingId);
  });

  test('a reading carrying personal data never enters the buffer, and the clean reading drains to the server unflagged (RNF004 C7)', async ({}, testInfo) => {
    await bindSensor(piiSensorId);

    const dir = testInfo.outputPath('edge-pii');
    const buffer = createEdgeBuffer({ dir, deviceId: piiSensorId });
    const patientName = `Paciente Sintetico ${piiSensorId}`;
    const cpf = generateValidCpf();

    // Every file under the buffer directory, read whole.
    const readDisk = (root: string): string[] => fs.readdirSync(root, { withFileTypes: true }).flatMap((dirent) => {
      const full = path.join(root, dirent.name);
      return dirent.isDirectory() ? readDisk(full) : [fs.readFileSync(full, 'utf8')];
    });
    const expectNoPersonalData = () => {
      for (const content of readDisk(dir)) {
        expect(content).not.toContain(patientName);
        expect(content).not.toContain(cpf);
      }
    };

    // The device refuses the reading before it writes anything.
    expect(() => buffer.enqueue({
      sensorId: piiSensorId, temperature: -75, timestamp: new Date(Date.now() - 1_000).toISOString(), patientName, cpf,
    })).toThrow(/Campos não permitidos no buffer: patientName, cpf/);
    expect(buffer.pending()).toEqual([]);
    expect(buffer.deadLetters()).toEqual([]);
    expectNoPersonalData();

    // The refused reading used no sequence number.
    const entry = buffer.enqueue({ sensorId: piiSensorId, temperature: -75, timestamp: new Date(Date.now() - 1_000).toISOString() });
    expect(entry.sequenceNumber).toBe(0);
    expect(Object.keys(entry.body).sort()).toEqual(['idempotencyKey', 'sensorId', 'sequenceNumber', 'sourceEventId', 'temperature', 'timestamp']);
    expectNoPersonalData();

    const sent: any[] = [];
    const answers: any[] = [];
    const send = httpSender({
      endpoint: `${apiBaseURL}/api/iot/telemetry`,
      secret: process.env.TELEMETRY_INGEST_SECRET,
      fetchImpl: async (url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string));
        const response = await fetch(url, init);
        answers.push(await response.clone().json());
        return response;
      },
    });

    expect(await buffer.drain(send)).toEqual({ acked: 1, deadLettered: 0, retained: 0, stoppedOn: null });
    expect(answers).toHaveLength(1);
    const [answer] = answers;
    expect(answer).toMatchObject({ success: true, accepted: true, clockStatus: 'synchronized' });
    expect(JSON.stringify(sent)).not.toContain(patientName);
    expect(JSON.stringify(sent)).not.toContain(cpf);

    // Every body field is a contract field, so the server stripped and
    // flagged nothing: no ingestion event for this reading.
    expect(await findTelemetryIngestionEvent({ sourceEventId: entry.sourceEventId })).toBeNull();

    await expect
      .poll(async () => (await queryFreezerReadingIds(piiSensorId, 10, 'temperature')).map((point) => point.telemetryReadingId), { timeout: 15_000 })
      .toEqual([answer.telemetryReadingId]);
  });
});
