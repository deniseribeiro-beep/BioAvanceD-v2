import { describe, it, expect, vi, afterEach } from 'vitest';

const requestContext = require('../../../src/utils/requestContext');
const logger = require('../../../src/utils/logger');

afterEach(() => {
  vi.restoreAllMocks();
});

function serve(headers = {}) {
  const req = { headers };
  const res = { setHeader: vi.fn() };
  return new Promise((resolve) => {
    requestContext.middleware(req, res, async () => {
      // An async continuation inside the request still sees its id.
      await new Promise((r) => setTimeout(r, 1));
      resolve({ req, res, seen: requestContext.currentRequestId() });
    });
  });
}

// #1308: RNF020 C6 -- one id per request, in its log lines and its audit
// events' correlationId.
describe('requestContext', () => {
  it('assigns a UUID, echoes it in X-Request-Id and exposes it to async continuations', async () => {
    const { req, res, seen } = await serve();
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.requestId).toBe(seen);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', seen);
  });

  it('keeps a well-formed incoming X-Request-Id', async () => {
    const { seen } = await serve({ 'x-request-id': 'proxy-1234abcd' });
    expect(seen).toBe('proxy-1234abcd');
  });

  it('replaces an incoming id that could inject text into a log line', async () => {
    const { seen } = await serve({ 'x-request-id': 'abc\n[ERROR] forged line' });
    expect(seen).not.toContain('forged');
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has no id outside a request', () => {
    expect(requestContext.currentRequestId()).toBeNull();
  });

  it('puts the request id on a log line and redacts its arguments', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new Promise((resolve) => {
      requestContext.middleware({ headers: { 'x-request-id': 'req-abcdef12' } }, { setHeader() {} }, () => {
        logger.error('falha para maria@example.org', { password: 'p', id: 7 });
        resolve();
      });
    });
    const [head, arg] = spy.mock.calls[0];
    expect(head).toMatch(/^\[ERROR\] \S+ \[req:req-abcdef12\] - falha para \[REDACTED_EMAIL\]$/);
    expect(arg).toEqual({ password: '[REDACTED]', id: 7 });
  });
});

// #1323: RNF015 C1 -- a queue job enqueued during a request carries the id
// into the worker.
describe('requestContext queue jobs', () => {
  function inRequest(requestId, fn) {
    return new Promise((resolve, reject) => {
      requestContext.middleware({ headers: { 'x-request-id': requestId } }, { setHeader() {} }, () => {
        Promise.resolve().then(fn).then(resolve, reject);
      });
    });
  }

  it('stamps job data with the current request id', async () => {
    const data = await inRequest('req-enqueue-0001', () => requestContext.withRequestId({ a: 1 }));
    expect(data).toEqual({ a: 1, requestId: 'req-enqueue-0001' });
  });

  it('returns job data unchanged outside a request', () => {
    const data = { a: 1 };
    const out = requestContext.withRequestId(data);
    expect(out).toBe(data);
    expect(out).not.toHaveProperty('requestId');
  });

  it('runs a job under its request id, which reaches the log line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let seen;
    await requestContext.withJobRequestContext(async () => {
      seen = requestContext.currentRequestId();
      logger.error('falha no job');
    })({ data: { requestId: 'req-job-0001' } });
    expect(seen).toBe('req-job-0001');
    expect(spy.mock.calls[0][0]).toMatch(/\[req:req-job-0001\]/);
  });

  // #1468 (RNF015 C1): a job with a malformed or missing id runs under a
  // fresh correlation id of its own, never the malformed text or an outer id.
  it('#1468 replaces a job request id that could inject text into a log line with a fresh one', async () => {
    const malformed = 'abc\n[ERROR] forged';
    const outer = 'req-outer-0002';
    const seen = await inRequest(outer, () =>
      requestContext.withJobRequestContext(async () => requestContext.currentRequestId())({ data: { requestId: malformed } })
    );
    expect(requestContext.WELL_FORMED.test(seen)).toBe(true);
    expect(seen).not.toBe(malformed);
    expect(seen).not.toBe(outer);
  });

  it('#1468 runs a job without an id under a fresh id, not an outer request id', async () => {
    const outer = 'req-outer-0001';
    const seen = await inRequest(outer, () =>
      requestContext.withJobRequestContext(async () => requestContext.currentRequestId())({ data: {} })
    );
    expect(requestContext.WELL_FORMED.test(seen)).toBe(true);
    expect(seen).not.toBe(outer);
  });

  it('#1468 runs a job whose data is undefined under a fresh well-formed id', async () => {
    const seen = await requestContext.withJobRequestContext(async () => requestContext.currentRequestId())({ name: 'x' });
    expect(requestContext.WELL_FORMED.test(seen)).toBe(true);
  });

  it('#1468 runAsJob keeps a well-formed id and gives each id-less run a fresh one', () => {
    expect(requestContext.runAsJob('req-job-0002', () => requestContext.currentRequestId())).toBe('req-job-0002');
    const a = requestContext.runAsJob(null, () => requestContext.currentRequestId());
    const b = requestContext.runAsJob(null, () => requestContext.currentRequestId());
    expect(requestContext.WELL_FORMED.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

// #1323: RNF015 C1 -- outbound Neo4j and InfluxDB calls carry the id.
describe('requestContext outbound carriers', () => {
  it('#1323 neo4jTxConfig gives transaction metadata for a well-formed id only', () => {
    expect(requestContext.neo4jTxConfig('req-tx-0001')).toEqual({ metadata: { requestId: 'req-tx-0001' } });
    expect(requestContext.neo4jTxConfig(null)).toBeUndefined();
    expect(requestContext.neo4jTxConfig('')).toBeUndefined();
    expect(requestContext.neo4jTxConfig('abc\n[ERROR] x')).toBeUndefined();
  });

  it('#1323 requestIdHeaders gives an X-Request-Id header for a well-formed id only', () => {
    expect(requestContext.requestIdHeaders('req-hdr-0001')).toEqual({ 'X-Request-Id': 'req-hdr-0001' });
    expect(requestContext.requestIdHeaders(null)).toBeNull();
    expect(requestContext.requestIdHeaders('')).toBeNull();
    expect(requestContext.requestIdHeaders('abc\n[ERROR] x')).toBeNull();
  });
});
