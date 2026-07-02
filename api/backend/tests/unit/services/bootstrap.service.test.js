import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const crypto = require('crypto');
const { ensureInitialAdmin } = require('../../../src/services/bootstrap.service');

function makeFakeCollection() {
  return {
    findOne: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn(),
    insertOne: vi.fn()
  };
}

function makeFakeDb(collections) {
  return {
    collection: vi.fn((name) => collections[name])
  };
}

// Mirrors the real generateAnonId implementation (SHA-256 based, deterministic)
// so we can assert the exact expected anonId without needing to mock the
// destructured `require('../utils/userAnonymization')` import (spies on the
// exporting module have no effect post-destructuring in this codebase).
function expectedAnonId(userID, salt = process.env.USER_ANON_SALT || 'BioAdvanceD-LGPD-2024') {
  const hash = crypto.createHash('sha256').update(String(userID) + salt).digest('hex');
  return `USR-${hash.substring(0, 8).toUpperCase()}`;
}

describe('bootstrap.service - ensureInitialAdmin', () => {
  let systemBootstrap;
  let users;
  let db;

  beforeEach(() => {
    systemBootstrap = makeFakeCollection();
    users = makeFakeCollection();
    db = makeFakeDb({ systemBootstrap, users });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns early when a bootstrap marker already exists', async () => {
    systemBootstrap.findOne.mockResolvedValue({ _id: 'initial_admin_seed_v1', status: 'created' });

    await ensureInitialAdmin(db);

    expect(systemBootstrap.findOne).toHaveBeenCalledWith({ _id: 'initial_admin_seed_v1' });
    expect(users.countDocuments).not.toHaveBeenCalled();
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).not.toHaveBeenCalled();
  });

  it('skips and marks users_exist when users collection already has documents', async () => {
    systemBootstrap.findOne.mockResolvedValue(null);
    users.countDocuments.mockResolvedValue(5);

    await ensureInitialAdmin(db);

    expect(users.countDocuments).toHaveBeenCalled();
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = systemBootstrap.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'initial_admin_seed_v1' });
    expect(update.$set.status).toBe('skipped');
    expect(update.$set.reason).toBe('users_exist');
    expect(update.$set.usersCount).toBe(5);
    expect(options).toEqual({ upsert: true });
  });

  it('skips and marks admin_already_exists when an admin with the configured email/username exists', async () => {
    systemBootstrap.findOne.mockResolvedValue(null);
    users.countDocuments.mockResolvedValue(0);
    users.findOne.mockResolvedValue({ _id: 'existing-admin-id', email: 'admin@bioavanced.com.br' });

    await ensureInitialAdmin(db);

    expect(users.findOne).toHaveBeenCalledWith({
      $or: [
        { email: 'admin@bioavanced.com.br' },
        { username: 'admin' }
      ]
    });
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = systemBootstrap.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'initial_admin_seed_v1' });
    expect(update.$set.status).toBe('skipped');
    expect(update.$set.reason).toBe('admin_already_exists');
    expect(options).toEqual({ upsert: true });
  });

  it('creates the initial admin, hashes the password, assigns an anonId, and records a created marker', async () => {
    systemBootstrap.findOne.mockResolvedValue(null);
    users.countDocuments.mockResolvedValue(0);
    users.findOne.mockResolvedValue(null);

    const insertedId = { toString: () => 'new-admin-id-123' };
    users.insertOne.mockResolvedValue({ insertedId });
    users.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const bcrypt = require('bcryptjs');
    const hashSpy = vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password-value');

    await ensureInitialAdmin(db);

    // Password hashing
    expect(hashSpy).toHaveBeenCalledWith('Admin@123', 10);

    // Admin user inserted with expected shape
    expect(users.insertOne).toHaveBeenCalledTimes(1);
    const insertedUser = users.insertOne.mock.calls[0][0];
    expect(insertedUser).toMatchObject({
      name: 'Administrador',
      email: 'admin@bioavanced.com.br',
      username: 'admin',
      password: 'hashed-password-value',
      accessType: 4,
      roleName: 'Administrador',
      status: 'active',
      mfaEnabled: false,
      anonId: null
    });

    // anonId update uses the real, deterministic generateAnonId output
    expect(users.updateOne).toHaveBeenCalledTimes(1);
    const [anonFilter, anonUpdate] = users.updateOne.mock.calls[0];
    expect(anonFilter).toEqual({ _id: insertedId });
    expect(anonUpdate.$set.anonId).toBe(expectedAnonId('new-admin-id-123'));

    // Final bootstrap marker records success
    expect(systemBootstrap.updateOne).toHaveBeenCalledTimes(1);
    const [bootFilter, bootUpdate, bootOptions] = systemBootstrap.updateOne.mock.calls[0];
    expect(bootFilter).toEqual({ _id: 'initial_admin_seed_v1' });
    expect(bootUpdate.$set.status).toBe('created');
    expect(bootUpdate.$set.userId).toBe('new-admin-id-123');
    expect(bootOptions).toEqual({ upsert: true });
  });
});
