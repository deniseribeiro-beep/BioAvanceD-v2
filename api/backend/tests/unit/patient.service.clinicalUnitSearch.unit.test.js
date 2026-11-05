import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

// Minimal in-memory matcher covering only what listPatients/searchPatients
// actually build: exact-match fields, {$regex,$options} fields, and $or.
function matchesQuery(doc, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some((clause) => matchesQuery(doc, clause));
    }
    if (expected && typeof expected === 'object' && '$regex' in expected) {
      const flags = expected.$options || '';
      return new RegExp(expected.$regex, flags).test(String(doc[key] ?? ''));
    }
    return doc[key] === expected;
  });
}

function makeInMemoryPatientsCollection(docs) {
  return {
    createIndex: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockImplementation((query = {}) => {
      const matched = docs.filter((doc) => matchesQuery(doc, query));
      return {
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(matched),
      };
    }),
    countDocuments: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(docs.filter((doc) => matchesQuery(doc, query)).length)
    ),
  };
}

function makeOrganizationsCollection(orgs) {
  return {
    findOne: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(
        orgs.find((org) =>
          (query.organizationId && org.organizationId === query.organizationId) ||
          (query.normalizedName && org.normalizedName === query.normalizedName)
        ) || null
      )
    ),
  };
}

function makeDb({ patients, organizations }) {
  return {
    collection: vi.fn((name) => {
      if (name === 'patients') return patients;
      if (name === 'organizations') return organizations;
      throw new Error(`unexpected collection requested: ${name}`);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clinicalUnit free-text search/filter paths stay consistent with Organization-derived snapshots (#355)', () => {
  it('listPatients({ clinicalUnit }) finds a patient whose clinicalUnit was resolved from Organization.officialName', async () => {
    const organizations = makeOrganizationsCollection([
      { organizationId: 'org-1', officialName: 'Genética Médica', acronym: 'GEN', normalizedName: 'genetica medica' },
    ]);
    const db = makeDb({ patients: null, organizations });

    const snapshot = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'org-1' });
    expect(snapshot.clinicalUnit).toBe('Genética Médica');

    const patients = makeInMemoryPatientsCollection([
      { participantId: '11111111', patientName: 'Ana', clinicalUnit: snapshot.clinicalUnit, unitAcronym: snapshot.unitAcronym },
      { participantId: '22222222', patientName: 'Bruno', clinicalUnit: 'Oncologia', unitAcronym: 'ONC' },
    ]);
    const identities = { find: vi.fn(() => ({ toArray: async () => [] })), createIndex: vi.fn(async () => undefined) };
    db.collection = vi.fn((name) => {
      if (name === 'patients') return patients;
      if (name === 'participantIdentities') return identities;
      return organizations;
    });

    const result = await patientService.listPatients(db, { clinicalUnit: snapshot.clinicalUnit });

    expect(result.patients.map((p) => p.participantId)).toEqual(['11111111']);
  });

  it('searchPatients(term) finds the same patient via a partial, case-insensitive match on the resolved name', async () => {
    const organizations = makeOrganizationsCollection([
      { organizationId: 'org-1', officialName: 'Genética Médica', acronym: 'GEN', normalizedName: 'genetica medica' },
    ]);
    const db = makeDb({ patients: null, organizations });

    const snapshot = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'org-1' });

    const patients = makeInMemoryPatientsCollection([
      { participantId: '11111111', patientName: 'Ana', clinicalUnit: snapshot.clinicalUnit, unitAcronym: snapshot.unitAcronym },
      { participantId: '22222222', patientName: 'Bruno', clinicalUnit: 'Oncologia', unitAcronym: 'ONC' },
    ]);
    // #1386: searchPatients also matches the term as a record number on
    // ParticipantIdentity, which holds none here.
    const participantIdentities = makeInMemoryPatientsCollection([]);
    db.collection = vi.fn((name) => {
      if (name === 'patients') return patients;
      if (name === 'participantIdentities') return participantIdentities;
      return organizations;
    });

    const result = await patientService.searchPatients(db, 'genética');

    expect(result.patients.map((p) => p.participantId)).toEqual(['11111111']);
  });
});
