const { ObjectId } = require('mongodb');

const patientService = require('../../src/services/patient.service');
const consentService = require('../../src/services/consent.service');
const consentCommunication = require('../../src/services/consentCommunication.service');
const consentQuarantine = require('../../src/services/consentQuarantine.service');
const { hashConsentToken } = require('../../src/utils/consentTokenHash');

function makeCollection(overrides = {}) {
  return {
    find: vi.fn(() => ({ toArray: async () => [] })),
    findOne: vi.fn(async () => null),
    insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    ...overrides,
  };
}

describe('consent panel token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the token after acceptance and dates it to the term validTo', async () => {
    const validTo = '2027-01-01T00:00:00.000Z';
    const patients = makeCollection({
      findOne: vi.fn()
        .mockResolvedValueOnce({
          participantId: '12345678',
          status: 'PENDING_CONSENT',
          consentTokenHash: hashConsentToken('tok'),
        })
        .mockResolvedValueOnce({
          participantId: '12345678',
          status: 'PENDING_CONSENT',
          consentTokenHash: hashConsentToken('tok'),
        }),
    });
    const db = { collection: vi.fn(() => patients) };
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue({
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      active: true,
      version: '2',
      validTo,
      permissions: [{ key: 'storage', label: 'Armazenamento', required: true }],
    });
    vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({
      _id: 'c1', consentId: 'uuid-1', consentVersion: '2', participantId: '12345678', status: 'ACTIVE',
    });

    await patientService.acceptConsentToken(db, '12345678', 'tok', {
      consentTemplateId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      responses: { storage: true },
    });

    expect(patients.updateOne).toHaveBeenCalledWith(
      { participantId: '12345678' },
      { $set: expect.objectContaining({
        status: 'ACTIVE',
        consentTokenExpiresAt: new Date(validTo),
      }) }
    );
    expect(patients.updateOne.mock.calls[0][1].$set.consentTokenHash).toBeUndefined();
  });

  it('revokes one permission and the whole term through the same participant token', async () => {
    const consentId = new ObjectId();
    const consent = {
      _id: consentId,
      participantId: '12345678',
      status: 'ACTIVE',
      currentStateDerived: 'active',
      effectivePermissions: { storage: true, contact: true },
    };
    vi.spyOn(patientService, 'validateConsentToken').mockResolvedValue({ valid: true, participantId: '12345678' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(consent);
    const revoke = vi.spyOn(consentService, 'revokeConsent')
      .mockResolvedValueOnce({ status: 'ACTIVE', currentStateDerived: 'partially_revoked', effectivePermissions: { storage: true, contact: false } })
      .mockResolvedValueOnce({ status: 'REVOKED', currentStateDerived: 'revoked', effectivePermissions: { storage: false, contact: false } });
    const quarantine = vi.spyOn(consentQuarantine, 'quarantineForRevocation').mockResolvedValue({ matched: 0, quarantined: 0 });
    const db = { collection: vi.fn(() => makeCollection()) };
    const actor = {
      channel: 'electronic_link',
      signerRole: 'participant',
      signerId: '12345678',
      authenticationLevel: 'token',
    };

    const partial = await patientService.revokeConsentByToken(db, '12345678', 'tok', {
      scope: ['contact'],
      location: { status: 'unavailable' },
    });
    const whole = await patientService.revokeConsentByToken(db, '12345678', 'tok', {
      location: { status: 'unavailable' },
    });

    expect(revoke).toHaveBeenNthCalledWith(1, db, String(consentId), {
      scope: ['contact'],
      reason: undefined,
      location: { status: 'unavailable' },
    }, actor);
    expect(partial.currentStateDerived).toBe('partially_revoked');
    expect(revoke).toHaveBeenNthCalledWith(2, db, String(consentId), {
      scope: undefined,
      reason: undefined,
      location: { status: 'unavailable' },
    }, actor);
    expect(whole.status).toBe('REVOKED');
    expect(quarantine).toHaveBeenCalledTimes(1);
  });

  it('closes a consent once when the term validTo has passed and emails the holder once', async () => {
    const consentId = new ObjectId();
    const validTo = new Date('2020-01-01T00:00:00.000Z');
    const consent = {
      _id: consentId,
      consentId: 'c-uuid',
      participantId: '12345678',
      status: 'ACTIVE',
      consentTemplateId: 'tmpl-1',
    };
    const consents = makeCollection({
      find: vi.fn(() => ({ toArray: async () => [consent] })),
    });
    const templates = makeCollection({
      findOne: vi.fn(async () => ({ _id: 'tmpl-1', validTo })),
    });
    const events = makeCollection({
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ deliveryStatus: 'delivered', contentTemplateId: 'consent.term_expiry.v1' }),
    });
    const db = {
      collection: vi.fn((name) => {
        if (name === 'consentTemplates' || name === 'consent_templates') return templates;
        if (name === 'consentCommunicationEvents') return events;
        return consents;
      }),
    };
    const notify = vi.spyOn(consentCommunication, 'notifyTermExpiry').mockResolvedValue('delivered');
    const revoke = vi.spyOn(consentService, 'revokeConsent').mockImplementation(async (_db, _id, request, actor) => {
      if (actor?.channel === 'term_expiry') {
        await consentCommunication.notifyTermExpiry(_db, { consent, validTo: request.validTo });
      }
      consent.status = 'REVOKED';
      return { ...consent, status: 'REVOKED' };
    });
    vi.spyOn(consentQuarantine, 'quarantineForRevocation').mockResolvedValue({ matched: 1, quarantined: 1 });

    const first = await consentService.expireDueConsents(db, { participantId: '12345678' });
    consent.status = 'REVOKED';
    consents.find.mockReturnValue({ toArray: async () => [] });
    const second = await consentService.expireDueConsents(db, { participantId: '12345678' });

    expect(first.closed).toBe(1);
    expect(second.closed).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(
      db,
      String(consentId),
      expect.objectContaining({ reason: 'Vencimento do termo', location: { status: 'unavailable' } }),
      expect.objectContaining({ channel: 'term_expiry', signerId: 'system' })
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('leaves a term that has not ended, and still counts a close when quarantine fails', async () => {
    const rows = [
      { _id: new ObjectId(), participantId: '12345678', consentTemplateId: 'missing' },
      { _id: new ObjectId(), participantId: '12345678', consentTemplateId: 'blank' },
      { _id: new ObjectId(), participantId: '12345678', consentTemplateId: 'bad' },
      { _id: new ObjectId(), participantId: '12345678', consentTemplateId: 'future' },
      { _id: new ObjectId(), participantId: '12345678', consentTemplateId: 'ended' },
    ];
    const byId = {
      blank: { validTo: '' },
      bad: { validTo: 'ontem' },
      future: { validTo: '2099-01-01T00:00:00.000Z' },
      ended: { validTo: '2020-01-01T00:00:00.000Z' },
    };
    const consents = makeCollection({
      find: vi.fn(() => ({ toArray: async () => rows })),
    });
    const templates = makeCollection({
      findOne: vi.fn(async (query) => byId[query._id] || null),
    });
    const db = { collection: vi.fn((name) => (name === 'consent_templates' ? templates : consents)) };
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue({ status: 'REVOKED' });
    vi.spyOn(consentQuarantine, 'quarantineForRevocation').mockRejectedValue(new Error('fila'));

    await expect(consentService.expireDueConsents(db)).resolves.toEqual({ closed: 1 });

    consents.find.mockReturnValue({ toArray: async () => { throw new Error('leitura'); } });
    await expect(consentService.expireDueConsents(db, { participantId: '12345678' })).resolves.toEqual({ closed: 0 });
    expect(await consentService.findTemplateById(templates, '')).toBeNull();
    expect(await consentService.findTemplateById(templates, 'not-an-object-id')).toBeNull();
  });

  it('dates the panel from the term and records the link even when the notice is refused', async () => {
    const consentPanel = require('../../src/services/consentPanel.service');
    expect(consentPanel.consentPanelExpiresAt(null)).toBeNull();
    expect(consentPanel.consentPanelExpiresAt({ validTo: '' })).toBeNull();
    expect(consentPanel.consentPanelExpiresAt({ validTo: 'ontem' })).toBeNull();
    expect(consentPanel.consentPanelExpiresAt({ validTo: '2027-01-01T00:00:00.000Z' })).toEqual(new Date('2027-01-01T00:00:00.000Z'));

    await expect(consentPanel.recordPanelLinkCommunication(null, { _id: 'c1' }, 'delivered')).resolves.toBeUndefined();
    const events = makeCollection();
    const db = { collection: vi.fn(() => events) };
    const model = require('../../src/models/ConsentCommunicationEvent');
    vi.spyOn(model, 'validate').mockReturnValueOnce({ isValid: false, errors: ['campo'] });
    await consentPanel.recordPanelLinkCommunication(db, { _id: new ObjectId(), participantId: '12345678' }, 'delivered');
    expect(events.insertOne).not.toHaveBeenCalled();

    events.insertOne.mockRejectedValueOnce(new Error('mongo'));
    model.validate.mockReturnValueOnce({ isValid: true, errors: [] });
    await consentPanel.recordPanelLinkCommunication(db, { _id: new ObjectId(), participantId: '12345678' }, 'failed');

    const notificationService = require('../../src/services/notification.service');
    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({ token: 'tok', createdAt: new Date('2026-11-05T00:00:00.000Z') });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://e2e.bioavanced.test/patients/12345678/consent?token=tok');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockRejectedValue(new Error('smtp'));
    vi.spyOn(consentPanel, 'recordPanelLinkCommunication').mockRejectedValue(new Error('log'));
    const patients = makeCollection();
    const linkDb = { collection: vi.fn(() => patients) };
    await consentPanel.issueInPersonPanelLink(linkDb, '12345678', { validTo: '2027-01-01T00:00:00.000Z' }, { _id: 'c1' });
    expect(patients.updateOne).toHaveBeenCalled();
  });
});
