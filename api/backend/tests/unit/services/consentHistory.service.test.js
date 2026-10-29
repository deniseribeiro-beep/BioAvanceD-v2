import { describe, it, expect } from 'vitest';
const {
  deriveConsentState,
  effectivePermissionsOf,
} = require('../../../src/services/consentHistory.service');
const ConsentDecisionEventModel = require('../../../src/models/ConsentDecisionEvent');
const ConsentRevocationModel = require('../../../src/models/ConsentRevocation');

// RF010 AC5/AC6: a consent's state is a function of its history. These pin
// the derivation; consent.service.unit.test.js pins the writers around it.
const consent = (overrides = {}) => ({
  _id: 'oid-1',
  consentId: 'c-1',
  status: 'ACTIVE',
  responses: { storage: true, contact: true, commercial: false },
  ...overrides,
});
const hourAgo = new Date(Date.now() - 3600 * 1000);
const revocation = (scope, effectiveAt = hourAgo) => ({ consentId: 'c-1', scope, effectiveAt });

describe('deriveConsentState', () => {
  it('derives an accepted consent with no revocation as active, its permissions as given', () => {
    const state = deriveConsentState(consent(), [{ decision: 'accepted', occurredAt: hourAgo }], []);
    expect(state).toMatchObject({
      currentStateDerived: 'active',
      status: 'ACTIVE',
      effectivePermissions: { storage: true, contact: true, commercial: false },
      revokedAt: null,
      withdrawalDateTime: null,
      withdrawalScope: [],
    });
  });

  it('derives a scoped revocation as partially_revoked, blocking only its permissions', () => {
    const state = deriveConsentState(consent(), [], [revocation(['contact'])]);
    expect(state.currentStateDerived).toBe('partially_revoked');
    expect(state.status).toBe('ACTIVE');
    expect(state.effectivePermissions).toEqual({ storage: true, contact: false, commercial: false });
    expect(state.withdrawalScope).toEqual(['contact']);
    expect(state.withdrawalDateTime).toEqual(hourAgo);
    expect(state.revokedAt).toBeNull();
  });

  it('derives a revocation of every granted permission as revoked', () => {
    const state = deriveConsentState(consent(), [], [revocation(['contact']), revocation(['storage'])]);
    expect(state.currentStateDerived).toBe('revoked');
    expect(state.status).toBe('REVOKED');
    expect(state.withdrawalScope).toEqual(['all']);
    expect(Object.values(state.effectivePermissions).every((value) => value === false)).toBe(true);
  });

  it('derives an `all` revocation as revoked, with its effective time', () => {
    const state = deriveConsentState(consent(), [], [revocation(['all'])]);
    expect(state.currentStateDerived).toBe('revoked');
    expect(state.revokedAt).toEqual(hourAgo);
  });

  it('leaves a revocation not yet in effect out of the state (prospective effect)', () => {
    const later = new Date(Date.now() + 3600 * 1000);
    const state = deriveConsentState(consent(), [], [revocation(['all'], later)]);
    expect(state.currentStateDerived).toBe('active');
    expect(state.effectivePermissions.storage).toBe(true);
  });

  it('derives a superseded consent as superseded, permitting nothing', () => {
    const state = deriveConsentState(consent(), [{ decision: 'superseded', occurredAt: hourAgo }], []);
    expect(state.currentStateDerived).toBe('superseded');
    expect(state.status).toBe('REVOKED');
    expect(state.revokedAt).toEqual(hourAgo);
    expect(state.effectivePermissions.storage).toBe(false);
  });

  it('keeps a consent revoked before this history existed revoked', () => {
    const revokedAt = new Date('2026-01-01T00:00:00Z');
    const state = deriveConsentState(consent({ status: 'REVOKED', revokedAt }), [], []);
    expect(state.currentStateDerived).toBe('revoked');
    expect(state.revokedAt).toEqual(revokedAt);
  });

  it('never changes the responses it derives from', () => {
    const given = consent();
    const snapshot = JSON.parse(JSON.stringify(given.responses));
    deriveConsentState(given, [], [revocation(['all'])]);
    expect(given.responses).toEqual(snapshot);
  });
});

describe('effectivePermissionsOf', () => {
  it('reads the derived permissions where a recompute wrote them', () => {
    expect(effectivePermissionsOf({ responses: { a: true }, effectivePermissions: { a: false } })).toEqual({ a: false });
  });

  it('falls back to the responses for a document no recompute touched', () => {
    expect(effectivePermissionsOf({ responses: { a: true } })).toEqual({ a: true });
    expect(effectivePermissionsOf(null)).toEqual({});
  });
});

