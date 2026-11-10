import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { getUserAnonId, anonymizeLogUser, anonymizeLogs, generateAnonId } = require('../../src/utils/userAnonymization');

// #1530: auditLogger.extractUserInfo resolves the actor to its stored anonId,
// then anonymizeLogUser looked that USR- id up as a users _id, missed, and
// hashed it again. The logs row then carried a USR- id that matched no
// user's stored anonId, so it could not be filtered by it.

const ID = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
const STORED = 'USR-3263C209';

function makeDb() {
  const findOne = vi.fn(async (filter) => (
    filter._id instanceof ObjectId && filter._id.equals(ID) ? { _id: ID, anonId: STORED } : null
  ));
  return { collection: vi.fn(() => ({ findOne })), findOne };
}

const ORIGINAL_SALT = process.env.USER_ANON_SALT;
beforeEach(() => { process.env.USER_ANON_SALT = 'salt-1530'; });
afterEach(() => { process.env.USER_ANON_SALT = ORIGINAL_SALT; });

describe('#1530 anonymizeLogUser keeps a userID that is already a pseudonym', () => {
  it('keeps the stored anonId the audit logger resolved, and looks nothing up', async () => {
    const db = makeDb();
    const actor = await getUserAnonId({ _id: ID.toString() }, db);
    expect(actor).toBe(STORED);
    db.findOne.mockClear();

    const row = await anonymizeLogUser({ userID: actor, metadata: { user: { userID: actor, userRole: 'Técnico' } } }, db);

    expect(row.userID).toBe(STORED);
    expect(row.userId).toBe(STORED);
    expect(row.userName).toBe(STORED);
    expect(row.metadata.user.userID).toBe(STORED);
    expect(db.findOne).not.toHaveBeenCalled();
  });

  it('a stored row read back through anonymizeLogs keeps its pseudonym', async () => {
    const [row] = await anonymizeLogs([{ userID: STORED, userName: STORED }], makeDb());
    expect(row.userID).toBe(STORED);
  });

  it('keeps USR-SYSTEM as is', async () => {
    const row = await anonymizeLogUser({ userID: 'USR-SYSTEM' }, makeDb());
    expect(row.userID).toBe('USR-SYSTEM');
    expect(row.userName).toBe('USR-SYSTEM');
  });

  it('control: a raw ObjectId string still resolves to the stored anonId', async () => {
    const row = await anonymizeLogUser({ userID: ID.toString() }, makeDb());
    expect(row.userID).toBe(STORED);
  });

  it('control: a raw id with no user is hashed as before', async () => {
    const row = await anonymizeLogUser({ userID: 'legacy-id' }, makeDb());
    expect(row.userID).toBe(generateAnonId('legacy-id'));
  });

  it('control: a value only shaped like a pseudonym is hashed, not kept', async () => {
    for (const value of ['usr-3263c209', 'USR-3263C2091', 'USR-3263C20', ' USR-3263C209', 'USR-SYSTEMX']) {
      const row = await anonymizeLogUser({ userID: value }, makeDb());
      expect(row.userID).toBe(generateAnonId(value));
    }
  });
});
