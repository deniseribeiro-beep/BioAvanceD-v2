import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const { runBiomarkerAssociationImport } = require('../../src/reference-data/reference-imports/importBiomarkerAssociations');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  '../../src/reference-data/reference-imports/fixtures/biomarker-associations-sample.jsonl',
);

describe('runBiomarkerAssociationImport', () => {
  let updateOne;
  let findOne;
  let db;

  beforeEach(() => {
    updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1, matchedCount: 0 });
    findOne = vi.fn().mockResolvedValue(null);
    db = {
      collection: vi.fn(() => ({ updateOne, findOne })),
    };
  });

  it('upserts every valid fixture row', async () => {
    const result = await runBiomarkerAssociationImport(db, { fixturePath: FIXTURE });

    expect(result.recordsRead).toBe(16);
    expect(result.recordsRejected).toBe(0);
    expect(result.recordsInserted).toBe(16);
    expect(updateOne).toHaveBeenCalledTimes(16);
    const firstFilter = updateOne.mock.calls[0][0];
    expect(firstFilter).toEqual({ biomarkerId: 'ba-gla-orpha-324' });
  });

  it('dry-run does not write', async () => {
    const result = await runBiomarkerAssociationImport(db, { fixturePath: FIXTURE, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.recordsInserted).toBe(16);
    expect(updateOne).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalled();
  });
});
