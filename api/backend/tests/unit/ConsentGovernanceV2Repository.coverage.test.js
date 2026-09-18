import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const ConsentGovernanceV2Repository = require('../../src/infrastructure/persistence/mongo/ConsentGovernanceV2Repository');

function cursor(rows = []) {
  return {
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue(rows),
      })),
      toArray: vi.fn().mockResolvedValue(rows),
    })),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function makeCollection(overrides = {}) {
  return {
    createIndex: vi.fn().mockResolvedValue('idx'),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => cursor([])),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'id-1' }),
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    ...overrides,
  };
}

function makeDb(overrides = {}) {
  const collections = {
    consents: makeCollection(),
    consentPermissions: makeCollection(),
    consentDecisionEvents: makeCollection(),
    consentRevocations: makeCollection(),
    consentAuthorizationDecisions: makeCollection(),
    consentCommunicationEvents: makeCollection(),
    ...overrides,
  };

  return {
    db: {
      collection: vi.fn((name) => {
        if (!collections[name]) collections[name] = makeCollection();
        return collections[name];
      }),
    },
    collections,
  };
}

function graphProjection() {
  return {
    appendConsentEvent: vi.fn().mockResolvedValue({ queued: true }),
  };
}

describe('ConsentGovernanceV2Repository item 8 coverage', () => {
  it('rejects a missing MongoDB dependency', () => {
    expect(() => new ConsentGovernanceV2Repository(null)).toThrow('MongoDB obrigatório');
  });

  it('ensures all canonical indexes and skips a collection without createIndex', async () => {
    const { db, collections } = makeDb({
      consentCommunicationEvents: {},
    });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    await repo.ensureIndexes();

    expect(collections.consents.createIndex).toHaveBeenCalledTimes(2);
    expect(collections.consentPermissions.createIndex).toHaveBeenCalledTimes(2);
    expect(collections.consentDecisionEvents.createIndex).toHaveBeenCalledTimes(1);
    expect(collections.consentRevocations.createIndex).toHaveBeenCalledTimes(2);
    expect(collections.consentAuthorizationDecisions.createIndex).toHaveBeenCalledTimes(1);
  });

  it('covers ObjectId conversion and consent id filter variants', () => {
    const { db } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });
    const id = new ObjectId('507f1f77bcf86cd799439011');

    expect(repo.toObjectId(id)).toBe(id);
    expect(repo.toObjectId('507f1f77bcf86cd799439011')).toBeInstanceOf(ObjectId);
    expect(repo.toObjectId('not-an-object-id')).toBeNull();
    expect(repo.toObjectId(42)).toBeNull();

    expect(repo.consentIdFilter('consent-business-id')).toEqual({ consentId: 'consent-business-id' });
    const filter = repo.consentIdFilter('507f1f77bcf86cd799439011');
    expect(filter.$or[0]).toEqual({ consentId: '507f1f77bcf86cd799439011' });
    expect(filter.$or[1]._id).toBeInstanceOf(ObjectId);
  });

  it('normalizes permit/deny/review-required decisions across boolean, canonical and fallback inputs', () => {
    const { db } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    expect(repo.normalizePermissionDecision(true)).toBe('permit');
    expect(repo.normalizePermissionDecision(false)).toBe('deny');
    expect(repo.normalizePermissionDecision(' PERMIT ')).toBe('permit');
    expect(repo.normalizePermissionDecision('deny')).toBe('deny');
    expect(repo.normalizePermissionDecision('review_required')).toBe('review_required');
    expect(repo.normalizePermissionDecision('unknown')).toBe('review_required');
    expect(repo.normalizePermissionDecision(null)).toBe('review_required');
  });

  it('builds canonical permission documents from permissions and granularPermissions, including fallback purpose/validity and filtering empty codes', () => {
    const { db } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });
    const createdAt = new Date('2026-09-18T12:00:00.000Z');

    const direct = repo.buildPermissionDocuments({
      consentId: 'consent-1',
      template: {
        version: '2.0',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-12-31T23:59:59.000Z',
        permissions: [
          {
            permissionCode: 'research',
            purpose: { code: 'research' },
            validityPeriod: { start: createdAt, end: null },
            conditions: [{ type: 'site', value: 'A' }],
          },
          {
            key: 'future_use',
            purposeCode: '',
            validFrom: 'invalid-date',
            validTo: 'invalid-date',
          },
          {
            permissionCode: '   ',
          },
        ],
      },
      responses: {
        research: true,
        future_use: false,
      },
      createdAt,
    });

    expect(direct).toHaveLength(2);
    expect(direct[0]).toMatchObject({
      consentId: 'consent-1',
      permissionCode: 'research',
      purpose: { code: 'research' },
      decision: 'permit',
      conditions: [{ type: 'site', value: 'A' }],
      policyVersion: '2.0',
    });
    expect(direct[1].permissionCode).toBe('future_use');
    expect(direct[1].purpose).toEqual({ code: 'future_use' });
    expect(direct[1].decision).toBe('deny');
    expect(direct[1].validityPeriod.start).toEqual(createdAt);
    expect(direct[1].validityPeriod.end).toBeNull();
    expect(direct[1]).not.toHaveProperty('conditions');

    const granular = repo.buildPermissionDocuments({
      consentId: 'consent-2',
      template: {
        templateVersion: '3.0',
        granularPermissions: [{ key: 'secondary', purposeCode: 'secondary' }],
      },
      responses: {},
      createdAt,
    });
    expect(granular).toHaveLength(1);
    expect(granular[0]).toMatchObject({
      permissionCode: 'secondary',
      decision: 'review_required',
      policyVersion: '3.0',
    });

    expect(repo.buildPermissionDocuments({
      consentId: 'consent-3',
      template: {},
      responses: {},
      createdAt,
    })).toEqual([]);
  });

  it('requires a shared session, participant and template for createConsent', async () => {
    const { db } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    await expect(repo.createConsent({ participantId: 'p1', template: {} }))
      .rejects.toThrow('compartilhar a transação');

    await expect(repo.createConsent({ participantId: '  ', template: {} }, { id: 'tx' }))
      .rejects.toThrow('participantId obrigatório');

    await expect(repo.createConsent({ participantId: 'p1' }, { id: 'tx' }))
      .rejects.toThrow('ConsentTemplate obrigatório');
  });

  it('creates consent, permissions, decision events and graph outbox using explicit fields', async () => {
    const { db, collections } = makeDb();
    const graph = graphProjection();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graph });
    vi.spyOn(repo, 'findActiveConsent').mockResolvedValue(null);

    const signedAt = new Date('2026-09-18T10:00:00.000Z');
    const result = await repo.createConsent({
      participantId: ' participant-1 ',
      consentId: 'consent-1',
      signedAt,
      templateVersionId: 'template-version-1',
      consentModel: ' DYNAMIC ',
      effectiveEnd: '2027-09-18T10:00:00.000Z',
      studyId: 'study-1',
      signatureName: 'Synthetic Signer',
      signatureHash: 'hash',
      signatureMimeType: 'image/png',
      signatureImageBase64: 'abc',
      actorId: 'actor-1',
      template: {
        version: 'template-version-fallback',
        permissions: [{ permissionCode: 'research', purposeCode: 'research' }],
      },
      responses: { research: true },
    }, { id: 'tx-1' });

    expect(result).toMatchObject({
      consentId: 'consent-1',
      participantId: 'participant-1',
      consentModel: 'dynamic',
      templateVersionId: 'template-version-1',
      currentStateDerived: 'active',
      studyId: 'study-1',
      signerDisplayName: 'Synthetic Signer',
      signatureHash: 'hash',
      signatureMimeType: 'image/png',
      signatureImageBase64: 'abc',
    });
    expect(result.permissions).toHaveLength(1);
    expect(collections.consents.insertOne).toHaveBeenCalledWith(expect.any(Object), { session: { id: 'tx-1' } });
    expect(collections.consentPermissions.insertMany).toHaveBeenCalledTimes(1);
    expect(collections.consentDecisionEvents.insertMany).toHaveBeenCalledTimes(1);
    expect(graph.appendConsentEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        participantId: 'participant-1',
        ethicalConsentId: 'consent-1',
        consentTemplateId: 'template-version-1',
        status: 'ACTIVE',
        signedAt,
      }),
      { session: { id: 'tx-1' } }
    );
  });

  it('supersedes a previous consent and covers generated/default createConsent fields with no permissions', async () => {
    const { db, collections } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });
    const previous = { consentId: 'old-consent' };
    vi.spyOn(repo, 'findActiveConsent').mockResolvedValue(previous);
    const revokeSpy = vi.spyOn(repo, 'revokeConsent').mockResolvedValue({});

    const result = await repo.createConsent({
      participantId: 'participant-2',
      template: { _id: 'template-object-id', consentModel: 'BROAD' },
      responses: undefined,
      actorId: undefined,
    }, { id: 'tx-2' });

    expect(result.consentId).toMatch(/^consent:/);
    expect(result.templateVersionId).toBe('template-object-id');
    expect(result.consentModel).toBe('broad');
    expect(result.effectivePeriod.end).toBeNull();
    expect(result.studyId).toBeNull();
    expect(result.signerDisplayName).toBeNull();
    expect(result.signatureHash).toBeNull();
    expect(result.signatureMimeType).toBeNull();
    expect(result.signatureImageBase64).toBeNull();
    expect(result.permissions).toEqual([]);
    expect(revokeSpy).toHaveBeenCalledWith(
      'old-consent',
      expect.objectContaining({
        reasonCode: 'superseded_by_new_consent',
        actorId: null,
        communicationRequired: false,
      }),
      { id: 'tx-2' }
    );
    expect(collections.consentPermissions.insertMany).not.toHaveBeenCalled();
    expect(collections.consentDecisionEvents.insertMany).not.toHaveBeenCalled();
  });

  it('gets consent by business/ObjectId id and returns null for blank ids', async () => {
    const id = '507f1f77bcf86cd799439011';
    const consents = makeCollection({ findOne: vi.fn().mockResolvedValue({ consentId: id }) });
    const { db } = makeDb({ consents });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    await expect(repo.getConsentById('   ', { id: 'tx' })).resolves.toBeNull();
    const result = await repo.getConsentById(id, { id: 'tx' });
    expect(result.consentId).toBe(id);
    expect(consents.findOne.mock.calls[0][0].$or).toHaveLength(2);
  });

  it('finds the newest active non-revoked consent, skips revoked candidates and handles blank participants', async () => {
    const activeRows = [
      { consentId: 'revoked-consent' },
      { consentId: 'active-consent' },
    ];
    const consents = makeCollection({
      find: vi.fn(() => cursor(activeRows)),
    });
    const revocations = makeCollection({
      findOne: vi.fn()
        .mockResolvedValueOnce({ consentRevocationId: 'r1' })
        .mockResolvedValueOnce(null),
    });
    const { db } = makeDb({ consents, consentRevocations: revocations });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    await expect(repo.findActiveConsent('   ', { id: 'tx' })).resolves.toBeNull();
    const found = await repo.findActiveConsent('participant-1', { id: 'tx' }, new Date('2026-09-18T12:00:00Z'));
    expect(found.consentId).toBe('active-consent');

    revocations.findOne.mockResolvedValue({ consentRevocationId: 'r2' });
    await expect(repo.findActiveConsent('participant-1', { id: 'tx' })).resolves.toBeNull();
  });

  it('requires a shared session for revocation and returns null when consent does not exist', async () => {
    const { db } = makeDb();
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    await expect(repo.revokeConsent('consent-1')).rejects.toThrow('compartilhar a transação');

    vi.spyOn(repo, 'getConsentById').mockResolvedValue(null);
    await expect(repo.revokeConsent('consent-1', {}, { id: 'tx' })).resolves.toBeNull();
  });

  it('returns an existing revocation without duplicating events', async () => {
    const { db, collections } = makeDb({
      consentRevocations: makeCollection({
        findOne: vi.fn().mockResolvedValue({ consentRevocationId: 'rev-existing' }),
      }),
    });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });
    vi.spyOn(repo, 'getConsentById').mockResolvedValue({
      consentId: 'consent-1',
      participantId: 'participant-1',
    });

    const result = await repo.revokeConsent('consent-1', {}, { id: 'tx' });
    expect(result.alreadyRevoked).toBe(true);
    expect(collections.consentRevocations.insertOne).not.toHaveBeenCalled();
  });

  it('revokes consent with communication, fallback values and graph projection', async () => {
    const graph = graphProjection();
    const { db, collections } = makeDb({
      consentRevocations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graph });
    const createdAt = new Date('2026-01-01T00:00:00Z');
    vi.spyOn(repo, 'getConsentById').mockResolvedValue({
      consentId: 'consent-1',
      participantId: 'participant-1',
      templateVersionId: null,
      effectivePeriod: {},
      createdAt,
      currentStateDerived: 'active',
    });

    const result = await repo.revokeConsent('consent-1', {
      effectiveAt: 'invalid',
      actorId: undefined,
      reasonCode: '',
    }, { id: 'tx' });

    expect(result.alreadyRevoked).toBe(false);
    expect(result.consent.currentStateDerived).toBe('revoked');
    expect(result.revocation.reasonCode).toBe('participant_request');
    expect(result.revocation.actorId).toBeNull();
    expect(collections.consentCommunicationEvents.insertOne).toHaveBeenCalledTimes(1);
    expect(graph.appendConsentEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        status: 'REVOKED',
        consentTemplateId: null,
        signedAt: createdAt,
      }),
      { session: { id: 'tx' } }
    );
  });

  it('can suppress revocation communication and use effective-period start', async () => {
    const graph = graphProjection();
    const { db, collections } = makeDb({
      consentRevocations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graph });
    const start = new Date('2026-02-01T00:00:00Z');
    vi.spyOn(repo, 'getConsentById').mockResolvedValue({
      consentId: 'consent-2',
      participantId: 'participant-2',
      templateVersionId: 'tv-2',
      effectivePeriod: { start },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await repo.revokeConsent('consent-2', {
      reasonCode: 'policy',
      communicationRequired: false,
      actorId: 'actor-2',
      effectiveAt: '2026-09-18T12:00:00Z',
    }, { id: 'tx' });

    expect(collections.consentCommunicationEvents.insertOne).not.toHaveBeenCalled();
    expect(graph.appendConsentEvent.mock.calls[0][1].signedAt).toEqual(start);
  });

  it('authorizes no-consent, active-consent-without-permission-code, matching permission and purpose fallback cases', async () => {
    const decisions = makeCollection();
    const permissions = makeCollection();
    const { db } = makeDb({
      consentAuthorizationDecisions: decisions,
      consentPermissions: permissions,
    });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    vi.spyOn(repo, 'findActiveConsent').mockResolvedValueOnce(null);
    let result = await repo.authorize({
      participantId: 'participant-1',
      permissionCode: 'research',
      purposeCode: 'study',
      evaluatedAt: 'invalid',
    });
    expect(result).toMatchObject({
      participantId: 'participant-1',
      consentId: null,
      consentPermissionId: null,
      decision: 'review_required',
      reasonCode: 'no_active_consent',
    });
    expect(decisions.insertOne.mock.calls[0][1]).toEqual({});

    repo.findActiveConsent.mockResolvedValueOnce({ consentId: 'consent-1' });
    result = await repo.authorize({ participantId: 'participant-1' }, { id: 'tx' });
    expect(result).toMatchObject({
      decision: 'permit',
      reasonCode: 'active_consent_exists',
      permissionCode: null,
      purposeCode: null,
    });
    expect(decisions.insertOne.mock.calls[1][1]).toEqual({ session: { id: 'tx' } });

    repo.findActiveConsent.mockResolvedValueOnce({ consentId: 'consent-2' });
    permissions.findOne
      .mockResolvedValueOnce({
        consentPermissionId: 'cp-1',
        decision: true,
      });
    result = await repo.authorize({
      participantId: 'participant-2',
      permissionCode: 'research',
      purposeCode: 'specific-purpose',
    });
    expect(result).toMatchObject({
      consentId: 'consent-2',
      consentPermissionId: 'cp-1',
      decision: 'permit',
      reasonCode: 'permission_permit',
    });

    repo.findActiveConsent.mockResolvedValueOnce({ consentId: 'consent-3' });
    permissions.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        consentPermissionId: 'cp-2',
        decision: 'deny',
      });
    result = await repo.authorize({
      participantId: 'participant-3',
      permissionCode: 'secondary',
      purposeCode: 'missing-specific-purpose',
    });
    expect(result).toMatchObject({
      consentPermissionId: 'cp-2',
      decision: 'deny',
      reasonCode: 'permission_deny',
    });

    repo.findActiveConsent.mockResolvedValueOnce({ consentId: 'consent-4' });
    permissions.findOne.mockResolvedValueOnce(null);
    result = await repo.authorize({
      participantId: 'participant-4',
      permissionCode: 'not-declared',
    });
    expect(result.reasonCode).toBe('permission_not_declared');

    result = await repo.authorize({});
    expect(result.participantId).toBeNull();
    expect(result.decision).toBe('review_required');
  });

  it('lists permissions sorted by canonical keys', async () => {
    const toArray = vi.fn().mockResolvedValue([{ permissionCode: 'a' }]);
    const sort = vi.fn(() => ({ toArray }));
    const permissions = makeCollection({
      find: vi.fn(() => ({ sort })),
    });
    const { db } = makeDb({ consentPermissions: permissions });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    const result = await repo.listPermissions(' consent-1 ', { id: 'tx' });
    expect(result).toEqual([{ permissionCode: 'a' }]);
    expect(permissions.find).toHaveBeenCalledWith({ consentId: 'consent-1' }, { session: { id: 'tx' } });
    expect(sort).toHaveBeenCalledWith({ permissionCode: 1, consentPermissionId: 1 });
  });

  it('builds legacy views for active, latest inactive and missing consent paths', async () => {
    const consents = makeCollection({
      find: vi.fn(() => cursor([])),
    });
    const { db } = makeDb({ consents });
    const repo = new ConsentGovernanceV2Repository(db, { graphProjectionService: graphProjection() });

    const active = {
      _id: 'mongo-1',
      consentId: 'consent-active',
      participantId: 'p1',
      templateVersionId: 'tv1',
      currentStateDerived: 'active',
      signerDisplayName: '',
      signatureHash: 'hash',
      signatureMimeType: '',
      signatureImageBase64: '',
      studyId: '',
      effectivePeriod: { start: new Date('2026-01-01T00:00:00Z') },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    vi.spyOn(repo, 'findActiveConsent').mockResolvedValueOnce(active);
    vi.spyOn(repo, 'listPermissions').mockResolvedValueOnce([
      { permissionCode: 'research', decision: 'permit' },
      { permissionCode: 'secondary', decision: 'deny' },
    ]);

    let view = await repo.getLegacyViewForParticipant('p1', { id: 'tx' });
    expect(view).toMatchObject({
      consentId: 'consent-active',
      status: 'ACTIVE',
      responses: { research: true, secondary: false },
      signatureHash: 'hash',
    });
    expect(view.signatureName).toBeUndefined();
    expect(view.signatureMimeType).toBeUndefined();

    const revoked = {
      ...active,
      consentId: 'consent-revoked',
      currentStateDerived: 'revoked',
      effectivePeriod: {},
      signerDisplayName: 'Signer',
      signatureMimeType: 'image/png',
      signatureImageBase64: 'base64',
      studyId: 'study-1',
      updatedAt: new Date('2026-09-18T00:00:00Z'),
    };
    repo.findActiveConsent.mockResolvedValueOnce(null);
    consents.find.mockReturnValueOnce(cursor([revoked]));
    repo.listPermissions.mockResolvedValueOnce([]);
    view = await repo.getLegacyViewForParticipant('p1', { id: 'tx' });
    expect(view.status).toBe('REVOKED');
    expect(view.signatureName).toBe('Signer');
    expect(view.signatureMimeType).toBe('image/png');
    expect(view.signatureImageBase64).toBe('base64');
    expect(view.studyId).toBe('study-1');
    expect(view.signedAt).toEqual(revoked.createdAt);
    expect(view.revokedAt).toEqual(revoked.updatedAt);

    repo.findActiveConsent.mockResolvedValueOnce(null);
    consents.find.mockReturnValueOnce(cursor([]));
    await expect(repo.getLegacyViewForParticipant('missing')).resolves.toBeNull();

    expect(repo.toLegacyView(null)).toBeNull();
  });
});
