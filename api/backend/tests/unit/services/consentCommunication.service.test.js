import { describe, it, expect, vi, afterEach } from 'vitest';

// RF010 AC8 (LGPD art. 8 §6, art. 9 §2): publishing a new version of a
// consent term sends each holder of a consent still in force under an
// earlier version a policy change notice, recorded as a
// ConsentCommunicationEvent before the send and given its outcome after it.
// These cases drive the real publication path (updateTemplate/createTemplate)
// over a fake db whose finds honour their filters, so a wrong query finds
// nobody and fails the case instead of passing it.

const consentService = require('../../../src/services/consent.service');
const notificationService = require('../../../src/services/notification.service');
const ConsentCommunicationEventModel = require('../../../src/models/ConsentCommunicationEvent');
const { formatPolicyChangeNotice } = require('../../../src/services/consentCommunication.service');
const { ObjectId } = require('mongodb');

function makeCursor(items) {
  const cursor = {
    sort: () => cursor,
    skip: () => cursor,
    limit: () => cursor,
    toArray: async () => items,
  };
  return cursor;
}

function makeCollection(overrides = {}) {
  return {
    find: vi.fn(() => makeCursor([])),
    findOne: vi.fn(async () => null),
    insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    insertMany: vi.fn(async (docs) => ({ insertedCount: docs.length })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    countDocuments: vi.fn(async () => 0),
    ...overrides,
  };
}

const PREVIOUS_ID = new ObjectId();
const GROUP = 'group-1351';
const PREVIOUS_TEMPLATE = {
  _id: PREVIOUS_ID,
  title: 'TCLE Biobanco',
  content: '<p>v1</p>',
  htmlContent: '<p>v1</p>',
  version: 'v1',
  versionGroupId: GROUP,
  active: true,
  permissions: [
    { key: 'storage', label: 'Armazenamento de amostras', required: true },
    { key: 'contact', label: 'Contato futuro', required: false },
  ],
};

const CONSENTS = () => [
  { _id: new ObjectId(), consentId: 'consent-a', participantId: '10000001', consentTemplateId: PREVIOUS_ID.toString(), consentVersion: 'v1', status: 'ACTIVE' },
  { _id: new ObjectId(), consentId: 'consent-b', participantId: '10000002', consentTemplateId: PREVIOUS_ID.toString(), consentVersion: 'v1', status: 'ACTIVE' },
  { _id: new ObjectId(), consentId: 'consent-revoked', participantId: '10000003', consentTemplateId: PREVIOUS_ID.toString(), consentVersion: 'v1', status: 'REVOKED' },
  { _id: new ObjectId(), consentId: 'consent-other-term', participantId: '10000004', consentTemplateId: new ObjectId().toString(), consentVersion: 'v1', status: 'ACTIVE' },
];

function setup({ consents = CONSENTS(), emails = { 10000001: 'a@example.org', 10000002: 'b@example.org' } } = {}) {
  const templates = makeCollection({
    findOne: vi.fn(async () => PREVIOUS_TEMPLATE),
    find: vi.fn((filter = {}) => {
      if (filter.versionGroupId === GROUP) {
        const excluded = filter._id?.$ne ? String(filter._id.$ne) : null;
        return makeCursor([PREVIOUS_TEMPLATE].filter((row) => String(row._id) !== excluded));
      }
      return makeCursor([]);
    }),
  });
  const patientConsents = makeCollection({
    find: vi.fn((filter = {}) => makeCursor(consents.filter((consent) =>
      (filter.status === undefined || consent.status === filter.status)
      && (!Array.isArray(filter.consentTemplateId?.$in) || filter.consentTemplateId.$in.includes(consent.consentTemplateId))
      && filter.consentTemplateId !== undefined
    ))),
  });
  const consentCommunicationEvents = makeCollection();
  const participantIdentities = makeCollection({
    findOne: vi.fn(async ({ participantId }) => (emails[participantId]
      ? { participantId, email: emails[participantId] }
      : { participantId })),
  });
  const collections = {
    consent_templates: templates,
    patientConsents,
    consentCommunicationEvents,
    participantIdentities,
  };
  const db = { collection: vi.fn((name) => collections[name] || makeCollection()) };
  return { db, templates, patientConsents, events: consentCommunicationEvents };
}

const REVISION = {
  title: 'TCLE Biobanco',
  content: '<p>v2</p>',
  permissions: [
    { key: 'storage', label: 'Armazenamento de amostras', required: true },
    { key: 'sharing', label: 'Compartilhamento com outros centros', required: false },
  ],
};

/** The status each event ended with, keyed by consentId. */
function finalStatuses(events) {
  const byEventId = new Map(events.insertOne.mock.calls.map(([doc]) => [doc.consentCommunicationEventId, { ...doc }]));
  for (const [filter, update] of events.updateOne.mock.calls) {
    const doc = byEventId.get(filter.consentCommunicationEventId);
    if (doc) Object.assign(doc, update.$set);
  }
  return Object.fromEntries([...byEventId.values()].map((doc) => [doc.consentId, doc]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('policy change notice on a superseding term version (RF010 AC8)', () => {
  it('records one ConsentCommunicationEvent per consent in force under the superseded version, before its send', async () => {
    const { db, events } = setup();
    const send = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, provider: 'smtp', messageId: 'msg-1' });

    await consentService.updateTemplate(db, PREVIOUS_ID.toString(), REVISION);

    expect(events.insertOne).toHaveBeenCalledTimes(2);
    const inserted = events.insertOne.mock.calls.map(([doc]) => doc);
    expect(inserted.map((doc) => doc.consentId).sort()).toEqual(['consent-a', 'consent-b']);
    for (const doc of inserted) {
      expect(doc).toEqual(expect.objectContaining({
        communicationType: 'policy_change_notice',
        channel: 'email',
        deliveryStatus: 'queued',
        contentTemplateId: 'consent.policy_change_notice.v1',
        purpose: 'consent_policy_change',
        sourceEventType: 'ConsentTemplate',
      }));
      expect(doc.sentAt).toBeInstanceOf(Date);
      expect(ConsentCommunicationEventModel.validate(doc).isValid).toBe(true);
    }

    // Each event is written before its own send.
    expect(send).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i += 1) {
      expect(events.insertOne.mock.invocationCallOrder[i]).toBeLessThan(send.mock.invocationCallOrder[i]);
    }
    expect(send.mock.calls.map(([args]) => args.to).sort()).toEqual(['a@example.org', 'b@example.org']);
    expect(send.mock.calls[0][0].metadata).toEqual(expect.objectContaining({
      consentCommunicationEventId: inserted[0].consentCommunicationEventId,
    }));

    const statuses = finalStatuses(events);
    expect(statuses['consent-a']).toEqual(expect.objectContaining({ deliveryStatus: 'delivered', evidenceUri: 'urn:bioavanced:email:smtp:msg-1' }));
    expect(statuses['consent-b'].deliveryStatus).toBe('delivered');
  });

  it('writes no event for a revoked consent, nor for a consent under another term', async () => {
    const { db, events } = setup();
    vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, provider: 'smtp', messageId: 'm' });

    await consentService.updateTemplate(db, PREVIOUS_ID.toString(), REVISION);

    const consentIds = events.insertOne.mock.calls.map(([doc]) => doc.consentId);
    // The holders in force are reached, so the absences below are not vacuous.
    expect(consentIds.sort()).toEqual(['consent-a', 'consent-b']);
    expect(consentIds).not.toContain('consent-revoked');
    expect(consentIds).not.toContain('consent-other-term');
  });

  it('records a failed send as failed, and the other holder still gets the notice', async () => {
    const { db, events } = setup();
    vi.spyOn(notificationService, 'sendEmail').mockImplementation(async ({ to }) => {
      if (to === 'a@example.org') throw new Error('provider down');
      return { success: true, provider: 'smtp', messageId: 'm-b' };
    });

    await consentService.updateTemplate(db, PREVIOUS_ID.toString(), REVISION);

    const statuses = finalStatuses(events);
    expect(statuses['consent-a']).toEqual(expect.objectContaining({ deliveryStatus: 'failed', failureReason: 'provider down' }));
    expect(statuses['consent-b'].deliveryStatus).toBe('delivered');
  });

  it('records a holder with no email as failed, without sending', async () => {
    const { db, events } = setup({ emails: { 10000002: 'b@example.org' } });
    const send = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, provider: 'smtp', messageId: 'm' });

    await consentService.updateTemplate(db, PREVIOUS_ID.toString(), REVISION);

    const statuses = finalStatuses(events);
    expect(statuses['consent-a']).toEqual(expect.objectContaining({ deliveryStatus: 'failed', failureReason: 'CONSENT_RECIPIENT_REQUIRED' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('publishes the new version even when every send fails', async () => {
    const { db, templates, events } = setup();
    vi.spyOn(notificationService, 'sendEmail').mockRejectedValue(new Error('provider down'));

    const result = await consentService.updateTemplate(db, PREVIOUS_ID.toString(), REVISION);

    expect(result._id).toBeDefined();
    expect(result.version).toBe('v2');
    expect(templates.insertOne).toHaveBeenCalledWith(expect.objectContaining({ version: 'v2', active: true }));
    expect(Object.values(finalStatuses(events)).map((doc) => doc.deliveryStatus)).toEqual(['failed', 'failed']);
  });

  it('notifies nobody when the new version is published inactive', async () => {
    const { db, events } = setup();
    const send = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });

    await consentService.updateTemplate(db, PREVIOUS_ID.toString(), { ...REVISION, active: false });

    expect(events.insertOne).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('a new version created into an existing lineage (createTemplate) notifies the same holders', async () => {
    const { db, events } = setup();
    vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, provider: 'smtp', messageId: 'm' });

    await consentService.createTemplate(db, { ...REVISION, versionGroupId: GROUP, version: 'v2' });

    expect(events.insertOne.mock.calls.map(([doc]) => doc.consentId).sort()).toEqual(['consent-a', 'consent-b']);
  });

  it('the notice says what changed and how to revoke, with no personal data', () => {
    const text = formatPolicyChangeNotice({
      previousTemplate: PREVIOUS_TEMPLATE,
      newTemplate: { ...REVISION, version: 'v2' },
    });
    expect(text).toContain('"TCLE Biobanco"');
    expect(text).toContain('versão v1');
    expect(text).toContain('versão v2');
    expect(text).toContain('Permissões incluídas: Compartilhamento com outros centros.');
    expect(text).toContain('Permissões retiradas: Contato futuro.');
    expect(text).toMatch(/revogar seu consentimento a qualquer momento, sem custo/);
  });
});
