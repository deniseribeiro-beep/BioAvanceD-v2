import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  isTransactionCapable,
  assertTransactionCapable,
  isKnownStandaloneDeployment,
  withMongoTransaction
} = require('../../../src/utils/mongoTransaction');
const { createDbMock } = require('../../factories/db.factory');

function createDb(commandImpl) {
  const command = vi.fn(commandImpl);
  const startSession = vi.fn(() => ({
    withTransaction: vi.fn(async (handler) => handler()),
    endSession: vi.fn().mockResolvedValue(undefined),
  }));
  const client = {
    db: vi.fn((name) => (name === 'admin' ? { command } : undefined)),
    startSession,
  };
  return { db: { client }, command, startSession };
}

describe('transaction capability (#923)', () => {
  it('accepts a replica set', async () => {
    const { db, command } = createDb(async () => ({ setName: 'rs0', isWritablePrimary: true }));
    await expect(isTransactionCapable(db)).resolves.toBe(true);
    await expect(assertTransactionCapable(db)).resolves.toBe(true);
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
    expect(command).toHaveBeenCalledWith({ hello: 1 });
  });

  it('accepts mongos', async () => {
    const { db } = createDb(async () => ({ msg: 'isdbgrid' }));
    await expect(assertTransactionCapable(db)).resolves.toBe(true);
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
  });

  it('refuses a known standalone before startSession', async () => {
    const { db, startSession } = createDb(async () => ({ isWritablePrimary: true, maxWireVersion: 21 }));
    await expect(assertTransactionCapable(db)).rejects.toMatchObject({
      code: 'MONGO_TRANSACTIONS_REQUIRED',
      topology: 'standalone'
    });
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(true);
    await expect(withMongoTransaction(db, async () => 'never')).rejects.toMatchObject({
      code: 'MONGO_TRANSACTIONS_REQUIRED',
      topology: 'standalone'
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('refuses unknown topology before startSession when hello fails', async () => {
    const { db, startSession } = createDb(async () => { throw new Error('not authorized on admin'); });
    await expect(isTransactionCapable(db)).resolves.toBe(false);
    await expect(assertTransactionCapable(db)).rejects.toMatchObject({
      code: 'MONGO_TRANSACTIONS_REQUIRED',
      topology: 'unknown'
    });
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(true);
    await expect(withMongoTransaction(db, async () => 'never')).rejects.toMatchObject({ topology: 'unknown' });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('refuses a client that cannot probe admin topology', async () => {
    const startSession = vi.fn();
    const db = { client: { startSession } };
    await expect(assertTransactionCapable(db)).rejects.toMatchObject({ topology: 'unknown' });
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(true);
    expect(startSession).not.toHaveBeenCalled();
  });
});

describe('createDbMock client (#1000/#923)', () => {
  it('is transaction-capable and passes the fail-closed guard out of the box', async () => {
    const db = createDbMock({});
    await expect(isTransactionCapable(db)).resolves.toBe(true);
    await expect(assertTransactionCapable(db)).resolves.toBe(true);
    await expect(isKnownStandaloneDeployment(db)).resolves.toBe(false);
    expect(db.client.db).toHaveBeenCalledWith('admin');
  });

  it('runs withMongoTransaction end to end through one session', async () => {
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
});
