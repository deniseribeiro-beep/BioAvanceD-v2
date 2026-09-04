import { describe, it, expect, afterEach } from 'vitest';

const { machineIngestEnabled, requireMachineIngestSecret } = require('../../src/utils/machineIngestGate');

// #1054: the gate for routes a MACHINE calls. Its sibling is
// utils/testSupportGate.js, and these cases mirror that file's deliberately --
// the per-request property is the same one #675 hardened there ("an unset
// secret must never be treated as no auth required"), and the difference is
// that this gate has no NODE_ENV !== 'production' registration check, because
// telemetry ingest has to work in production.
function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('machineIngestGate.machineIngestEnabled (#1054)', () => {
  const original = process.env.TELEMETRY_INGEST_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.TELEMETRY_INGEST_SECRET;
    else process.env.TELEMETRY_INGEST_SECRET = original;
  });

  it('is false when TELEMETRY_INGEST_SECRET is unset', () => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    expect(machineIngestEnabled()).toBe(false);
  });

  it('is false when TELEMETRY_INGEST_SECRET is blank or whitespace', () => {
    process.env.TELEMETRY_INGEST_SECRET = '';
    expect(machineIngestEnabled()).toBe(false);
    process.env.TELEMETRY_INGEST_SECRET = '   ';
    expect(machineIngestEnabled()).toBe(false);
  });

  it('is true when a real secret is configured', () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    expect(machineIngestEnabled()).toBe(true);
  });
});

describe('machineIngestGate.requireMachineIngestSecret (#1054)', () => {
  const original = process.env.TELEMETRY_INGEST_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.TELEMETRY_INGEST_SECRET;
    else process.env.TELEMETRY_INGEST_SECRET = original;
  });

  it('calls next() when the header matches the configured secret', () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    const req = { get: () => 'machine-secret-1' };
    const res = createRes();
    let called = false;

    requireMachineIngestSecret(req, res, () => { called = true; });

    expect(called).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('403s when the header does not match the configured secret', () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    const req = { get: () => 'wrong-secret' };
    const res = createRes();

    requireMachineIngestSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
  });

  it('403s when no header is sent at all', () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    const req = { get: () => undefined };
    const res = createRes();

    requireMachineIngestSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
  });

  // The load-bearing case: a stack that has not configured machine ingest must
  // not thereby have an anonymous write endpoint.
  it('fails closed (403) when TELEMETRY_INGEST_SECRET is unset, even with a header sent', () => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    const req = { get: () => 'anything' };
    const res = createRes();

    requireMachineIngestSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
  });

  it('names the header in its refusal, so an operator can tell this apart from a session 403', () => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    const req = { get: () => undefined };
    const res = createRes();

    requireMachineIngestSecret(req, res, () => {});

    expect(res.body.message).toContain('x-telemetry-ingest-secret');
  });
});
