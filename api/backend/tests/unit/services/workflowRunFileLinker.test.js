import { describe, it, expect, vi } from 'vitest';
const { ObjectId } = require('mongodb');
const { resolveFileReference, FILE_COLLECTIONS } = require('../../../src/services/workflowRunFileLinker');

function makeDb(overrides = {}) {
  const collections = {
    sample_files: { findOne: vi.fn().mockResolvedValue(null) },
    assayFiles: { findOne: vi.fn().mockResolvedValue(null) },
    datasetFiles: { findOne: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  return { collection: (name) => collections[name] };
}

describe('workflowRunFileLinker.resolveFileReference (RF027 AC#3, #716 slice 2/4)', () => {
  it('has the 3 known per-parent file collections', () => {
    expect(FILE_COLLECTIONS).toEqual(['sample_files', 'assayFiles', 'datasetFiles']);
  });

  it('returns null for a malformed fileId (not a valid ObjectId)', async () => {
    const db = makeDb();
    const result = await resolveFileReference(db, 'not-an-object-id');
    expect(result).toBeNull();
  });

  it('returns null when the fileId is not found in any collection', async () => {
    const db = makeDb();
    const result = await resolveFileReference(db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it('returns "sample_files" when found there', async () => {
    const id = new ObjectId();
    const db = makeDb({ sample_files: { findOne: vi.fn().mockResolvedValue({ _id: id }) } });
    const result = await resolveFileReference(db, id.toString());
    expect(result).toBe('sample_files');
  });

  it('returns "assayFiles" when found there (and not in sample_files)', async () => {
    const id = new ObjectId();
    const db = makeDb({ assayFiles: { findOne: vi.fn().mockResolvedValue({ _id: id }) } });
    const result = await resolveFileReference(db, id.toString());
    expect(result).toBe('assayFiles');
  });

  it('returns "datasetFiles" when found there (and not in sample_files/assayFiles)', async () => {
    const id = new ObjectId();
    const db = makeDb({ datasetFiles: { findOne: vi.fn().mockResolvedValue({ _id: id }) } });
    const result = await resolveFileReference(db, id.toString());
    expect(result).toBe('datasetFiles');
  });

  it('checks sample_files before assayFiles/datasetFiles (first match wins)', async () => {
    const id = new ObjectId();
    const assayFindOne = vi.fn().mockResolvedValue({ _id: id });
    const db = makeDb({
      sample_files: { findOne: vi.fn().mockResolvedValue({ _id: id }) },
      assayFiles: { findOne: assayFindOne },
    });
    const result = await resolveFileReference(db, id.toString());
    expect(result).toBe('sample_files');
    expect(assayFindOne).not.toHaveBeenCalled();
  });
});
