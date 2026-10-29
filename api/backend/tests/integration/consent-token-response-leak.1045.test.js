import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1045: `consentToken` is the 64-char secret that is the SOLE credential for
// the UNAUTHENTICATED POST /api/e-consent/consent-tokens/accept. Any response
// that carries it hands an authenticated org user the ability to consent on a
// participant's behalf through a call that cannot name them.
//
// These pin the response BOUNDARY rather than any one projection, because the
// leak was never confined to the two routes the issue named: five separate
// handlers returned the raw patient document, across two different permission
// gates (createPatient and viewReports).
//
// Deliberately still returned: consentTokenExpiresAt and consentNotifiedAt.
// The patient directory renders both, and neither is a credential.
const LEAKED_SECRET = 'a'.repeat(64);

function seededPatient(overrides = {}) {
  return {
    _id: new ObjectId(),
    participantId: '77222497',
    status: 'PENDING_CONSENT',
    clinicalUnitId: 'unit-1',
    consentToken: LEAKED_SECRET,
    consentTokenCreatedAt: new Date('2026-09-02T15:45:01.834Z'),
    consentTokenExpiresAt: new Date('2026-09-09T15:45:01.834Z'),
    consentNotifiedAt: new Date('2026-09-02T15:45:02.000Z'),
    ...overrides,
  };
}

/**
 * The assertion, in one place: the secret and its mint timestamp must be gone
 * from ANY shape the payload takes, and the two harmless consent fields must
 * survive. Serialising to a string is what makes this robust to the payload
 * being an object, an array, or nested under `data`/`patients`.
 */
function expectNoConsentSecret(body) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(LEAKED_SECRET);
  expect(serialized).not.toContain('consentTokenCreatedAt');
}

describe('#1045: no response hands out a live consentToken', () => {
  function createCoordinatorToken() {
    return jwt.sign(
      {
        userID: 'qa-coord-1',
        accessType: 3,
        roleName: 'Coordenador',
        name: 'QA Coordenador',
        mfaVerified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  // GET /api/patients/:id runs requireOrganizationScope AND
  // isRecordInOrganizationScope; an Administrador resolves to `global` scope,
  // which is what reaches the handler whose response shape is being pinned.
  function createAdminToken() {
    return jwt.sign(
      {
        userID: 'qa-admin-1',
        accessType: 4,
        roleName: 'Administrador',
        name: 'QA Admin',
        mfaVerified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1045-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1045-1' });
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  function createDbMock(patientsCollection) {
    const rbacCollections = buildRbacCollections([
      { userAccountId: 'qa-coord-1', accessType: 3 },
      { userAccountId: 'qa-admin-1', accessType: 4 },
    ]);
    return {
      collection: (name) => {
        if (name === 'patients' || name === 'pacientes') return patientsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
          createIndex: vi.fn().mockResolvedValue('idx'),
          find: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          countDocuments: vi.fn().mockResolvedValue(0),
        };
      },
    };
  }

  function patientsCollectionWith(docs) {
    return {
      createIndex: vi.fn().mockResolvedValue('idx'),
      dropIndex: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn().mockResolvedValue(docs[0] || null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs),
      }),
      countDocuments: vi.fn().mockResolvedValue(docs.length),
    };
  }

  it('GET /api/patients does not return consentToken', async () => {
    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    const response = await request(app)
      .get('/api/patients?limit=3')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`);

    expect(response.status).toBe(200);
    expectNoConsentSecret(response.body);
  });

  it('GET /api/patients/search does not return consentToken', async () => {
    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    const response = await request(app)
      .get('/api/patients/search?q=77222497')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`);

    expect(response.status).toBe(200);
    expectNoConsentSecret(response.body);
  });

  it('GET /api/patients/:id does not return consentToken (not examined by #1045 itself)', async () => {
    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    const response = await request(app)
      .get('/api/patients/77222497')
      .set('Authorization', `Bearer ${createAdminToken()}`);

    expect(response.status).toBe(200);
    expectNoConsentSecret(response.body);
  });

  it('POST /api/patients/find-for-edit does not return consentToken (not examined by #1045 itself)', async () => {
    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    const response = await request(app)
      .post('/api/patients/find-for-edit')
      // #1185: find-for-edit is org-scoped now, like GET /:id above, and
      // this fixture's patient is in no organization the coordinator
      // holds -- admin (global) keeps the test on its subject, the token.
      .set('Authorization', `Bearer ${createAdminToken()}`)
      .send({ participantId: '77222497' });

    expect(response.status).toBe(200);
    expectNoConsentSecret(response.body);
  });

  // CONTROL: unchanged by this fix, so it must be green BEFORE it too (#695).
  // If this is red the harness is wrong, not the product -- and specifically
  // it guards against "fixed" by stripping the whole consent block, which
  // would break the directory's Expirado/Pendente badge and its resend flow.
  it('CONTROL: still returns consentTokenExpiresAt and consentNotifiedAt', async () => {
    app.locals.db = createDbMock(patientsCollectionWith([seededPatient()]));

    const response = await request(app)
      .get('/api/patients?limit=3')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`);

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('consentTokenExpiresAt');
    expect(serialized).toContain('consentNotifiedAt');
  });
});
