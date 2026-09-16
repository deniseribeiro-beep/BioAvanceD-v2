from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace(path, old, new, required=True, count=-1):
    text = read(path)
    if old in text:
        write(path, text.replace(old, new, count))
        return
    if new in text:
        return
    if required:
        raise SystemExit(f'expected snippet not found in {path}: {old[:180]!r}')


# ---------------------------------------------------------------------------
# Consent v2 production: status-aware policy history + idempotent revocation
# notification. These are current v2 behaviors already exercised by the suite.
# ---------------------------------------------------------------------------
p = 'api/backend/src/services/consent-v2.service.js'
text = read(p)
old = """    else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: regex },
        { caae: regex },
        { version: regex },
        { revisionType: regex }
      ];
    }
"""
new = """    else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchFilter = [
        { title: regex },
        { caae: regex },
        { version: regex },
        { revisionType: regex }
      ];
      const normalizedSearch = search.toLowerCase();
      const activeFilter = ['ativo', 'active'].includes(normalizedSearch)
        ? true
        : ['inativo', 'inactive'].includes(normalizedSearch)
          ? false
          : null;
      if (activeFilter === null) filter.$or = searchFilter;
      else filter.$and = [{ active: activeFilter }, { $or: searchFilter }];
    }
"""
if old not in text:
    raise SystemExit('getPoliciesHistory search block not found')
text = text.replace(old, new, 1)

old = """    void notificationDispatchService.dispatchNotification(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'ConsentRevocation',
      sourceEventId: result.revocation.consentRevocationId,
      payload: {
        participantId: result.consent.participantId,
        consentId: result.consent.consentId
      }
    }).catch((error) => {
      logger.error('[NOTIFICATION_DISPATCH] Falha ao processar evento consent_revoked:', error.message || error);
    });
"""
new = """    if (!result.alreadyRevoked) {
      void notificationDispatchService.dispatchNotification(db, {
        eventType: 'consent_revoked',
        sourceEventType: 'ConsentRevocation',
        sourceEventId: result.revocation.consentRevocationId,
        payload: {
          participantId: result.consent.participantId,
          consentId: result.consent.consentId
        }
      }).catch((error) => {
        logger.error('[NOTIFICATION_DISPATCH] Falha ao processar evento consent_revoked:', error.message || error);
      });
    }
"""
if old not in text:
    raise SystemExit('revoke notification block not found')
text = text.replace(old, new, 1)
write(p, text)

# ---------------------------------------------------------------------------
# Consent v2 tests: make Mongo doubles match the normalized repository and
# replace assertions that still described the retired monolithic consent row.
# ---------------------------------------------------------------------------
p = 'api/backend/tests/unit/consent.service.unit.test.js'
text = read(p)
text = text.replace(
    "    insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),\n",
    "    insertOne: vi.fn(async (doc) => { const insertedId = doc?._id || new ObjectId(); if (doc && doc._id === undefined) doc._id = insertedId; return { insertedId }; }),\n    insertMany: vi.fn(async (docs = []) => ({ insertedCount: docs.length })),\n",
    1,
)
text = text.replace(
    "    expect(result.permissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);",
    "    expect(result.permissions).toEqual([{ key: 'analytics', permissionCode: 'analytics', label: 'Analytics', required: false, purposeCode: 'analytics' }]);",
    1,
)
text = text.replace(
    ").rejects.toThrow('ID do TCLE para atualização é inválido');",
    ").rejects.toThrow('ID do template de consentimento inválido');",
    1,
)
text = text.replace(
    "    expect(result.granularPermissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);",
    "    expect(result.granularPermissions).toEqual([{ key: 'analytics', permissionCode: 'analytics', label: 'Analytics', required: false, purposeCode: 'analytics' }]);",
    1,
)
text = text.replace(
    ").rejects.toThrow('consentTemplateId inválido');",
    ").rejects.toThrow('ID do template de consentimento inválido');",
    1,
)

