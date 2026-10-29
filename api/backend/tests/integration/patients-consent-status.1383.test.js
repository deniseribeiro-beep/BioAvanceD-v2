import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { createMatchingCollection } = require('../factories/filter.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1383 (RF010 AC5): the patients directory showed Patient.status, which no
// revocation changes, so a revoked consent read as granted. Each row now
// carries consentStatus, the derived state of the participant's newest
// consent, while status stays the participant gate's own field.
const ORG = 'test-org-default';

function createToken(userID, accessType, roleName) {
  return jwt.sign(
    { userID, accessType, roleName, name: `QA ${roleName}`, mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function seededCollections() {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const responses = { storage: true, contact: true };
  const patient = (participantId, status) => ({ _id: new ObjectId(), participantId, status, clinicalUnitId: ORG });
  const consent = (consentId, participantId, signedAt) => ({
    _id: new ObjectId(),
    consentId,
    participantId,
    status: 'ACTIVE',
    responses,
    signedAt: new Date(signedAt),
    createdAt: new Date(signedAt),
  });
  const revocation = (consentId, scope) => ({ consentId, scope, effectiveAt: anHourAgo });

  return {
    patients: createMatchingCollection([
      patient('20000001', 'ACTIVE'),
      patient('20000002', 'ACTIVE'),
      patient('20000003', 'ACTIVE'),
      patient('20000004', 'PENDING_CONSENT'),
      patient('20000005', 'ACTIVE'),
    ]),
    patientConsents: createMatchingCollection([
      consent('c-p1', '20000001', '2026-01-01T00:00:00Z'),
      consent('c-p2', '20000002', '2026-01-01T00:00:00Z'),
      // Older first, so keeping the first consent read would derive revoked.
      consent('c-p3-old', '20000003', '2025-01-01T00:00:00Z'),
      consent('c-p3-new', '20000003', '2026-02-01T00:00:00Z'),
      consent('c-p5', '20000005', '2026-01-01T00:00:00Z'),
    ]),
    consentDecisionEvents: createMatchingCollection([
      { consentId: 'c-p5', decision: 'superseded', occurredAt: anHourAgo },
    ]),
    consentRevocations: createMatchingCollection([
      revocation('c-p1', ['all']),
      revocation('c-p2', ['contact']),
      revocation('c-p3-old', ['all']),
    ]),
  };
}

const EXPECTED_ROWS = [
  ['20000001', 'ACTIVE', 'revoked'],
  ['20000002', 'ACTIVE', 'partially_revoked'],
  ['20000003', 'ACTIVE', 'active'],
  ['20000004', 'PENDING_CONSENT', null],
  ['20000005', 'ACTIVE', 'superseded'],
];

describe('#1383: GET /api/patients carries the derived consent state of each participant', () => {
  let collections;

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1383-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1383-1' });
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
    collections = seededCollections();
    app.locals.db = createDbMock({
      ...collections,
      ...buildRbacCollections([
        { userAccountId: 'qa-coord-1', accessType: 3 },
        { userAccountId: 'qa-tec-1', accessType: 2 },
      ]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  function rowsOf(response) {
    return response.body.data.patients.map((row) => [row.participantId, row.status, row.consentStatus]);
  }

  function expectOneBatchedRead() {
    expect(collections.patientConsents.find).toHaveBeenCalledTimes(1);
    expect(collections.consentDecisionEvents.find).toHaveBeenCalledTimes(1);
    expect(collections.consentRevocations.find).toHaveBeenCalledTimes(1);
  }

  it('a Coordenador (cadastro list) reads revoked, partially_revoked, active, null and superseded beside an unchanged status', async () => {
    const response = await request(app)
      .get('/api/patients?limit=10')
      .set('Authorization', `Bearer ${createToken('qa-coord-1', 3, 'Coordenador')}`);

    expect(response.status).toBe(200);
    expect(rowsOf(response)).toEqual(EXPECTED_ROWS);
    expectOneBatchedRead();
  });

  it('a Tecnico (operational list) reads the same consent states beside an unchanged status', async () => {
    const response = await request(app)
      .get('/api/patients?limit=10')
      .set('Authorization', `Bearer ${createToken('qa-tec-1', 2, 'Tecnico')}`);

    expect(response.status).toBe(200);
    expect(rowsOf(response)).toEqual(EXPECTED_ROWS);
    expectOneBatchedRead();
  });
});
