import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-jwt-secret';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_dummy_key';
process.env.USER_ANON_SALT = process.env.USER_ANON_SALT || 'test-user-anon-salt';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://localhost:5173';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'vitest-key-001';
// #675: test-support routes (iot.routes.js, ingestionTestSupport.routes.js)
// now require this explicit opt-in to even be registered, on top of
// NODE_ENV !== 'production' -- the native vitest suite is exactly the kind
// of controlled, non-production environment the flag exists to allow, and
// iot.api.test.js's test-support describe block needs the routes actually
// registered at module-load time to exercise them at all.
process.env.ENABLE_TEST_SUPPORT_ROUTES = process.env.ENABLE_TEST_SUPPORT_ROUTES || 'true';
// #1392: the unit fixtures post readings for unbound sensors, which the
// native suite accepts as `record`. The binding cases set the mode
// themselves, and the e2e stack proves `enforce`, the code default.
process.env.TELEMETRY_BINDING_MODE = process.env.TELEMETRY_BINDING_MODE || 'record';

function createMockSession() {
  return {
    run: vi.fn(async () => ({ records: [] })),
    close: vi.fn(async () => undefined)
  };
}

function createCursor(docs = []) {
  let current = Array.isArray(docs) ? [...docs] : [];
  const cursor = {
    sort: vi.fn((criteria = {}) => {
      const [[field, direction = 1] = []] = Object.entries(criteria);
      if (field) {
        current.sort((a, b) => {
          const left = a?.[field] ?? 0;
          const right = b?.[field] ?? 0;
          if (left === right) return 0;
          return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
        });
      }
      return cursor;
    }),
    skip: vi.fn((n = 0) => {
      current = current.slice(Math.max(0, Number(n) || 0));
      return cursor;
    }),
    limit: vi.fn((n) => {
      if (Number.isFinite(Number(n)) && Number(n) >= 0) {
        current = current.slice(0, Number(n));
      }
      return cursor;
    }),
    project: vi.fn(() => cursor),
    populate: vi.fn(() => cursor),
    lean: vi.fn(async () => current[0] || null),
    toArray: vi.fn(async () => current),
  };
  return cursor;
}

function createCollection(docs = []) {
  return {
    collectionName: 'test_collection',
    createIndex: vi.fn(async () => 'idx'),
    insertOne: vi.fn(async () => ({ insertedId: randomUUID() })),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedId: null })),
    updateMany: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    findOne: vi.fn(async () => null),
    find: vi.fn(() => createCursor(docs)),
    countDocuments: vi.fn(async () => Array.isArray(docs) ? docs.length : 0),
    estimatedDocumentCount: vi.fn(async () => Array.isArray(docs) ? docs.length : 0),
    bulkWrite: vi.fn(async () => ({ modifiedCount: 0, insertedCount: 0 })),
  };
}

function createDefaultDb() {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, createCollection());
      return collections.get(name);
    },
    listCollections: vi.fn(() => createCursor([])),
  };
}

const mockNeo4jDriver = {
  verifyConnectivity: vi.fn(async () => undefined),
  session: vi.fn(() => createMockSession()),
  close: vi.fn(async () => undefined)
};

vi.mock('../src/infrastructure/database/neo4j/connection', () => ({
  connectNeo4j: vi.fn(async () => mockNeo4jDriver),
  getNeo4jDriver: vi.fn(() => mockNeo4jDriver),
  closeNeo4jConnection: vi.fn(async () => undefined),
  getNeo4jConfig: vi.fn(() => ({
    uri: 'bolt://mocked-neo4j:7687',
    username: 'neo4j',
    password: 'mocked-password',
    database: 'neo4j'
  }))
}));

vi.mock('../src/services/session.service', () => ({
  verifySession: vi.fn(async () => ({ valid: true, session: { sessionId: 'test-session', userAccountId: 'test-user' } })),
  updateActivity: vi.fn(async () => ({ sessionId: 'test-session' })),
  revokeSessionById: vi.fn(async () => ({ sessionId: 'test-session', isRevoked: true, revokedAt: new Date() })),
  revokeAllOtherSessions: vi.fn(async () => ({ revokedCount: 0 })),
  listUserSessions: vi.fn(async () => []),
  invalidateSession: vi.fn(async () => true),
  getSessionByRefreshToken: vi.fn(async () => null),
  rotateSessionTokens: vi.fn(async () => true),
  sessions: new Map()
}));

beforeEach(() => {
  try {
    const appPath = require.resolve('../app');
    const appModule = require.cache[appPath];
    if (!appModule?.exports) {
      return;
    }

    const app = appModule.exports;
    if (!app.locals.db) {
      app.locals.db = createDefaultDb();
    }
  } catch (_) {
    // Some isolated unit tests do not load the Express app.
  }
});

