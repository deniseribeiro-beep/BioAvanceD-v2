import { beforeEach, vi } from 'vitest';
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
  verifySession: vi.fn(async () => ({ valid: true, session: { sessionID: 'test-session', userID: 'test-user' } })),
  updateActivity: vi.fn(async () => ({ sessionID: 'test-session' })),
  revokeSessionById: vi.fn(async () => ({ sessionID: 'test-session', isRevoked: true, revokedAt: new Date() })),
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
