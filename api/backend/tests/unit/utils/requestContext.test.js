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
