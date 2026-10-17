import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');

// dict-02 ParticipantIdentity (#1386): every inserted record gets its own
// uuid (P1X-0348) and identityStatus 'active' (P1X-0361), and the model
// declares encryptionKeyVersion (P1X-0362). create() is fed whole import
// rows, so a row's own columns choose neither the id nor the status.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('ParticipantIdentityModel (#1386)', () => {
  it('create() gives a uuid participantIdentityId and identityStatus active', () => {
    const record = ParticipantIdentityModel.create({ participantId: '12345678' });

    expect(record.participantIdentityId).toMatch(UUID_V4);
    expect(record.identityStatus).toBe('active');
  });

  it('two create() calls give different ids', () => {
    const first = ParticipantIdentityModel.create({ participantId: '12345678' });
    const second = ParticipantIdentityModel.create({ participantId: '12345678' });

    expect(first.participantIdentityId).not.toBe(second.participantIdentityId);
  });

  it('create() ignores an identityStatus or participantIdentityId in its input', () => {
    const record = ParticipantIdentityModel.create({ participantId: '1', identityStatus: 'merged', participantIdentityId: 'chosen' });

    expect(record.identityStatus).toBe('active');
    expect(record.participantIdentityId).not.toBe('chosen');
    expect(record.participantIdentityId).toMatch(UUID_V4);
  });

  it('fieldsOf() declares participantIdentityId, identityStatus and encryptionKeyVersion', () => {
    expect(Object.keys(ParticipantIdentityModel.fieldsOf())).toEqual(
      expect.arrayContaining(['participantIdentityId', 'identityStatus', 'encryptionKeyVersion'])
    );
  });
});
