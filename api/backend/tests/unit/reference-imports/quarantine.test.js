import { describe, it, expect } from 'vitest';
const { resolveImportIssue } = require('../../../src/reference-data/reference-imports/quarantine');

/**
 * Same "real query-matching, not a canned stub" fake collection pattern as
 * pipeline.test.js, scoped to referenceImportIssues (findOne/updateOne on
 * referenceImportIssueId is all resolveImportIssue actually issues).
 */
function createFakeIssuesCollection(seedDocs = []) {
  const docs = seedDocs.map((doc) => ({ ...doc }));
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function createFakeDb(seedIssues) {
  const issues = createFakeIssuesCollection(seedIssues);
  return {
    issues,
    collection(name) {
      if (name !== 'referenceImportIssues') throw new Error(`unexpected collection: ${name}`);
      return issues;
    },
  };
}

const openIssue = () => ({
  referenceImportIssueId: 'issue-1',
  referenceImportRunId: 'run-1',
  referenceDatasetReleaseId: 'release-1',
  entityType: 'TerminologyConcept',
  errorCode: 'MISSING_DISPLAY',
  errorMessage: 'display ausente',
  severity: 'error',
  resolutionStatus: 'open',
  resolvedAt: null,
  resolvedBy: null,
  resolutionNotes: null,
});

describe('reference-imports quarantine resolveImportIssue (AC 7 quarantine recovery)', () => {
  it('transitions an open issue to corrected, recording who/when/why', async () => {
    const fakeDb = createFakeDb([openIssue()]);

    const resolved = await resolveImportIssue({
      db: fakeDb,
      referenceImportIssueId: 'issue-1',
      resolutionStatus: 'corrected',
      resolvedBy: 'Actor/curator-1',
      resolutionNotes: 'Corrigido no mappingVersion 1.0.1.',
    });

    expect(resolved.resolutionStatus).toBe('corrected');
    expect(resolved.resolvedBy).toBe('Actor/curator-1');
    expect(resolved.resolutionNotes).toBe('Corrigido no mappingVersion 1.0.1.');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    const stored = fakeDb.issues.docs[0];
    expect(stored.resolutionStatus).toBe('corrected');
    expect(stored.resolvedBy).toBe('Actor/curator-1');
  });

  it('rejects an unknown resolutionStatus', async () => {
    const fakeDb = createFakeDb([openIssue()]);

    await expect(
      resolveImportIssue({ db: fakeDb, referenceImportIssueId: 'issue-1', resolutionStatus: 'bogus', resolvedBy: 'Actor/curator-1' }),
    ).rejects.toThrow(/resolutionStatus/);
  });

  it('rejects resolving back to open (not a real resolution)', async () => {
    const fakeDb = createFakeDb([openIssue()]);

    await expect(
      resolveImportIssue({ db: fakeDb, referenceImportIssueId: 'issue-1', resolutionStatus: 'open', resolvedBy: 'Actor/curator-1' }),
    ).rejects.toThrow(/resolutionStatus/);
  });

  it('rejects when the issue does not exist', async () => {
    const fakeDb = createFakeDb([]);

    await expect(
      resolveImportIssue({ db: fakeDb, referenceImportIssueId: 'missing', resolutionStatus: 'closed', resolvedBy: 'Actor/curator-1' }),
    ).rejects.toThrow(/não encontrado/);
  });

  it('rejects resolving an issue that is already resolved (no silent double-resolution)', async () => {
    const fakeDb = createFakeDb([{ ...openIssue(), resolutionStatus: 'accepted', resolvedAt: new Date(), resolvedBy: 'Actor/prior' }]);

    await expect(
      resolveImportIssue({ db: fakeDb, referenceImportIssueId: 'issue-1', resolutionStatus: 'closed', resolvedBy: 'Actor/curator-1' }),
    ).rejects.toThrow(/já foi resolvido/);
  });

  it('requires resolvedBy', async () => {
    const fakeDb = createFakeDb([openIssue()]);

    await expect(
      resolveImportIssue({ db: fakeDb, referenceImportIssueId: 'issue-1', resolutionStatus: 'closed' }),
    ).rejects.toThrow(/resolvedBy/);
  });
});
