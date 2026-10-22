import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DataFileVersionModel = require('../../../src/models/DataFileVersion');

const CHECKSUM = 'c'.repeat(64);

// #1321 (RF007 AC4, RNF029 C3, V2E-0346..0353).
function v1(over = {}) {
  return {
    fileId: 'file-1',
    versionNumber: 1,
    objectUri: 'objstore://samples/s/files/old.csv',
    checksum: CHECKSUM,
    previousVersionId: null,
    changeReason: 'initial upload',
    createdAt: '2026-10-01T00:00:00Z',
    ...over
  };
}

function v2(over = {}) {
  return v1({ versionNumber: 2, previousVersionId: 'version-1', changeReason: 'replacement', ...over });
}

const ENVELOPE = {
  encryptionAlgorithm: 'aes-256-gcm',
  encryptionKeyId: 'key-1',
  encryptionIv: 'iv',
  encryptionTag: 'tag'
};

describe('DataFileVersionModel', () => {
  it('fieldsOf returns exactly the eight canonical fields (V2E-0346..0353)', () => {
    expect(Object.keys(DataFileVersionModel.fieldsOf())).toEqual([
      'dataFileVersionId',
      'fileId',
      'versionNumber',
      'objectUri',
      'checksum',
      'previousVersionId',
      'changeReason',
      'createdAt'
    ]);
  });

  it('accepts a valid version 1 and generates its dataFileVersionId', () => {
    const row = DataFileVersionModel.create(v1());
    expect(row.versionNumber).toBe(1);
    expect(row.previousVersionId).toBeNull();
    expect(row.dataFileVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.createdAt).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('accepts a valid version 2 linked to its predecessor', () => {
    const row = DataFileVersionModel.create(v2({ dataFileVersionId: 'version-2' }));
    expect(row).toMatchObject({ dataFileVersionId: 'version-2', versionNumber: 2, previousVersionId: 'version-1' });
  });

  it('carries the encryption envelope on create, never on fieldsOf', () => {
    const row = DataFileVersionModel.create(v1(ENVELOPE));
    expect(row).toMatchObject(ENVELOPE);
    const fields = DataFileVersionModel.fieldsOf(v1(ENVELOPE));
    for (const key of Object.keys(ENVELOPE)) expect(fields).not.toHaveProperty(key);
  });

  it('sets every envelope field to null when none is given', () => {
    const row = DataFileVersionModel.create(v1());
    expect(row).toMatchObject({ encryptionAlgorithm: null, encryptionKeyId: null, encryptionIv: null, encryptionTag: null });
  });

  it.each(['fileId', 'objectUri', 'checksum', 'changeReason'])('rejects an empty %s', (field) => {
    expect(() => DataFileVersionModel.create(v1({ [field]: '' }))).toThrow(`${field} é obrigatório`);
  });

  it('rejects a missing createdAt', () => {
    expect(() => DataFileVersionModel.create(v1({ createdAt: undefined }))).toThrow('createdAt');
  });

  it('rejects an invalid createdAt', () => {
    expect(() => DataFileVersionModel.create(v1({ createdAt: 'not-a-date' }))).toThrow('createdAt');
  });

  it.each([0, -1, 1.5, '1', undefined])('rejects versionNumber %s', (versionNumber) => {
    expect(() => DataFileVersionModel.create(v1({ versionNumber }))).toThrow('versionNumber');
  });

  it.each(['old-checksum', 'C'.repeat(64), 'c'.repeat(63), `sha256:${'c'.repeat(64)}`])('rejects checksum %s', (checksum) => {
    expect(() => DataFileVersionModel.create(v1({ checksum }))).toThrow('checksum');
  });

  it('rejects a version 1 with a previousVersionId', () => {
    expect(() => DataFileVersionModel.create(v1({ previousVersionId: 'version-0' }))).toThrow('previousVersionId');
  });

  it('rejects a version above 1 without a previousVersionId', () => {
    expect(() => DataFileVersionModel.create(v2({ previousVersionId: null }))).toThrow('previousVersionId');
  });
});
