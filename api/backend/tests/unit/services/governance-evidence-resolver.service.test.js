import { describe, expect, it, vi } from 'vitest';

const {
  resolveGovernanceEvidence,
  MAX_REFERENCES_PER_CATEGORY,
} = require('../../../src/services/governance-evidence-resolver.service');
const { COLLECTION_NAME } = require('../../../src/services/neo4jOutbox.service');

// RNF018 AC5 (#1524): traceability, monitoring and documentation evidence
// references, resolved against the stored records before certification.

const hex = (digit) => digit.repeat(64);
const SPECIMEN = 'SPC-1524-A';
const OTHER_SPECIMEN = 'SPC-1524-B';
const SAMPLE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SAMPLE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const COLLECTION = 'COL-1524-A';

const CUSTODY = { eventId: 'evt-1', eventType: 'CUSTODY_EVENT_RECORDED', aggregateType: 'Sample', aggregateId: SAMPLE_ID, payloadHash: hex('1') };
const OTHER_CUSTODY = { eventId: 'evt-2', eventType: 'CUSTODY_EVENT_RECORDED', aggregateType: 'Sample', aggregateId: OTHER_SAMPLE_ID, payloadHash: hex('2') };
const SUMMARY = { telemetryExposureSummaryId: 'tes-1', specimenId: SPECIMEN, sourceReadingSetHash: `sha256:${hex('3')}` };
const APPROVAL = { approvalId: 'apr-1', collectionId: COLLECTION, status: 'active', documentChecksum: hex('A') };
const OTHER_APPROVAL = { approvalId: 'apr-2', collectionId: 'COL-1524-B', status: 'active', documentChecksum: hex('A') };

const REF = {
  traceability: { uri: 'urn:bioavanced:custody-event:evt-1', hash: `sha256:${hex('1')}` },
  monitoring: { uri: 'urn:bioavanced:telemetry-exposure-summary:tes-1', hash: `sha256:${hex('3')}` },
  documentation: { uri: 'urn:bioavanced:collection-governance-approval:apr-1', hash: `sha256:${hex('a')}` },
};

// A db whose findOne returns the first stored document equal to the filter
// on every filter key, so a query that drops a key matches more.
function fakeDb() {
  const stores = {
    samples: [{ _id: SAMPLE_ID, specimenId: SPECIMEN }, { _id: OTHER_SAMPLE_ID, specimenId: OTHER_SPECIMEN }],
    [COLLECTION_NAME]: [OTHER_CUSTODY, CUSTODY],
    telemetryExposureSummaries: [SUMMARY],
    collectionGovernanceApprovals: [APPROVAL, OTHER_APPROVAL],
  };
  const collection = vi.fn((name) => ({
    findOne: vi.fn(async (filter) => (stores[name] || [])
      .find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null),
    createIndex: vi.fn(async () => 'ok'),
  }));
  return { collection };
}

const resolveOne = (category, ref, specimenId = SPECIMEN, collectionId = COLLECTION) => resolveGovernanceEvidence(fakeDb(), {
  governanceEvidence: { [category]: [ref] },
  specimenId,
  collectionId,
});

