/**
 * #797: the filter factory's own guarantees.
 *
 * `cursor.factory.unit.test.js` is the sibling of this file and exists for
 * the same reason: a shared test helper that nothing tests is a helper whose
 * promises are only ever checked by the call sites that already trust it.
 * The point of `filter.factory` is that a mock collection can FAIL — so the
 * central case here is the #788 shape, where the identity stub could not.
 */
import { describe, it, expect, vi } from 'vitest';

const { ObjectId } = require('mongodb');
const {
  matchesFilter,
  createMatchingCollection,
  createFilterCaptureStore,
} = require('../factories/filter.factory');

describe('filter.factory — matchesFilter', () => {
  it('matches on top-level equality and rejects a non-matching value', () => {
    const doc = { participantId: '53117577', status: 'ACTIVE' };
    expect(matchesFilter(doc, { participantId: '53117577' })).toBe(true);
    expect(matchesFilter(doc, { participantId: '64404470' })).toBe(false);
  });

  it('treats an empty filter as matching everything', () => {
    expect(matchesFilter({ a: 1 }, {})).toBe(true);
    expect(matchesFilter({ a: 1 })).toBe(true);
  });

  it('requires every key of a multi-key filter (implicit AND)', () => {
    const doc = { patientId: 'p1', status: 'ACTIVE' };
    expect(matchesFilter(doc, { patientId: 'p1', status: 'ACTIVE' })).toBe(true);
    expect(matchesFilter(doc, { patientId: 'p1', status: 'REVOKED' })).toBe(false);
  });

  it('resolves dotted paths, and does not throw when the path runs off the document', () => {
    const doc = { normalized: { participantId: 'P9' } };
    expect(matchesFilter(doc, { 'normalized.participantId': 'P9' })).toBe(true);
    expect(matchesFilter(doc, { 'normalized.participantId': 'P8' })).toBe(false);
    expect(matchesFilter(doc, { 'missing.deeply.nested': 'x' })).toBe(false);
  });

  it('compares ObjectId to an equal ObjectId and to its hex string', () => {
    const id = new ObjectId();
    const doc = { _id: id };
    expect(matchesFilter(doc, { _id: new ObjectId(id.toHexString()) })).toBe(true);
    expect(matchesFilter(doc, { _id: id.toHexString() })).toBe(true);
    expect(matchesFilter(doc, { _id: new ObjectId() })).toBe(false);
  });

  it('does not mistake an ObjectId for an operator object', () => {
    const id = new ObjectId();
    // An ObjectId has object-typed keys of its own; if it were treated as an
    // operator envelope the equality branch would never run.
    expect(matchesFilter({ _id: id }, { _id: id })).toBe(true);
  });

  it('supports $or, $and, $in, $nin, $ne and $exists', () => {
    const doc = { a: 1, b: 'x' };
    expect(matchesFilter(doc, { $or: [{ a: 99 }, { b: 'x' }] })).toBe(true);
    expect(matchesFilter(doc, { $or: [{ a: 99 }, { b: 'y' }] })).toBe(false);
    expect(matchesFilter(doc, { $and: [{ a: 1 }, { b: 'x' }] })).toBe(true);
    expect(matchesFilter(doc, { $and: [{ a: 1 }, { b: 'y' }] })).toBe(false);
    expect(matchesFilter(doc, { b: { $in: ['x', 'z'] } })).toBe(true);
    expect(matchesFilter(doc, { b: { $in: ['y', 'z'] } })).toBe(false);
    expect(matchesFilter(doc, { b: { $nin: ['y', 'z'] } })).toBe(true);
    expect(matchesFilter(doc, { b: { $nin: ['x'] } })).toBe(false);
    expect(matchesFilter(doc, { b: { $ne: 'y' } })).toBe(true);
    expect(matchesFilter(doc, { b: { $ne: 'x' } })).toBe(false);
    expect(matchesFilter(doc, { a: { $exists: true } })).toBe(true);
    expect(matchesFilter(doc, { c: { $exists: false } })).toBe(true);
    expect(matchesFilter(doc, { c: { $exists: true } })).toBe(false);
  });

  it('reproduces the driver undefined -> null coercion that caused #788', () => {
    // NOT a friendlier database: the Node driver serializes an undefined
    // filter value to BSON null, and null matches an absent field. That is
    // literally how `{ patientID: undefined }` matched every patient
    // document live. Modelling it as "matches nothing" would hide the bug.
    const docs = [{ participantId: 'A' }, { participantId: 'B' }];
    expect(docs.every((doc) => matchesFilter(doc, { patientID: undefined }))).toBe(true);
    expect(matchesFilter({ a: null }, { a: undefined })).toBe(true);
    expect(matchesFilter({ a: undefined }, { a: null })).toBe(true);
    expect(matchesFilter({ a: null }, { a: null })).toBe(true);
  });

  it('never equates null with the string "null"', () => {
    expect(matchesFilter({ a: null }, { a: 'null' })).toBe(false);
    expect(matchesFilter({ a: 'null' }, { a: null })).toBe(false);
  });

  it('distinguishes an absent field from a present null under $exists', () => {
    expect(matchesFilter({ a: null }, { a: { $exists: true } })).toBe(true);
    expect(matchesFilter({}, { a: { $exists: true } })).toBe(false);
  });

  it('is documented as looser than Mongo on numeric/string coercion', () => {
    // Recorded, not endorsed: String()-based comparison is what makes the
    // ObjectId cases above work, and this is its price. A test that depends
    // on 1 !== '1' must assert on the captured filter instead.
    expect(matchesFilter({ a: 1 }, { a: '1' })).toBe(true);
  });
});