// #1447: supertest's request(app) listens a fresh server and opens a fresh
// 127.0.0.1 connection for every request. On a Windows host under the
// connection churn of a full run, a new loopback connection can stall for
// seconds or fail with ETIMEDOUT, and the case making it goes red. For a
// file that loads supertest, route that traffic through one listening
// server per test process, reached over a keep-alive connection that is
// opened (and retried) in beforeAll, before any case's budget starts. The
// app still receives the request as the test sent it: the dispatcher
// strips its routing header and hands req/res to the app's own server.
const LOOPBACK_STATE = Symbol.for('bioavanced.vitest.supertestLoopback');
const LOOPBACK_PATCHED = Symbol.for('bioavanced.vitest.supertestLoopback.patched');
const LOOPBACK_HEADER = 'x-vitest-loopback-target';
const LOOPBACK_WARM_ID = 'warm';
const LOOPBACK_WARM_BUDGET_MS = 8000; // under vitest's 10 s hookTimeout
const LOOPBACK_CONNECT_ATTEMPT_MS = 1000;

function supertestLoopback() {
  const existing = globalThis[LOOPBACK_STATE];
  if (existing) return existing;
  const http = require('http');
  const targets = new Map();
  const server = http.createServer((req, res) => {
    const id = req.headers[LOOPBACK_HEADER];
    if (id === LOOPBACK_WARM_ID) {
      res.statusCode = 204;
      res.end();
      return;
    }
    const target = targets.get(id);
    if (!target) {
      res.statusCode = 502;
      res.end(`no supertest target for ${LOOPBACK_HEADER}: ${id}`);
      return;
    }
    delete req.headers[LOOPBACK_HEADER];
    for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
      if (req.rawHeaders[i].toLowerCase() === LOOPBACK_HEADER) req.rawHeaders.splice(i, 2);
    }
    target.emit('request', req, res);
  });
  // No idle timeout: a socket the server closes while the agent reuses it
  // would turn into ECONNRESET. afterAll below closes everything.
  server.keepAliveTimeout = 0;
  server.listen(0);
  server.unref();
  const state = {
    server,
    agent: new http.Agent({ keepAlive: true }),
    targets,
    nextId: 0,
  };
  globalThis[LOOPBACK_STATE] = state;
  return state;
}

function installSupertestLoopback(Test) {
  if (Test.prototype[LOOPBACK_PATCHED]) return;
  const http = require('http');
  const { Server: TlsServer } = require('tls');
  const originalServerAddress = Test.prototype.serverAddress;
  const originalEnd = Test.prototype.end;
  Test.prototype.serverAddress = function serverAddress(app, path) {
    // Only the shape request(app) builds: a plain, unlistened http.Server.
    // A listening server, https/tls and http2 keep supertest's own path.
    if (!(app instanceof http.Server) || app instanceof TlsServer || app.address()) {
      return originalServerAddress.call(this, app, path);
    }
    const state = supertestLoopback();
    const id = String(++state.nextId);
    state.targets.set(id, app);
    this._loopbackTarget = id;
    this.set(LOOPBACK_HEADER, id);
    this.agent(state.agent);
    return `http://127.0.0.1:${state.server.address().port}${path}`;
  };
  Test.prototype.end = function end(fn) {
    const id = this._loopbackTarget;
    if (!id || typeof fn !== 'function') return originalEnd.call(this, fn);
    return originalEnd.call(this, function release(err, res) {
      globalThis[LOOPBACK_STATE]?.targets.delete(id);
      return fn.call(this, err, res);
    });
  };
  Test.prototype[LOOPBACK_PATCHED] = true;
}

// Opens the keep-alive connection the first case will reuse. A connect that
// fails or stalls past one attempt's cap is retried until the budget runs
// out; if every attempt fails, the cases connect on their own, as before.
async function warmSupertestLoopback() {
  const http = require('http');
  const state = supertestLoopback();
  const port = state.server.address().port;
  const until = Date.now() + LOOPBACK_WARM_BUDGET_MS;
  while (Date.now() < until) {
    const ok = await new Promise((resolve) => {
      const req = http.get({
        host: '127.0.0.1',
        port,
        path: '/',
        agent: state.agent,
        headers: { [LOOPBACK_HEADER]: LOOPBACK_WARM_ID },
        timeout: Math.min(LOOPBACK_CONNECT_ATTEMPT_MS, Math.max(1, until - Date.now())),
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 204));
        res.on('error', () => resolve(false));
      });
      req.on('timeout', () => req.destroy(new Error('loopback warm-up attempt timed out')));
      req.on('error', () => resolve(false));
    });
    if (ok) return;
  }
}

beforeAll(async () => {
  // Only a file that loaded supertest pays for the server and connection.
  let supertestPath;
  try {
    supertestPath = require.resolve('supertest');
  } catch (_) {
    return;
  }
  if (!require.cache[supertestPath]) return;
  installSupertestLoopback(require('supertest').Test);
  await warmSupertestLoopback();
});

afterAll(() => {
  const state = globalThis[LOOPBACK_STATE];
  if (!state) return;
  globalThis[LOOPBACK_STATE] = undefined;
  state.agent.destroy();
  state.server.closeAllConnections();
  state.server.close();
});
