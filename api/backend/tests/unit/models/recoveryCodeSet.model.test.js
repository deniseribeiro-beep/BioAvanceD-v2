import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RecoveryCodeSetModel = require('../../../src/models/RecoveryCodeSet');

describe('RecoveryCodeSetModel.fieldsOf', () => {
  it('is pure: no input gives an empty set with null timestamps', () => {
    expect(RecoveryCodeSetModel.fieldsOf()).toEqual({
      userID: null,
      codes: [],
      remaining: 0,
      usedCodes: [],
      createdAt: null,
      updatedAt: null,
    });
  });

  it('counts the codes it is given as remaining, unless told otherwise', () => {
    expect(RecoveryCodeSetModel.fieldsOf({ codes: ['a', 'b', 'c'] }).remaining).toBe(3);
    expect(RecoveryCodeSetModel.fieldsOf({ codes: ['a', 'b', 'c'], remaining: 1 }).remaining).toBe(1);
  });

  it('keeps the owner and timestamps it is given', () => {
    const at = new Date('2026-10-07T12:00:00Z');
    const fields = RecoveryCodeSetModel.fieldsOf({ userID: 'u1', createdAt: at, updatedAt: at });
    expect(fields.userID).toBe('u1');
    expect(fields.createdAt).toEqual(at);
    expect(fields.updatedAt).toEqual(at);
  });
});