describe('filter.factory — createMatchingCollection', () => {
  it('resolves findOne by filter rather than returning a fixed document', async () => {
    const patients = createMatchingCollection([
      { _id: 'patient-unrelated', participantId: '64404470' },
      { _id: 'patient-real', participantId: '53117577' },
    ]);

    await expect(patients.findOne({ participantId: '53117577' }))
      .resolves.toMatchObject({ _id: 'patient-real' });
    await expect(patients.findOne({ participantId: '64404470' }))
      .resolves.toMatchObject({ _id: 'patient-unrelated' });
  });

  it('answers the degenerate #788 query differently from the correct one', async () => {
    // The whole point of the factory. Ordered so the degenerate filter finds
    // the WRONG document first, exactly as the live database did — 7/7
    // patients lacked `patientID`, and a sample for participant 53117577 was
    // badged from patient 64404470.
    const patients = createMatchingCollection([
      { _id: 'patient-unrelated', participantId: '64404470' },
      { _id: 'patient-real', participantId: '53117577' },
    ]);

    const sample = { participantId: '53117577' };
    // The pre-#788 query shape: a field no writer sets, on either side.
    const degenerate = { $or: [{ patientID: sample.patientID }, { _id: sample.patientID }] };
    const correct = { participantId: sample.participantId };

    await expect(patients.findOne(degenerate))
      .resolves.toMatchObject({ _id: 'patient-unrelated' });
    await expect(patients.findOne(correct))
      .resolves.toMatchObject({ _id: 'patient-real' });

    // The identity stub `findOne: vi.fn().mockResolvedValue(patient)` gives
    // the same answer to both, which is why five tests over this exact path
    // stayed green through the bug.
  });

  it('returns null when nothing matches, rather than the first document', async () => {
    const patients = createMatchingCollection([{ _id: 'p1', participantId: 'A' }]);
    await expect(patients.findOne({ participantId: 'Z' })).resolves.toBeNull();
  });

  it('exposes vi mocks so call-count and argument assertions still work', async () => {
    const patients = createMatchingCollection([{ _id: 'p1' }]);
    await patients.findOne({ _id: 'p1' });
    expect(vi.isMockFunction(patients.findOne)).toBe(true);
    expect(patients.findOne).toHaveBeenCalledWith({ _id: 'p1' });
  });

  it('filters find() and returns a cursor that captures its sort spec', async () => {
    const store = createFilterCaptureStore();
    const samples = createMatchingCollection(
      [
        { _id: 's1', status: 'ACTIVE' },
        { _id: 's2', status: 'ARCHIVED' },
        { _id: 's3', status: 'ACTIVE' },
      ],
      { ...store, key: 'samples' }
    );

    const rows = await samples.find({ status: 'ACTIVE' }).sort({ createdAt: -1 }).limit(10).toArray();

    expect(rows.map((row) => row._id)).toEqual(['s1', 's3']);
    expect(store.capturedFilters.samples).toEqual({ status: 'ACTIVE' });
    expect(store.capturedSorts.samples).toEqual({ createdAt: -1 });
    expect(store.capturedLimits.samples).toBe(10);
  });

  it('counts only the matching documents', async () => {
    const samples = createMatchingCollection([
      { status: 'ACTIVE' },
      { status: 'ARCHIVED' },
      { status: 'ACTIVE' },
    ]);
    await expect(samples.countDocuments({ status: 'ACTIVE' })).resolves.toBe(2);
    await expect(samples.countDocuments()).resolves.toBe(3);
  });

  it('applies writes to the same documents the reads see', async () => {
    const samples = createMatchingCollection([
      { _id: 's1', status: 'PENDING' },
      { _id: 's2', status: 'PENDING' },
    ]);

    const one = await samples.updateOne({ _id: 's1' }, { $set: { status: 'DONE' } });
    expect(one).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    await expect(samples.findOne({ _id: 's1' })).resolves.toMatchObject({ status: 'DONE' });

    const many = await samples.updateMany({ status: 'PENDING' }, { $set: { status: 'DONE' } });
    expect(many).toMatchObject({ matchedCount: 1 });
    await expect(samples.countDocuments({ status: 'DONE' })).resolves.toBe(2);

    await samples.insertOne({ _id: 's3', status: 'NEW' });
    await expect(samples.findOne({ _id: 's3' })).resolves.toMatchObject({ status: 'NEW' });

    await samples.deleteOne({ _id: 's3' });
    await expect(samples.findOne({ _id: 's3' })).resolves.toBeNull();

    const deleted = await samples.deleteMany({ status: 'DONE' });
    expect(deleted).toMatchObject({ deletedCount: 2 });
    await expect(samples.countDocuments()).resolves.toBe(0);
  });

  // #1336: the driver's insert contract, which code under test reads back.
  it('gives an inserted document without an _id a fresh ObjectId, as the driver does', async () => {
    const files = createMatchingCollection([]);
    const doc = { name: 'a' };

    const one = await files.insertOne(doc);
    const many = await files.insertMany([{ name: 'b' }, { _id: 'kept', name: 'c' }]);

    expect(doc._id).toBeInstanceOf(ObjectId);
    expect(one.insertedId).toBe(doc._id);
    expect(many.insertedIds[0]).toBeInstanceOf(ObjectId);
    expect(many.insertedIds[1]).toBe('kept');
    await expect(files.findOne({ _id: one.insertedId })).resolves.toBe(doc);
  });

  it('reports matchedCount 0 rather than silently succeeding on a miss', async () => {
    const samples = createMatchingCollection([{ _id: 's1' }]);
    await expect(samples.updateOne({ _id: 'nope' }, { $set: { a: 1 } }))
      .resolves.toMatchObject({ matchedCount: 0, modifiedCount: 0 });
  });

  it('copies the seed array so a shared fixture is not mutated across cases', async () => {
    const seed = [{ _id: 's1', status: 'PENDING' }];
    const first = createMatchingCollection(seed);
    await first.insertOne({ _id: 's2' });
    await first.updateOne({ _id: 's1' }, { $set: { status: 'DONE' } });

    expect(seed).toHaveLength(1);
    // Documents themselves are shared by reference (a shallow copy of the
    // array), which is the same contract the hand-rolled copies had. Only
    // the array is private.
    const second = createMatchingCollection(seed);
    await expect(second.countDocuments()).resolves.toBe(1);
  });
});
