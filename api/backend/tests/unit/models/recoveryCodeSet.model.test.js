import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RecoveryCodeSetModel = require('../../../src/models/RecoveryCodeSet');

describe('RecoveryCodeSetModel.fieldsOf', () => {
  it('is pure: no input gives an empty set with null ids and timestamps', () => {
    expect(RecoveryCodeSetModel.fieldsOf()).toEqual({
      recoveryCodeSetId: null,
      userAccountId: null,
      codeHashes: [],
      remainingCount: 0,
      usedCodeHashes: [],
      generatedAt: null,
      regeneratedAt: null,
      invalidatedAt: null,
    });
  });

  it('counts the code hashes it is given as remaining, unless told otherwise', () => {
    expect(RecoveryCodeSetModel.fieldsOf({ codeHashes: ['a', 'b', 'c'] }).remainingCount).toBe(3);
    expect(RecoveryCodeSetModel.fieldsOf({ codeHashes: ['a', 'b', 'c'], remainingCount: 1 }).remainingCount).toBe(1);
  });

  it('never carries a pre-dictionary name', () => {
    const keys = Object.keys(RecoveryCodeSetModel.fieldsOf({ codeHashes: ['a'], generatedAt: new Date() }));
    expect(keys.filter((key) => RecoveryCodeSetModel.LEGACY_FIELDS.includes(key))).toEqual([]);
  });
});

describe('RecoveryCodeSetModel.remainingOf', () => {
  it('reads the canonical count, then the pre-dictionary one, then zero', () => {
    expect(RecoveryCodeSetModel.remainingOf({ remainingCount: 3, remaining: 9 })).toBe(3);
    expect(RecoveryCodeSetModel.remainingOf({ remainingCount: 0, remaining: 9 })).toBe(0);
    expect(RecoveryCodeSetModel.remainingOf({ remaining: 4 })).toBe(4);
    expect(RecoveryCodeSetModel.remainingOf(null)).toBe(0);
  });
});

describe('RecoveryCodeSetModel.unspentHashesOf (#1331)', () => {
  it('reads codeHashes, then the pre-dictionary codes, then nothing', () => {
    expect(RecoveryCodeSetModel.unspentHashesOf({ codeHashes: ['a'], codes: ['z'] })).toEqual(['a']);
    expect(RecoveryCodeSetModel.unspentHashesOf({ codeHashes: [], codes: ['z'] })).toEqual([]);
    expect(RecoveryCodeSetModel.unspentHashesOf({ codes: ['z'] })).toEqual(['z']);
    expect(RecoveryCodeSetModel.unspentHashesOf({})).toEqual([]);
    expect(RecoveryCodeSetModel.unspentHashesOf(null)).toEqual([]);
  });

  it('gives nothing for an invalidated set (P1X-0275)', () => {
    expect(RecoveryCodeSetModel.unspentHashesOf({ codeHashes: ['a'], invalidatedAt: new Date() })).toEqual([]);
  });
});

describe('RecoveryCodeSetModel.spendOf (#1331)', () => {
  it('spends a canonical set only while the hash is unspent and the set valid', () => {
    const { filter, update } = RecoveryCodeSetModel.spendOf({ _id: 'set-1', codeHashes: ['a', 'b'] }, 'b', 'ignored');
    expect(filter).toEqual({ _id: 'set-1', codeHashes: 'b', invalidatedAt: null });
    expect(update).toEqual({
      $pull: { codeHashes: 'b' },
      $push: { usedCodeHashes: 'b' },
      $inc: { remainingCount: -1 },
    });
  });

  it('converts a legacy set in the same write, conditioned on the old field', () => {
    const createdAt = new Date('2026-01-02T03:04:05Z');
    const { filter, update } = RecoveryCodeSetModel.spendOf(
      { _id: 'set-1', userID: 'owner', codes: ['a', 'b', 'c'], remaining: 3, createdAt },
      'b',
      'new-set-id'
    );
    expect(filter).toEqual({ _id: 'set-1', codes: 'b' });
    expect(update.$set).toEqual({
      recoveryCodeSetId: 'new-set-id',
      userAccountId: 'owner',
      codeHashes: ['a', 'c'],
      remainingCount: 2,
      usedCodeHashes: ['b'],
      generatedAt: createdAt,
      regeneratedAt: null,
      invalidatedAt: null,
    });
    expect(Object.keys(update.$unset).sort()).toEqual([...RecoveryCodeSetModel.LEGACY_FIELDS].sort());
  });
});
