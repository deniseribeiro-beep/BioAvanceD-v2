import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { hashConsentToken } = require('../../src/utils/consentTokenHash');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const auditLogger = require('../../src/utils/auditLogger');
const consentService = require('../../src/services/consent.service');

// #823: POST /api/e-consent/consent-tokens/validate and .../accept are
// unauthenticated BY DESIGN -- the emailed token is the only credential, so
// there is no session to gate them with. That makes their failure response the
// entire disclosure boundary: an unauthenticated caller supplying a guessed
// `patientId` and a junk token must learn nothing about whether that
// participant exists, and nothing about their consent state.
//
// `patientService.validateConsentToken` throws four DIFFERENT messages for the
// four failure conditions below, and both controllers echoed `error.message`
// straight back. That made the pair an oracle over biobank membership --
// exactly what RNF007/RF005 and the ParticipantIdentity segregation (#560,
// #562, #566) exist to prevent, since a pseudonymous id is only safe while
// membership itself stays unexposed.
//
// These pin INDISTINGUISHABILITY rather than any one message, because the
// defect is the difference between the responses, not the wording of any of
// them. A future fifth failure condition that forgets to be opaque fails here
// without anyone updating a literal.
const VALID_TOKEN = 'b'.repeat(64);
const WRONG_TOKEN = 'c'.repeat(64);
const PARTICIPANT_ID = '77222497';

// The phrases the service throws. Asserted absent individually as well as via
// the set-equality check, so a regression that makes the responses uniformly
// LEAKY (all four echoing the same detailed message) still reds.
const DISCLOSING_PHRASES = [
  'Paciente não encontrado',
  'Paciente não está pendente de consentimento',
  'Token inválido',
  'Token expirado',
];

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

describe('#823: the consent-token endpoints are not a participant-enumeration oracle', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
    // Keep the control case focused on the token check: an active TCLE is a
    // separate lookup whose absence would 503 before the 200 is reached.
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  function useDb(patient) {
    const patients = {
      ...genericCollection(),
      findOne: vi.fn().mockResolvedValue(patient),
    };
    app.locals.db = {
      collection: (name) =>
        name === 'patients' || name === 'pacientes' ? patients : genericCollection(),
    };
  }

  // The four failure conditions, in the order patientService checks them.
  const PROBES = [
    {
      name: 'unknown participantId',
      patient: null,
      token: WRONG_TOKEN,
    },
    {
      name: 'participant exists but has already consented',
      patient: patientDoc({ status: 'ACTIVE' }),
      token: WRONG_TOKEN,
    },
    {
      name: 'participant exists and is awaiting consent, wrong token',
      patient: patientDoc(),
      token: WRONG_TOKEN,
    },
    {
      name: 'participant exists and is awaiting consent, expired token',
      patient: patientDoc({ consentTokenExpiresAt: new Date('2020-01-01T00:00:00.000Z') }),
      token: VALID_TOKEN,
    },
  ];

  async function probeAll(path) {
    const results = [];
    for (const probe of PROBES) {
      useDb(probe.patient);
      const response = await request(app)
        .post(path)
        .send({ patientId: PARTICIPANT_ID, token: probe.token });
      results.push({ name: probe.name, status: response.status, body: response.body });
    }
    return results;
  }

  for (const path of [
    '/api/e-consent/consent-tokens/validate',
    '/api/e-consent/consent-tokens/accept',
  ]) {
    describe(`POST ${path}`, () => {
      it('answers all four failure conditions identically', async () => {
        const results = await probeAll(path);

        const distinct = new Set(
          results.map((r) => `${r.status} ${JSON.stringify(r.body)}`)
        );
        expect(
          [...distinct],
          `expected one response shape, got ${distinct.size}:\n` +
            results.map((r) => `  ${r.name} -> ${r.status} ${JSON.stringify(r.body)}`).join('\n')
        ).toHaveLength(1);
      });

      it('discloses none of the four distinguishing phrases', async () => {
        const results = await probeAll(path);

        for (const result of results) {
          const serialized = JSON.stringify(result.body);
          for (const phrase of DISCLOSING_PHRASES) {
            expect(serialized, `${result.name} leaked "${phrase}"`).not.toContain(phrase);
          }
        }
      });
    });
  }

  // CONTROL. Same expected behaviour before and after the fix: a participant
  // following their real emailed link must still be able to validate and
  // accept. A red here is the harness, not the bug (#695).
  it('CONTROL: a valid token still validates', async () => {
    useDb(patientDoc());

    const response = await request(app)
      .post('/api/e-consent/consent-tokens/validate')
      .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.valid).toBe(true);
    expect(response.body.data.participantId).toBe(PARTICIPANT_ID);
  });

  it('CONTROL: a valid token still accepts', async () => {
    // #821: an accept now carries the manifestation and is recorded by the
    // canonical recorder before the status write; stubbed so this case keeps
    // exercising the token check and the write it guards.
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue({ _id: 'tpl-1', active: true, permissions: [] });
    vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({ consentId: 'uuid-1', consentVersion: '1' });
    useDb(patientDoc());

    const response = await request(app)
      .post('/api/e-consent/consent-tokens/accept')
      .send({ patientId: PARTICIPANT_ID, token: VALID_TOKEN, consentTemplateId: 'tpl-1', responses: {} });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
