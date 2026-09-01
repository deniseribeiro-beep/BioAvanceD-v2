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
const { isTransactionCapable } = require('../../../src/utils/mongoTransaction');

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