describe('ConsentDecisionEventModel', () => {
  const valid = {
    consentId: 'c-1', templateVersionId: 't-1', signerId: 'p-1', evidenceUri: 'objstore://x', evidenceHash: 'sha256:0',
    channel: 'paper', signerRole: 'participant', authenticationLevel: 'basic', decision: 'accepted',
  };

  it('accepts a complete event and creates it with an id and times', () => {
    expect(ConsentDecisionEventModel.validate(valid).isValid).toBe(true);
    const event = ConsentDecisionEventModel.create(valid);
    expect(event.consentDecisionEventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.recordedAt).toBeInstanceOf(Date);
  });

  it('refuses an event missing its evidence or naming an unknown vocabulary value', () => {
    const { errors } = ConsentDecisionEventModel.validate({ ...valid, evidenceHash: '', channel: 'fax', decision: 'maybe' });
    expect(errors).toEqual(expect.arrayContaining([
      'evidenceHash é obrigatório',
      expect.stringContaining('channel deve ser um de'),
      expect.stringContaining('decision deve ser um de'),
    ]));
  });

  it('names the dictionary elements V2E-0121..0131', () => {
    expect(Object.keys(ConsentDecisionEventModel.fieldsOf())).toEqual([
      'consentDecisionEventId', 'consentId', 'templateVersionId', 'channel', 'signerId', 'signerRole',
      'authenticationLevel', 'decision', 'evidenceUri', 'evidenceHash', 'occurredAt',
    ]);
  });
});

describe('ConsentPermissionModel.fromAnswers (RF010 AC3)', () => {
  const ConsentPermissionModel = require('../../../src/models/ConsentPermission');

  it('writes one permit or deny row per answer, under the term version and validity', () => {
    const rows = ConsentPermissionModel.fromAnswers({
      consentId: 'c-1',
      participantId: 'p-1',
      responses: { storage: true, contact: false },
      template: {
        version: 'v3',
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2027-01-01T00:00:00Z',
        permissions: [{ key: 'storage', label: 'Armazenamento' }],
      },
      signedAt: new Date('2026-10-08T00:00:00Z'),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      consentId: 'c-1',
      permissionCode: 'storage',
      purpose: { code: 'storage', display: 'Armazenamento' },
      decision: 'permit',
      policyVersion: 'v3',
      validityPeriod: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') },
    });
    expect(rows[1]).toMatchObject({ permissionCode: 'contact', purpose: { code: 'contact', display: 'contact' }, decision: 'deny' });
  });

  it('names the dictionary elements V2E-0113..0120', () => {
    expect(Object.keys(ConsentPermissionModel.fieldsOf())).toEqual([
      'consentPermissionId', 'consentId', 'permissionCode', 'purpose', 'decision', 'conditions', 'policyVersion', 'validityPeriod',
    ]);
  });
});

describe('ConsentRevocationModel', () => {
  const valid = { consentId: 'c-1', decisionEventId: 'e-1', scope: ['contact'], priorUseDisposition: 'retain_history' };

  it('accepts a scope of the consent\'s own permissions or `all`', () => {
    expect(ConsentRevocationModel.validate(valid, ['contact']).isValid).toBe(true);
    expect(ConsentRevocationModel.validate({ ...valid, scope: ['all'] }, []).isValid).toBe(true);
  });

  it('refuses an empty scope, an unknown permission and an unknown disposition', () => {
    expect(ConsentRevocationModel.validate({ ...valid, scope: [] }, ['contact']).isValid).toBe(false);
    expect(ConsentRevocationModel.validate({ ...valid, scope: ['genetic'] }, ['contact']).errors[0]).toMatch(/genetic/);
    expect(ConsentRevocationModel.validate({ ...valid, priorUseDisposition: 'erase' }, ['contact']).isValid).toBe(false);
  });

  it('collapses a scope naming `all` to `all`', () => {
    expect(ConsentRevocationModel.create({ ...valid, scope: ['contact', 'all'] }).scope).toEqual(['all']);
  });

  it('names the dictionary elements V2E-0132..0139', () => {
    expect(Object.keys(ConsentRevocationModel.fieldsOf())).toEqual([
      'consentRevocationId', 'consentId', 'scope', 'effectiveAt', 'reason',
      'priorUseDisposition', 'retentionObligationIds', 'decisionEventId',
    ]);
  });
});
