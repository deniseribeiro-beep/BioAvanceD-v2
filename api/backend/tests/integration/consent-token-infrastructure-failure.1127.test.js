import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { hashConsentToken } = require('../../src/utils/consentTokenHash');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const auditLogger = require('../../src/utils/auditLogger');
const consentService = require('../../src/services/consent.service');

// #1127: the consent-token endpoints answered 400 'Link inválido ou expirado'
// for EVERY throw out of patientService, including the ones that are not the
// participant's fault. A Mongo outage during the token check told the
// participant their emailed link was bad, which sends them to ask the biobank
// team for a new invitation -- a round trip that cannot help, because nothing
// was wrong with the old link.
//
// The controller already makes the opposite decision three lines away, for the
// ConsentTemplate lookup, and says why in a comment: "A template-lookup failure
// is not an invalid token." That reasoning applies just as exactly to an
// infrastructure failure inside the token check itself.
//
// The split is on WHO IS AT FAULT, which is also what keeps #823 intact: the
// four authorization refusals stay one opaque 400 with no `message`, and only
// the unmarked (infrastructure) errors become 503. The CONTROL cases at the
// bottom pin that #823's posture is unchanged by this.
//
// NOTE on the mechanism, corrected against the source 2026-09-22: the issue
// body names `getPatientsCollection` as the throw site. It is not a reachable
// one for `patients` -- `collectionResolver.getCollection` resolves that key
// synchronously with a bare `db.collection(name)`, and `ensurePatientIndexes`
// already swallows every `createIndex`/`dropIndex` rejection with a
// `logger.warn`. The reachable I/O throws are `findOne` (validate) and
// `updateOne` (accept), which is what these tests drive. Discriminating at the
// throw site is robust to which call throws; wrapping `getPatientsCollection`
// would have fixed nothing.
const VALID_TOKEN = 'b'.repeat(64);
const WRONG_TOKEN = 'c'.repeat(64);
const PARTICIPANT_ID = '77222497';

const INFRA_MESSAGE = 'connection <monitor> to 10.0.0.5:27017 closed';

function patientDoc(overrides = {}) {
  return {
    _id: new ObjectId(),
    participantId: PARTICIPANT_ID,
    status: 'PENDING_CONSENT',
    clinicalUnitId: 'unit-1',
    consentTokenHash: hashConsentToken(VALID_TOKEN),
    consentTokenCreatedAt: new Date('2026-09-01T10:00:00.000Z'),
    consentTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function genericCollection() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    createIndex: vi.fn().mockResolvedValue('idx'),
    countDocuments: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
  };
}

