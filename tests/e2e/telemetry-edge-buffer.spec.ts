import { test, expect } from '@playwright/test';
import fs from 'fs';
import { createEdgeBuffer, httpSender } from '../../api/backend/scripts/telemetry-edge-buffer';
import { bindSensor, unbindSensor, closeSeedSensorDb } from './helpers/seedSensor';
import { queryFreezerReadingIds } from './helpers/queryInflux';

// Real-backend proof of RNF004 C1/C2 (#1392): the device's durable edge
// buffer keeps each reading on disk until the backend confirms it, and a
// reading whose answer was lost is resent with its stored body, so the
// backend answers it as a replay and InfluxDB holds it once.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Telemetry edge buffer (#1392, RNF004 C1/C2) — real backend', () => {
  const sensorId = `rnf004-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  test.afterAll(async () => {
    await unbindSensor(sensorId).catch(() => {});
    await closeSeedSensorDb().catch(() => {});
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
});