describe('resolveGovernanceEvidence (RNF018 AC5, #1524)', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['an array', [REF.traceability]],
    ['a string', 'urn:bioavanced:custody-event:evt-1'],
    ['empty', {}],
    ['empty categories', { traceability: [], monitoring: [], documentation: [] }],
    ['only unknown keys', { sop: [REF.documentation] }],
  ])('is null and reads no record when governanceEvidence is %s', async (_name, governanceEvidence) => {
    const db = fakeDb();
    expect(await resolveGovernanceEvidence(db, { governanceEvidence, specimenId: SPECIMEN })).toBeNull();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('resolves one reference of each kind, returning only the presented categories', async () => {
    const result = await resolveGovernanceEvidence(fakeDb(), {
      governanceEvidence: { traceability: [REF.traceability], monitoring: [REF.monitoring], documentation: [REF.documentation], other: [1] },
      specimenId: SPECIMEN,
      collectionId: COLLECTION,
    });
    expect(result).toEqual({
      traceability: [{ ...REF.traceability, status: 'resolved' }],
      monitoring: [{ ...REF.monitoring, status: 'resolved' }],
      documentation: [{ ...REF.documentation, status: 'resolved' }],
    });
  });

  it('keeps only the categories presented', async () => {
    const result = await resolveGovernanceEvidence(fakeDb(), {
      governanceEvidence: { monitoring: [REF.monitoring], documentation: [] },
      specimenId: SPECIMEN,
    });
    expect(result).toEqual({ monitoring: [{ ...REF.monitoring, status: 'resolved' }] });
  });

  it('accepts a bare documentChecksum as the same sha256 value', async () => {
    expect(await resolveOne('documentation', REF.documentation))
      .toEqual({ documentation: [{ ...REF.documentation, status: 'resolved' }] });
  });

  it.each([
    ['absent', undefined],
    ['bare hex', hex('1')],
    ['upper-case hex', `sha256:${hex('A')}`],
    ['short', `sha256:${'1'.repeat(63)}`],
  ])('reads missing_hash for a hash %s', async (_name, hash) => {
    const result = await resolveOne('traceability', { uri: REF.traceability.uri, hash });
    expect(result.traceability).toEqual([{ uri: REF.traceability.uri, hash: hash ?? null, status: 'missing_hash' }]);
  });

  it.each([
    ['traceability', 'a bad scheme', 'https://example.org/custody-event/evt-1', SPECIMEN],
    ['traceability', 'no URI', undefined, SPECIMEN],
    ['traceability', 'a kind from another category', 'urn:bioavanced:collection-governance-approval:apr-1', SPECIMEN],
    ['monitoring', 'a kind from another category', 'urn:bioavanced:custody-event:evt-1', SPECIMEN],
    ['traceability', 'a record not found', 'urn:bioavanced:custody-event:evt-missing', SPECIMEN],
    ['monitoring', 'a record not found', 'urn:bioavanced:telemetry-exposure-summary:tes-missing', SPECIMEN],
    ['documentation', 'a record not found', 'urn:bioavanced:collection-governance-approval:apr-missing', SPECIMEN],
    ['traceability', "another sample's custody event", 'urn:bioavanced:custody-event:evt-2', SPECIMEN],
    ['monitoring', "another specimen's summary", 'urn:bioavanced:telemetry-exposure-summary:tes-1', OTHER_SPECIMEN],
    ['traceability', 'no specimenId', 'urn:bioavanced:custody-event:evt-1', null],
    ['monitoring', 'no specimenId', 'urn:bioavanced:telemetry-exposure-summary:tes-1', null],
    ['traceability', 'no sample with the specimenId', 'urn:bioavanced:custody-event:evt-1', 'SPC-NONE'],
  ])('reads unresolvable_uri for a %s reference with %s', async (category, _name, uri, specimenId) => {
    // The hash of the record the URI would name, so only the URI can fail.
    const hash = uri && uri.endsWith('evt-2') ? `sha256:${hex('2')}` : REF[category].hash;
    const result = await resolveOne(category, { uri, hash }, specimenId);
    expect(result[category]).toEqual([{ uri: uri ?? null, hash, status: 'unresolvable_uri' }]);
  });

  it.each([
    ['traceability'],
    ['monitoring'],
    ['documentation'],
  ])('reads hash_mismatch for a %s reference whose stored hash differs', async (category) => {
    const ref = { uri: REF[category].uri, hash: `sha256:${hex('f')}` };
    expect((await resolveOne(category, ref))[category]).toEqual([{ ...ref, status: 'hash_mismatch' }]);
  });

  it.each([
    ["another collection's approval", 'urn:bioavanced:collection-governance-approval:apr-2', COLLECTION],
    ['no collectionId', 'urn:bioavanced:collection-governance-approval:apr-1', null],
    ['a blank collectionId', 'urn:bioavanced:collection-governance-approval:apr-1', '  '],
  ])('reads unresolvable_uri for a documentation reference to %s', async (_name, uri, collectionId) => {
    const ref = { uri, hash: REF.documentation.hash };
    expect((await resolveOne('documentation', ref, SPECIMEN, collectionId)).documentation)
      .toEqual([{ ...ref, status: 'unresolvable_uri' }]);
  });

  it('reads unresolvable_uri for a reference that is not an object', async () => {
    expect((await resolveOne('documentation', 'urn:bioavanced:collection-governance-approval:apr-1')).documentation)
      .toEqual([{ uri: null, hash: null, status: 'unresolvable_uri' }]);
  });

  it.each([
    ['a string', 'urn:bioavanced:custody-event:evt-1'],
    ['an object', REF.traceability],
    ['null', null],
  ])('fails a category presented as %s closed, reading no record', async (_name, value) => {
    const db = fakeDb();
    const result = await resolveGovernanceEvidence(db, { governanceEvidence: { traceability: value }, specimenId: SPECIMEN });
    expect(result).toEqual({ traceability: [{ uri: null, hash: null, status: 'unresolvable_uri' }] });
    expect(db.collection).not.toHaveBeenCalled();
  });

  it(`fails a category of ${MAX_REFERENCES_PER_CATEGORY + 1} references closed, reading no record`, async () => {
    const db = fakeDb();
    const refs = Array.from({ length: MAX_REFERENCES_PER_CATEGORY + 1 }, () => REF.traceability);
    const result = await resolveGovernanceEvidence(db, { governanceEvidence: { traceability: refs }, specimenId: SPECIMEN });
    expect(result).toEqual({ traceability: [{ uri: null, hash: null, status: 'unresolvable_uri' }] });
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('keeps each reference of a category in order, and looks the sample up once', async () => {
    const db = fakeDb();
    const missing = { uri: REF.traceability.uri };
    const result = await resolveGovernanceEvidence(db, {
      governanceEvidence: { traceability: [REF.traceability, missing, REF.traceability] },
      specimenId: SPECIMEN,
    });
    expect(result.traceability.map((entry) => entry.status)).toEqual(['resolved', 'missing_hash', 'resolved']);
    expect(db.collection.mock.calls.filter(([name]) => name === 'samples')).toHaveLength(1);
  });
});
