/**
 * Unit tests for `isTransactionCapable` (#918).
 *
 * `typeof client.startSession === 'function'` is not enough to know a
 * transaction will succeed -- a real `MongoClient` always exposes
 * `startSession`, including against a standalone mongod, where
 * `session.withTransaction` then throws. `isTransactionCapable` runs
 * `hello` against the `admin` database instead and treats a replica set
 * (`setName` present) or a mongos (`msg === 'isdbgrid'`) as capable.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isTransactionCapable, isKnownStandaloneDeployment, withMongoTransaction } = require('../../../src/utils/mongoTransaction');
const { createDbMock } = require('../../factories/db.factory');

function createDb(commandImpl) {
  const command = vi.fn(commandImpl);
  const client = {
    db: vi.fn((name) => (name === 'admin' ? { command } : undefined)),
  };
  return { db: { client }, command };
}

describe('isTransactionCapable', () => {
  it('is capable when hello reports a replica set (setName present)', async () => {
    const { db, command } = createDb(async () => ({ setName: 'rs0', ismaster: true }));

    await expect(isTransactionCapable(db)).resolves.toBe(true);
    expect(command).toHaveBeenCalledWith({ hello: 1 });
  });

  it('is capable when hello reports a mongos (msg === "isdbgrid")', async () => {
    const { db } = createDb(async () => ({ msg: 'isdbgrid' }));

    await expect(isTransactionCapable(db)).resolves.toBe(true);
  });

  it('is not capable for a bare standalone hello response (no setName, not isdbgrid)', async () => {
    const { db } = createDb(async () => ({ ismaster: true, maxWireVersion: 21 }));

    await expect(isTransactionCapable(db)).resolves.toBe(false);
  });

  it('is not capable when the hello command throws', async () => {
    const { db } = createDb(async () => {
      throw new Error('not authorized on admin to execute command');
    });

    await expect(isTransactionCapable(db)).resolves.toBe(false);
  });
});

// #923: isKnownStandaloneDeployment is deliberately NOT the negation of
// isTransactionCapable. The two callers want opposite defaults when the
// topology cannot be determined -- "may I use a transaction?" must answer no,
// "should I refuse with a topology error?" must also answer no. Collapsing
// them into one boolean made every test fake that mocks a client without
// mocking `hello` look like a standalone deployment, which turned 18 existing
// storage tests red for a reason that had nothing to do with their subject.
describe('isKnownStandaloneDeployment (#923)', () => {
  it('is true only on a positive standalone answer from hello', async () => {
    const { db } = createDb(async () => ({ ismaster: true, maxBsonObjectSize: 16777216 }));
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(true);
  });

  it('is false for a replica set', async () => {
    const { db } = createDb(async () => ({ setName: 'rs0', ismaster: true }));
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
  });

  it('is false for a mongos', async () => {
    const { db } = createDb(async () => ({ msg: 'isdbgrid' }));
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
  });

  it('is false when hello throws -- unknown is not standalone', async () => {
    const { db } = createDb(async () => { throw new Error('no admin'); });
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
    // The mirror question answers false too: unknown is not capable either.
    await expect(isTransactionCapable(db)).resolves.toBe(false);
  });

  it('is false for a mock client with no db() at all -- the 18-red case', async () => {
    const db = { client: { startSession: () => ({}) } };
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
    await expect(isTransactionCapable(db)).resolves.toBe(false);
  });
});

// #1000: the shared test db factory (tests/factories/db.factory.js) grew a
// client capable of representing a Mongo transaction so integration tests
// can cover the six call sites that previously died at "Cliente Mongo não
// suporta transação" for lack of a db.client at all. This proves the
// factory's mock actually satisfies the real contract above -- both halves
// of it, per the 646a2c5d regression this constraint mirrors (a client with
// only one of startSession/db is not enough) -- rather than merely looking
// plausible.
describe('createDbMock client (#1000)', () => {
  it('is transaction-capable and not flagged standalone out of the box', async () => {
    const db = createDbMock({});

    await expect(isTransactionCapable(db)).resolves.toBe(true);
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
    expect(db.client.db).toHaveBeenCalledWith('admin');
  });

  it('runs withMongoTransaction end to end through client.startSession/session.withTransaction/endSession', async () => {
    const db = createDbMock({});

    const result = await withMongoTransaction(db, async (session) => {
      expect(session).toBe(db.session);
      return 'handler-result';
    });

    expect(result).toBe('handler-result');
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('exposes the same session instance client.startSession() returns as db.session', () => {
    const db = createDbMock({});

    expect(db.client.startSession()).toBe(db.session);
  });
});
