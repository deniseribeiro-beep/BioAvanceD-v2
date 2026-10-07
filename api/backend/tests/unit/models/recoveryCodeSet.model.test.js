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
