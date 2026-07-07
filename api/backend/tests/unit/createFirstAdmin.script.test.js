import { describe, it, expect, vi } from 'vitest';

const bcrypt = require('bcryptjs');
const { createFirstAdmin } = require('../../src/scripts/createFirstAdmin');

function createMockDb(usersCount = 0) {
  const users = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    countDocuments: vi.fn().mockResolvedValue(usersCount),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'admin-user-id' } }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const systemBootstrap = {
    updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
  };

  return {
    users,
    systemBootstrap,
    db: {
      collection: vi.fn((name) => {
        if (name === 'users') return users;
        if (name === 'systemBootstrap') return systemBootstrap;
        throw new Error(`Unexpected collection ${name}`);
      }),
    },
  };
}

const validEnv = {
  BOOTSTRAP_ADMIN_NAME: 'Primeiro Admin',
  BOOTSTRAP_ADMIN_EMAIL: 'Admin.Seguro@BioAvanceD.test',
  BOOTSTRAP_ADMIN_USERNAME: 'admin-seguro',
  BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'SenhaForte@123',
};

describe('createFirstAdmin', () => {
  it('nao cria admin se users ja contem usuario', async () => {
    const { db, users, systemBootstrap } = createMockDb(1);

    const result = await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result).toEqual({ status: 'skipped', reason: 'users_exist', usersCount: 1 });
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).not.toHaveBeenCalled();
  });

  it('cria admin com senha hasheada quando users esta vazia', async () => {
    const { db, users, systemBootstrap } = createMockDb(0);

    const result = await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result.status).toBe('created');
    expect(users.insertOne).toHaveBeenCalledTimes(1);
    const inserted = users.insertOne.mock.calls[0][0];
    expect(inserted.email).toBe('admin.seguro@bioavanced.test');
    expect(inserted.accessType).toBe(4);
    expect(inserted.forceReset).toBe(true);
    expect(inserted.password).not.toBe(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD);
    await expect(bcrypt.compare(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD, inserted.password)).resolves.toBe(true);
    expect(systemBootstrap.updateOne).toHaveBeenCalledWith(
      { _id: 'first_admin_bootstrap_v1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'created',
          forceReset: true,
        }),
      }),
      { upsert: true }
    );
  });

  it('falha se faltar variavel obrigatoria', async () => {
    const { db, users } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_EMAIL: '' };

    await expect(createFirstAdmin({ db, env, logger: { info: vi.fn() } })).rejects.toThrow('BOOTSTRAP_ADMIN_EMAIL');
    expect(users.insertOne).not.toHaveBeenCalled();
  });

  it('nao registra senha temporaria no logger', async () => {
    const { db } = createMockDb(0);
    const logger = { info: vi.fn() };

    await createFirstAdmin({ db, env: validEnv, logger });

    const logs = logger.info.mock.calls.flat().join(' ');
    expect(logs).not.toContain(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD);
  });
});
