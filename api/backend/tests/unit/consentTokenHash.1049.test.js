import { describe, it, expect, vi } from 'vitest';

const crypto = require('crypto');
const { hashConsentToken, consentTokenMatches } = require('../../src/utils/consentTokenHash');
const { migrateConsentTokenHash } = require('../../src/scripts/migrateConsentTokenHash');

// #1049: the consent-link credential is stored as its SHA-256 and compared in
// constant time; legacy plaintext rows are converted by a one-shot migration.

describe('hashConsentToken (#1049)', () => {
  it('is the hex SHA-256 of the token', () => {
    const token = 'a'.repeat(64);
    expect(hashConsentToken(token)).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  it('never returns the token itself', () => {
    const token = crypto.randomBytes(32).toString('hex');
    expect(hashConsentToken(token)).not.toBe(token);
    expect(hashConsentToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('consentTokenMatches (#1049)', () => {
  const token = crypto.randomBytes(32).toString('hex');
  const stored = hashConsentToken(token);

  it('accepts the token whose hash is stored', () => {
    expect(consentTokenMatches(stored, token)).toBe(true);
  });

  it('refuses any other token', () => {
    expect(consentTokenMatches(stored, token.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toBe(false);
  });

  it('refuses the stored hash presented as if it were the token', () => {
    expect(consentTokenMatches(stored, stored)).toBe(false);
  });

  it('refuses when nothing is stored or nothing is presented', () => {
    expect(consentTokenMatches(null, token)).toBe(false);
    expect(consentTokenMatches(undefined, token)).toBe(false);
    expect(consentTokenMatches('', token)).toBe(false);
    expect(consentTokenMatches(stored, '')).toBe(false);
    expect(consentTokenMatches(stored, null)).toBe(false);
  });

  it('refuses a stored value of the wrong length without throwing', () => {
    expect(consentTokenMatches('short', token)).toBe(false);
  });

  it('compares with crypto.timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    consentTokenMatches(stored, token);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('migrateConsentTokenHash (#1049)', () => {
  function fakeDb(docs) {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const find = vi.fn(() => ({ toArray: async () => docs }));
    const collection = { find, updateOne, collectionName: 'patients' };
    return { db: { collection: () => collection }, find, updateOne };
  }

  it('selects only rows that still carry a consentToken field', async () => {
    const { db, find } = fakeDb([]);
    await migrateConsentTokenHash(db);
    expect(find).toHaveBeenCalledWith({ consentToken: { $exists: true } }, expect.anything());
  });

  it('replaces a plaintext token with its hash and removes the plaintext', async () => {
    const { db, updateOne } = fakeDb([{ _id: 'p1', consentToken: 'legacy-token' }]);

    const summary = await migrateConsentTokenHash(db);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'p1', consentToken: 'legacy-token' },
      { $set: { consentTokenHash: hashConsentToken('legacy-token') }, $unset: { consentToken: '' } }
    );
    expect(summary).toEqual({ hashed: 1, clearedNull: 0 });
  });

  it('only removes a null consentToken, writing no hash for it', async () => {
    const { db, updateOne } = fakeDb([{ _id: 'p2', consentToken: null }]);

    const summary = await migrateConsentTokenHash(db);

    expect(updateOne).toHaveBeenCalledWith({ _id: 'p2' }, { $unset: { consentToken: '' } });
    expect(summary).toEqual({ hashed: 0, clearedNull: 1 });
  });

  it('a migrated token then validates against the stored hash', async () => {
    const { db, updateOne } = fakeDb([{ _id: 'p3', consentToken: 'emailed-link-token' }]);
    await migrateConsentTokenHash(db);
    const storedHash = updateOne.mock.calls[0][1].$set.consentTokenHash;
    expect(consentTokenMatches(storedHash, 'emailed-link-token')).toBe(true);
  });
});
