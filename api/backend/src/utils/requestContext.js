/**
 * Request context (#1308; RNF020 C6, RF012 AC1): one id per HTTP request,
 * carried through every async continuation of that request, so a log line
 * and an audit event can be tied back to the request that caused them.
 *
 * The id is the caller's X-Request-Id when it is a well-formed token (a
 * proxy or a client that already assigned one), otherwise a new UUID. It is
 * echoed in the response's X-Request-Id header.
 *
 * A queue job enqueued during a request carries the id as `requestId` in its
 * data, and the worker runs each job under it, so the worker's log lines and
 * audit events keep the request's correlation (#1323; RNF015 C1).
 */
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const storage = new AsyncLocalStorage();
// Bounded and free of separators, so a header value cannot inject text into
// a log line.
const WELL_FORMED = /^[A-Za-z0-9._-]{8,128}$/;

function requestIdFrom(req) {
  const incoming = req && req.headers ? req.headers['x-request-id'] : undefined;
  return typeof incoming === 'string' && WELL_FORMED.test(incoming) ? incoming : crypto.randomUUID();
}

function middleware(req, res, next) {
  const requestId = requestIdFrom(req);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId }, next);
}

function currentRequestId() {
  const store = storage.getStore();
  return store ? store.requestId : null;
}

// Job data for queue.add(): stamped with the current request id, or returned
// unchanged outside a request.
function withRequestId(data) {
  const requestId = currentRequestId();
  return requestId ? { ...data, requestId } : data;
}

// The job data comes back from Redis, so its id is re-checked like the header.
// Always a fresh store: a job without an id never inherits an outer context.
function runWithRequestId(requestId, fn) {
  const valid = typeof requestId === 'string' && WELL_FORMED.test(requestId);
  return storage.run({ requestId: valid ? requestId : null }, fn);
}

function withJobRequestContext(processor) {
  return (job, ...rest) =>
    runWithRequestId(job && job.data ? job.data.requestId : undefined, () => processor(job, ...rest));
}

module.exports = {
  middleware,
  currentRequestId,
  requestIdFrom,
  WELL_FORMED,
  withRequestId,
  runWithRequestId,
  withJobRequestContext,
};
