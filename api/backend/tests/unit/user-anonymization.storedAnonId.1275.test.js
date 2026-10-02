import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { getUserAnonId, generateAnonId } = require('../../src/utils/userAnonymization');

// #1275: user documents carry an ObjectId _id, and getUserAnonId receives the
// id as a string. Its lookup of the stored anonId used the string as-is, so
// it never matched and every read fell through to a freshly computed
// pseudonym, which a salt rotation would change.

const ID = new ObjectId('64b7f0c2a1b2c3d4e5f60718');

function makeDb(storedAnonId) {
  const findOne = vi.fn(async (filter) => (
    filter._id instanceof ObjectId && filter._id.equals(ID) ? { _id: ID, anonId: storedAnonId } : null
  ));
  return { collection: vi.fn(() => ({ findOne })), findOne };
}

const ORIGINAL_SALT = process.env.USER_ANON_SALT;
beforeEach(() => { process.env.USER_ANON_SALT = 'salt-1275'; });
afterEach(() => { process.env.USER_ANON_SALT = ORIGINAL_SALT; });

describe('#1275 getUserAnonId reads the stored anonId of an ObjectId-keyed user', () => {
  it('returns the stored pseudonym for a string id', async () => {
    const db = makeDb('USR-STORED01');
    expect(await getUserAnonId({ _id: ID.toString() }, db)).toBe('USR-STORED01');
  });

  it('returns it for an ObjectId too', async () => {
    expect(await getUserAnonId({ _id: ID }, makeDb('USR-STORED01'))).toBe('USR-STORED01');
  });

  it('control: no stored anonId falls back to the computed pseudonym', async () => {
    expect(await getUserAnonId({ _id: ID.toString() }, makeDb(undefined))).toBe(generateAnonId(ID.toString()));
  });

  it('control: an id that is not an ObjectId is looked up as given and still falls back', async () => {
    const db = makeDb('USR-STORED01');
    expect(await getUserAnonId({ userID: 'legacy-id' }, db)).toBe(generateAnonId('legacy-id'));
    expect(db.findOne).toHaveBeenCalledWith({ _id: 'legacy-id' }, expect.anything());
  });
});
