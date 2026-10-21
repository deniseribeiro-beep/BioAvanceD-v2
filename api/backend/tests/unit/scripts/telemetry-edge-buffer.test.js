import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEdgeBuffer } = require('../../../scripts/telemetry-edge-buffer');
const { readingIdentityOf } = require('../../../src/services/telemetryReadingContract');

/**
 * RNF004 C1 (#1392): the device's durable edge buffer. Each reading is on
 * disk with its identity before any send, leaves only on a 2xx (C2), and a
 * retry stops the drain so no reading overtakes an unconfirmed one (C3).
 * Only measurement fields enter it (C7).
 */
const NOW = new Date('2026-10-21T12:00:00.000Z');
const deviceId = 'CRYO-001';
const reading = (temperature) => ({ sensorId: deviceId, temperature, timestamp: '2026-10-21T11:59:00.000Z' });

let dir;
let uuidCount;
const uuid = () => { uuidCount += 1; return `event-${uuidCount}`; };
const open = () => createEdgeBuffer({ dir, deviceId, now: () => NOW, uuid });
const sender = (statusOf) => {
  const sent = [];
  const send = async (body) => {
    sent.push(body);
    const status = statusOf(body, sent.length - 1);
    if (status instanceof Error) throw status;
    return { status };
  };
  return { send, sent };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-buffer-'));
  uuidCount = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('telemetry edge buffer (RNF004 C1, #1392)', () => {
  it('keeps an entry with sourceEventId, observedAt, deviceId, sequenceNumber and payloadHash across a restart', () => {
    const entry = open().enqueue(reading(-80));
    expect(entry).toMatchObject({
      sourceEventId: 'event-1',
      observedAt: '2026-10-21T11:59:00.000Z',
      deviceId,
      sequenceNumber: 0,
      enqueuedAt: NOW.toISOString(),
    });
    expect(entry.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const [reopened] = open().pending();
    expect(reopened).toEqual(entry);
  });

  it('numbers entries 0, 1, 2 and continues at 3 after a full drain and a reopen', async () => {
    const buffer = open();
    expect([-80, -79, -78].map((t) => buffer.enqueue(reading(t)).sequenceNumber)).toEqual([0, 1, 2]);
    await buffer.drain(sender(() => 200).send);
    expect(open().enqueue(reading(-77)).sequenceNumber).toBe(3);
  });

  it('hashes the body as the server does and keys it by its sourceEventId', () => {
    const entry = open().enqueue(reading(-80));
    expect(entry.payloadHash).toBe(readingIdentityOf(entry.body).payloadHash);
    expect(entry.body.idempotencyKey).toBe(entry.sourceEventId);
    expect(entry.body.sourceEventId).toBe(entry.sourceEventId);
  });

  it('sends the bodies in sequence order on 200 and empties the buffer', async () => {
    const buffer = open();
    const entries = [-80, -79, -78].map((t) => buffer.enqueue(reading(t)));
    const { send, sent } = sender(() => 200);
    const result = await buffer.drain(send);
    expect(sent).toEqual(entries.map((entry) => entry.body));
    expect(result).toEqual({ acked: 3, deadLettered: 0, retained: 0, stoppedOn: null });
    expect(buffer.pending()).toEqual([]);
  });

  it.each([
    ['a 503', 503, 503],
    ['a thrown error', new Error('ECONNREFUSED'), 'error'],
    ['a 403', 403, 403],
  ])('stops on %s for the first entry, keeps every entry and resends the identical body later', async (_label, answer, stoppedOn) => {
    const buffer = open();
    [-80, -79, -78].forEach((t) => buffer.enqueue(reading(t)));
    const failing = sender(() => answer);
    const result = await buffer.drain(failing.send);
    expect(result).toEqual({ acked: 0, deadLettered: 0, retained: 3, stoppedOn });
    expect(failing.sent).toHaveLength(1);
    expect(buffer.pending()).toHaveLength(3);

    const ok = sender(() => 200);
    await buffer.drain(ok.send);
    expect(ok.sent[0]).toEqual(failing.sent[0]);
    expect(buffer.pending()).toEqual([]);
  });

  it('moves an entry the server refuses with 422 to the dead letters and acks the rest', async () => {
    const buffer = open();
    const entries = [-80, -79, -78].map((t) => buffer.enqueue(reading(t)));
    const result = await buffer.drain(sender((_body, index) => (index === 1 ? 422 : 200)).send);
    expect(result).toEqual({ acked: 2, deadLettered: 1, retained: 0, stoppedOn: null });
    expect(buffer.pending()).toEqual([]);
    const [dead] = buffer.deadLetters();
    expect(dead).toMatchObject({ sourceEventId: entries[1].sourceEventId, refusedStatus: 422, refusedAt: NOW.toISOString() });
  });

  it('refuses a measurement with a field outside the allow-list and writes nothing (C7)', () => {
    const buffer = open();
    expect(() => buffer.enqueue({ sensorId: 'S', temperature: -80, patientName: 'x' })).toThrow(/patientName/);
    expect(fs.readdirSync(path.join(dir, 'pending'))).toEqual([]);
    expect(buffer.enqueue(reading(-80)).sequenceNumber).toBe(0);
  });

  it('never lists or sends a torn *.tmp write', async () => {
    const buffer = open();
    fs.writeFileSync(path.join(dir, 'pending', '000000000009.json.tmp'), '{"body":');
    expect(buffer.pending()).toEqual([]);
    const { send, sent } = sender(() => 200);
    await buffer.drain(send);
    expect(sent).toEqual([]);
  });

  it('refuses to open a buffer that belongs to another device', () => {
    open().enqueue(reading(-80));
    expect(() => createEdgeBuffer({ dir, deviceId: 'CRYO-002' })).toThrow(/CRYO-001/);
  });

  it('runs one walk when drain is called again before the first settles', async () => {
    const buffer = open();
    [-80, -79].forEach((t) => buffer.enqueue(reading(t)));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const sent = [];
    const send = async (body) => { sent.push(body); await gate; return { status: 200 }; };

    const first = buffer.drain(send);
    const second = buffer.drain(send);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(sent.map((body) => body.sequenceNumber)).toEqual([0, 1]);
    expect(a).toEqual({ acked: 2, deadLettered: 0, retained: 0, stoppedOn: null });
    expect(b).toEqual(a);
  });
});
