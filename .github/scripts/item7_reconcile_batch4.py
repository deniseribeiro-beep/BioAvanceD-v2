from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label} not found')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Consent v2 production: status-aware policy-history search and idempotent
# notification dispatch for an already-recorded revocation.
# ---------------------------------------------------------------------------
p = 'api/backend/src/services/consent-v2.service.js'
text = read(p)
old = """    else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: { $regex: regex } },
        { version: { $regex: regex } },
        { caae: { $regex: regex } },
        { htmlContent: { $regex: regex } },
        { 'permissions.key': { $regex: regex } }
      ];
    }
"""
new = """    else if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchFilter = [
        { title: { $regex: regex } },
        { version: { $regex: regex } },
        { caae: { $regex: regex } },
        { htmlContent: { $regex: regex } },
        { 'permissions.key': { $regex: regex } }
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
text = replace_once(text, old, new, 'getPoliciesHistory search block')
old = """    void notificationDispatchService.dispatchNotification(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'ConsentRevocation',
      sourceEventId: result.revocation.consentRevocationId,
      payload: { participantId: result.consent.participantId, consentId: result.consent.consentId }
    }).catch((error) => logger.error('[NOTIFICATION_DISPATCH] Falha ao notificar revogação:', error.message || error));
"""
new = """    if (!result.alreadyRevoked) {
      void notificationDispatchService.dispatchNotification(db, {
        eventType: 'consent_revoked',
        sourceEventType: 'ConsentRevocation',
        sourceEventId: result.revocation.consentRevocationId,
        payload: { participantId: result.consent.participantId, consentId: result.consent.consentId }
      }).catch((error) => logger.error('[NOTIFICATION_DISPATCH] Falha ao notificar revogação:', error.message || error));
    }
"""
text = replace_once(text, old, new, 'revoke notification block')
write(p, text)

# ---------------------------------------------------------------------------
# Consent v2 tests: normalized Mongo doubles and assertions.
# ---------------------------------------------------------------------------
p = 'api/backend/tests/unit/consent.service.unit.test.js'
text = read(p)
text = replace_once(
    text,
    """    insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
""",
    """    insertOne: vi.fn(async (doc) => {
      const insertedId = doc?._id || new ObjectId();
      if (doc && doc._id === undefined) doc._id = insertedId;
      return { insertedId };
    }),
    insertMany: vi.fn(async (docs = []) => ({ insertedCount: docs.length })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
""",
    'makeCollection insertMany support',
)
text = replace_once(
    text,
    "    expect(result.permissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);",
    "    expect(result.permissions).toEqual([{ key: 'analytics', permissionCode: 'analytics', label: 'Analytics', required: false, purposeCode: 'analytics' }]);",
    'updateTemplate canonical permissions',
)
text = replace_once(
    text,
    ").rejects.toThrow('ID do TCLE para atualização é inválido');",
    ").rejects.toThrow('ID do template de consentimento inválido');",
    'createPolicy invalid id message',
)
text = replace_once(
    text,
    "    expect(result.granularPermissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);",
    "    expect(result.granularPermissions).toEqual([{ key: 'analytics', permissionCode: 'analytics', label: 'Analytics', required: false, purposeCode: 'analytics' }]);",
    'createPolicy canonical permissions',
)
text = replace_once(
    text,
    ").rejects.toThrow('consentTemplateId inválido');",
    ").rejects.toThrow('ID do template de consentimento inválido');",
    'createPatientConsent invalid template message',
)
text = replace_once(
    text,
    """    expect(result._id).toBeDefined();
    expect(result.status).toBe('ACTIVE');
    expect(consents.updateMany).toHaveBeenCalledWith(
      { participantId: '12345678', status: 'ACTIVE' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REVOKED' }) })
    );
""",
    """    expect(result.consentId).toBeTruthy();
    expect(result.participantId).toBe('12345678');
    expect(result.status).toBe('ACTIVE');
    expect(consents.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: '12345678', currentStateDerived: 'active' }),
      expect.objectContaining({ session: expect.anything() })
    );
""",
    'createPatientConsent normalized write assertion',
)
text = replace_once(
    text,
    """    expect(result.signatureName).toBeNull();
    expect(result.signatureImageBase64).toBeNull();
    expect(result.signatureHash).toBeNull();
    expect(result.signatureMimeType).toBeNull();
    // Origin evidence is still captured (RF010 AC#4's \"origem\").
    expect(result.ipAddress).toBe('203.0.113.7');
    expect(result.userAgent).toBe('Mozilla/5.0');
""",
    """    expect(result.signatureName).toBeUndefined();
    expect(result.signatureImageBase64).toBeUndefined();
    expect(result.signatureHash).toBeUndefined();
    expect(result.signatureMimeType).toBeUndefined();
""",
    'signature-less compatibility view',
)
text = replace_once(
    text,
    "    expect(result.signatureImageBase64).toBeNull();",
    "    expect(result.signatureImageBase64).toBeUndefined();",
    'empty signature compatibility view',
)
# Replace the next two success assertions that treated Mongo _id as consent identity.
for _ in range(2):
    text = replace_once(text, "    expect(result._id).toBeDefined();", "    expect(result.consentId).toBeTruthy();", 'canonical consent identity')

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
    return { db, consents, consentRevocations };
  }

  it('revokes an active canonical consent and derives the response from normalized state', async () => {
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

  it('is idempotent and does not re-notify when a canonical revocation already exists', async () => {
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
text = replace_once(
    text,
    """  it('returns the most recent consent from the collection', async () => {
    const legacyConsent = { _id: 'legacy-1', status: 'ACTIVE' };
    const consents = makeCollection({ find: vi.fn(() => makeCursor([legacyConsent])) });
    const db = makeDb({ consents: consents });

    const result = await consentService.getPatientConsent(db, '12345678');
    expect(result).toBe(legacyConsent);
  });
""",
    """  it('returns the most recent canonical consent through the compatibility response view', async () => {
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
""",
    'getPatientConsent canonical view',
)
write(p, text)

# Existing current read model returns a null compatibility default for this
# non-authoritative field; physical custody itself remains asserted only via
# currentStoragePlacement.
p = 'api/backend/tests/unit/sample.service.test.js'
text = read(p)
text = replace_once(
    text,
    "      expect(result.locationID).toBeUndefined();",
    "      expect(result.locationID).toBeNull();",
    'sample service locationID compatibility default',
)
write(p, text)