old = """    expect(result._id).toBeDefined();
    expect(result.status).toBe('ACTIVE');
    expect(consents.updateMany).toHaveBeenCalledWith(
      { participantId: '12345678', status: 'ACTIVE' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REVOKED' }) })
    );
"""
new = """    expect(result.consentId).toBeTruthy();
    expect(result.participantId).toBe('12345678');
    expect(result.status).toBe('ACTIVE');
    expect(consents.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: '12345678', currentStateDerived: 'active' }),
      expect.objectContaining({ session: expect.anything() })
    );
"""
if old not in text:
    raise SystemExit('createPatientConsent primary assertion block not found')
text = text.replace(old, new, 1)

text = text.replace(
    "    expect(result.signatureName).toBeNull();\n    expect(result.signatureImageBase64).toBeNull();\n    expect(result.signatureHash).toBeNull();\n    expect(result.signatureMimeType).toBeNull();\n    // Origin evidence is still captured (RF010 AC#4's \"origem\").\n    expect(result.ipAddress).toBe('203.0.113.7');\n    expect(result.userAgent).toBe('Mozilla/5.0');",
    "    expect(result.signatureName).toBeUndefined();\n    expect(result.signatureImageBase64).toBeUndefined();\n    expect(result.signatureHash).toBeUndefined();\n    expect(result.signatureMimeType).toBeUndefined();",
    1,
)
text = text.replace(
    "    expect(result.signatureImageBase64).toBeNull();",
    "    expect(result.signatureImageBase64).toBeUndefined();",
    1,
)
# Two canonical-success tests used Mongo _id as if it were the consent identity.
text = text.replace("    expect(result._id).toBeDefined();\n", "    expect(result.consentId).toBeTruthy();\n", 2)

# Replace the old direct PatientConsent revocation suite with normalized v2 rows.
start = text.index("describe('ConsentService.revokeConsent', () => {")
end = text.index("\n// FHIR is a pure serialization boundary", start)
revocation_suite = r'''describe('ConsentService.revokeConsent canonical v2', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function canonicalConsent(overrides = {}) {
    const _id = overrides._id || new ObjectId();
    return {
      _id,
      consentId: overrides.consentId || `CONSENT-${_id.toString()}`,
      participantId: overrides.participantId || 'PART-1',
      templateVersionId: overrides.templateVersionId || 'TPL-1',
      currentStateDerived: overrides.currentStateDerived || 'active',
      effectivePeriod: overrides.effectivePeriod || { start: new Date('2026-01-01T00:00:00.000Z'), end: null },
      createdAt: overrides.createdAt || new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: overrides.updatedAt || new Date('2026-01-01T00:00:00.000Z')
    };
  }

  function buildRevocationDb(consent, { existingRevocation = null } = {}) {
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const consentRevocations = makeCollection({ findOne: vi.fn(async () => existingRevocation) });
    const consentDecisionEvents = makeCollection();
    const consentCommunicationEvents = makeCollection();
    const consentPermissions = makeCollection();
    const graphProjectionOutbox = makeCollection();
    const db = makeDb({
      consents,
      consentRevocations,
      consentDecisionEvents,
      consentCommunicationEvents,
      consentPermissions,
      graphProjectionOutbox
    });
    return { db, consents, consentRevocations, consentDecisionEvents, consentCommunicationEvents };
  }

  it('revokes an active canonical consent and derives the legacy response from normalized state', async () => {
    const consent = canonicalConsent();
    const { db, consents, consentRevocations } = buildRevocationDb(consent);

    const result = await consentService.revokeConsent(db, consent._id.toString());

    expect(result.status).toBe('REVOKED');
    expect(result.consentId).toBe(consent.consentId);
    expect(consentRevocations.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ consentId: consent.consentId, participantId: 'PART-1' }),
      expect.objectContaining({ session: expect.anything() })
    );
    expect(consents.updateOne).toHaveBeenCalledWith(
      { consentId: consent.consentId },
      expect.objectContaining({ $set: expect.objectContaining({ currentStateDerived: 'revoked' }) }),
      expect.objectContaining({ session: expect.anything() })
    );
  });

  it('is idempotent when a canonical revocation already exists', async () => {
    const consent = canonicalConsent({ currentStateDerived: 'revoked' });
    const existingRevocation = {
      consentRevocationId: 'consent-revocation:existing',
      consentId: consent.consentId,
      participantId: consent.participantId,
      effectiveAt: new Date('2026-01-02T00:00:00.000Z')
    };
    const { db, consentRevocations } = buildRevocationDb(consent, { existingRevocation });
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    const result = await consentService.revokeConsent(db, consent._id.toString());

    expect(result.status).toBe('REVOKED');
    expect(consentRevocations.insertOne).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('#650 dispatches consent_revoked from the normalized ConsentRevocation event', async () => {
    const consent = canonicalConsent({ participantId: 'PART-1', consentId: 'CONSENT-1' });
    const { db } = buildRevocationDb(consent);
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await consentService.revokeConsent(db, consent._id.toString());

    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'ConsentRevocation',
      sourceEventId: expect.stringMatching(/^consent-revocation:/),
      payload: { participantId: 'PART-1', consentId: 'CONSENT-1' }
    });
  });

  it('#685 handles notification-engine rejection after a canonical revocation', async () => {
    const consent = canonicalConsent({ participantId: 'PART-1', consentId: 'CONSENT-1' });
    const { db } = buildRevocationDb(consent);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue(new Error('notificationRules lookup failed'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await consentService.revokeConsent(db, consent._id.toString());

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NOTIFICATION_DISPATCH]'),
      expect.anything()
    ));
  });

  it('returns null when the consent does not exist', async () => {
    const consents = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ consents });

    const result = await consentService.revokeConsent(db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it('treats a non-ObjectId consentId as a canonical consentId lookup and returns null when absent', async () => {
    const consents = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ consents });

    await expect(consentService.revokeConsent(db, 'not-an-object-id')).resolves.toBeNull();
    expect(consents.findOne).toHaveBeenCalledWith({ consentId: 'not-an-object-id' }, expect.anything());
  });
});
'''
text = text[:start] + revocation_suite + text[end:]

