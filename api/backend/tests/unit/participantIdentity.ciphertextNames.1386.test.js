import { describe, it, expect } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const participantIdentityService = require('../../src/services/participantIdentity.service');
const { encryptValue } = require('../../src/utils/fieldEncryption');

// #1386: ParticipantIdentity's ciphertext is stored as <field>Ciphertext
// (docs/decisions/2026-10-17-participant-identity-names-and-fields.md,
// item 1). A record written before the move holds <field>Encrypted, which no
// reader falls back to (item 9): the migration moves it, and writers $unset it.

const PLAINTEXT = {
  patientName: 'Maria da Silva',
  birthDate: '1980-05-17T00:00:00.000Z',
  identityDocument: '52998224725',
  email: 'maria@example.com',
  phone: '11999998888',
  representativeName: 'Rep Legal',
  representativeEmail: 'rep@example.com',
  representativeIdentityDocument: '98765432100',
  representativePhone: '11955554444',
};

describe('ParticipantIdentity ciphertext names (#1386)', () => {
  it('encryptIdentityFields writes the nine *Ciphertext keys and no *Encrypted key', () => {
    const result = participantIdentityService.encryptIdentityFields({ participantId: '1', ...PLAINTEXT, birthDate: new Date(PLAINTEXT.birthDate) });

    for (const field of Object.keys(PLAINTEXT)) {
      expect(result[`${field}Ciphertext`]).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    }
    expect(Object.keys(result).filter((key) => key.endsWith('Encrypted'))).toEqual([]);
  });

  it('decryptIdentity of a record holding only patientNameEncrypted leaves patientName unset', () => {
    const identity = participantIdentityService.decryptIdentity({
      participantId: '1',
      patientNameEncrypted: encryptValue(PLAINTEXT.patientName),
    });

    expect(identity).not.toHaveProperty('patientName');
  });

  it('a new name holding null stays null, whatever the old name holds', () => {
    const identity = participantIdentityService.decryptIdentity({
      participantId: '1',
      email: null,
      emailCiphertext: null,
      emailEncrypted: encryptValue('stale@example.com'),
    });

    expect(identity.email).toBeNull();
  });

  it('a record holding both names gives the new name its value', () => {
    const identity = participantIdentityService.decryptIdentity({
      participantId: '1',
      email: null,
      emailCiphertext: encryptValue('new@example.com'),
      emailEncrypted: encryptValue('old@example.com'),
    });

    expect(identity.email).toBe('new@example.com');
  });

  it('legacyCiphertextUnset names the old name of every new name the $set carries, null included', () => {
    const updatedAt = new Date();

    expect(participantIdentityService.legacyCiphertextUnset({
      emailCiphertext: encryptValue('maria@example.com'),
      patientNameCiphertext: null,
      updatedAt,
    })).toEqual({ emailEncrypted: '', patientNameEncrypted: '' });
    expect(participantIdentityService.legacyCiphertextUnset({ updatedAt })).toEqual({});
  });
});