describe('#1127: an infrastructure failure in the token check is not reported as a bad link', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
    // The template lookup must SUCCEED throughout this file, so that any 503
    // observed below is the token check's and not the arm that already exists.
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  // Same shape as #823's helper, with the patients collection open to
  // per-case overrides so a single call can be made to reject.
  function useDb(patient, patientsOverrides = {}) {
    const patients = {
      ...genericCollection(),
      findOne: vi.fn().mockResolvedValue(patient),
      ...patientsOverrides,
    };
    app.locals.db = {
      collection: (name) =>
        name === 'patients' || name === 'pacientes' ? patients : genericCollection(),
    };
  }

  function expectInfrastructureAnswer(response) {
    expect(
      response.status,
      `expected 503 for an infrastructure failure, got ${response.status} ${JSON.stringify(response.body)}`
    ).toBe(503);
    expect(response.body.success).toBe(false);
    // The participant must not be sent to request a new invitation.
    expect(JSON.stringify(response.body)).not.toContain('Link inválido ou expirado');
    // And the driver's own words are not for an unauthenticated caller.
    expect(JSON.stringify(response.body)).not.toContain(INFRA_MESSAGE);
    // Not the template arm -- getActiveTemplate resolves in every case here.
    expect(JSON.stringify(response.body)).not.toContain('Termo de consentimento indisponível');
  }

  describe('POST /api/e-consent/consent-tokens/validate', () => {
    it('answers 503 when the participant lookup itself fails', async () => {
      useDb(null, { findOne: vi.fn().mockRejectedValue(new Error(INFRA_MESSAGE)) });

      const response = await request(app)
        .post('/api/e-consent/consent-tokens/validate')
        .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN });

      expectInfrastructureAnswer(response);
    });
  });

  describe('POST /api/e-consent/consent-tokens/accept', () => {
    it('answers 503 when the participant lookup itself fails', async () => {
      useDb(null, { findOne: vi.fn().mockRejectedValue(new Error(INFRA_MESSAGE)) });

      const response = await request(app)
        .post('/api/e-consent/consent-tokens/accept')
        .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN });

      expectInfrastructureAnswer(response);
    });

    // The worse half of the defect: the token was good, the participant DID
    // consent, and the write recording it failed. Telling them the link is
    // invalid leaves them believing they failed to consent.
    it('answers 503 when the acceptance write fails on a valid token', async () => {
      // #821: an accept now carries the manifestation and is recorded by the
      // canonical recorder before the status write; stubbed so this case keeps
      // exercising the token check and the write it guards.
      vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({ _id: 'tpl-1', active: true, permissions: [] });
      vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({ consentId: 'uuid-1', consentVersion: '1' });
      useDb(patientDoc(), {
        updateOne: vi.fn().mockRejectedValue(new Error(INFRA_MESSAGE)),
      });

      const response = await request(app)
        .post('/api/e-consent/consent-tokens/accept')
        .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN, consentTemplateId: 'tpl-1', responses: {} });

      expectInfrastructureAnswer(response);
    });
  });

  // CONTROL. Everything below has the same expected behaviour before and after
  // the fix (#695). A red here is the harness, or a regression of #823 -- not
  // this bug.
  describe('CONTROL: #823 is unchanged', () => {
    const AUTHORIZATION_PROBES = [
      { name: 'unknown participantId', patient: null, token: WRONG_TOKEN },
      { name: 'already consented', patient: patientDoc({ status: 'ACTIVE' }), token: WRONG_TOKEN },
      { name: 'wrong token', patient: patientDoc(), token: WRONG_TOKEN },
      {
        name: 'expired token',
        patient: patientDoc({ consentTokenExpiresAt: new Date('2020-01-01T00:00:00.000Z') }),
        token: VALID_TOKEN,
      },
    ];

    for (const path of [
      '/api/e-consent/consent-tokens/validate',
      '/api/e-consent/consent-tokens/accept',
    ]) {
      it(`CONTROL: ${path} still answers every authorization failure with one opaque 400`, async () => {
        const results = [];
        for (const probe of AUTHORIZATION_PROBES) {
          useDb(probe.patient);
          const response = await request(app)
            .post(path)
            .send({ patientId: PARTICIPANT_ID, token: probe.token });
          results.push({ name: probe.name, status: response.status, body: response.body });
        }

        const distinct = new Set(results.map((r) => `${r.status} ${JSON.stringify(r.body)}`));
        expect(
          [...distinct],
          `expected one response shape, got ${distinct.size}:\n` +
            results.map((r) => `  ${r.name} -> ${r.status} ${JSON.stringify(r.body)}`).join('\n')
        ).toHaveLength(1);
        expect(results[0].status).toBe(400);
        expect(results[0].body).toEqual({ success: false, error: 'Link inválido ou expirado' });
      });
    }

    it('CONTROL: a valid token still validates', async () => {
      useDb(patientDoc());

      const response = await request(app)
        .post('/api/e-consent/consent-tokens/validate')
        .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN });

      expect(response.status).toBe(200);
      expect(response.body.data.valid).toBe(true);
    });

    it('CONTROL: a valid token still accepts', async () => {
      // #821: an accept now carries the manifestation and is recorded by the
      // canonical recorder before the status write; stubbed so this case keeps
      // exercising the token check and the write it guards.
      vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({ _id: 'tpl-1', active: true, permissions: [] });
      vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({ consentId: 'uuid-1', consentVersion: '1' });
      useDb(patientDoc());

      const response = await request(app)
        .post('/api/e-consent/consent-tokens/accept')
        .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN, consentTemplateId: 'tpl-1', responses: {} });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