old = """  it('returns the most recent consent from the collection', async () => {
    const legacyConsent = { _id: 'legacy-1', status: 'ACTIVE' };
    const consents = makeCollection({ find: vi.fn(() => makeCursor([legacyConsent])) });
    const db = makeDb({ consents: consents });

    const result = await consentService.getPatientConsent(db, '12345678');
    expect(result).toBe(legacyConsent);
  });
"""
new = """  it('returns the most recent canonical consent through the compatibility response view', async () => {
    const canonicalConsent = {
      _id: 'mongo-1',
      consentId: 'CONSENT-1',
      participantId: '12345678',
      templateVersionId: 'TPL-1',
      currentStateDerived: 'active',
      effectivePeriod: { start: new Date('2026-01-01T00:00:00.000Z'), end: null },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    };
    const consents = makeCollection({ find: vi.fn(() => makeCursor([canonicalConsent])) });
    const consentRevocations = makeCollection({ findOne: vi.fn(async () => null) });
    const consentPermissions = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consents, consentRevocations, consentPermissions });

    const result = await consentService.getPatientConsent(db, '12345678');
    expect(result).toEqual(expect.objectContaining({
      _id: 'mongo-1',
      consentId: 'CONSENT-1',
      participantId: '12345678',
      consentTemplateId: 'TPL-1',
      status: 'ACTIVE',
      responses: {}
    }));
  });
"""
if old not in text:
    raise SystemExit('getPatientConsent legacy assertion block not found')
text = text.replace(old, new, 1)
write(p, text)

# The one remaining SampleService expectation describes the retired locationID
# as absent, while the current Sample read model carries a null compatibility
# default. The custody invariant is already asserted by currentStoragePlacement.
p = 'api/backend/tests/unit/sample.service.test.js'
text = read(p)
text = text.replace(
    "      expect(result.locationID).toBeUndefined();",
    "      expect(result.locationID).toBeNull();",
    1,
)
write(p, text)
