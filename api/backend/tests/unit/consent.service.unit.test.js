import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const consentService = require('../../src/services/consent.service');
const notificationService = require('../../src/services/notification.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const logger = require('../../src/utils/logger');
const { ObjectId } = require('mongodb');

// Fake, chainable Mongo cursor helper: supports .sort().skip().limit().toArray()
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
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    countDocuments: vi.fn(async () => 0),
    ...overrides,
  };
}

// Fake db: getCollection(db, key) resolves to db.collection(canonicalName) since
// db.listCollections is not a function (see src/utils/collectionResolver.js).
function makeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeCollection()),
  };
}

describe('ConsentService.parseVersionNumber', () => {
  it('parses integer string', () => {
    expect(consentService.parseVersionNumber('3')).toBe(3);
  });

  it('parses v-prefixed version', () => {
    expect(consentService.parseVersionNumber('v5')).toBe(5);
  });

  it('parses V-prefixed version (case insensitive)', () => {
    expect(consentService.parseVersionNumber('V2')).toBe(2);
  });

  it('returns 0 for null', () => {
    expect(consentService.parseVersionNumber(null)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(consentService.parseVersionNumber('')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(consentService.parseVersionNumber('abc')).toBe(0);
  });

  it('returns 0 for decimal version', () => {
    expect(consentService.parseVersionNumber('1.2')).toBe(0);
  });

  it('parses numeric type directly', () => {
    expect(consentService.parseVersionNumber(7)).toBe(7);
  });
});

describe('ConsentService.normalizeSignaturePayload', () => {
  it('returns empty signature when no image provided', () => {
    const result = consentService.normalizeSignaturePayload({ signatureName: 'Test User' });
    expect(result.signatureName).toBe('Test User');
    expect(result.signatureImageBase64).toBe('');
    expect(result.signatureHash).toBeNull();
  });

  it('defaults signatureMimeType to image/png', () => {
    const result = consentService.normalizeSignaturePayload({});
    expect(result.signatureMimeType).toBe('image/png');
  });

  it('computes sha256 hash when image provided', () => {
    const fakeBase64 = Buffer.from('fake-image-data').toString('base64');
    const result = consentService.normalizeSignaturePayload({ signatureImageBase64: fakeBase64 });
    expect(result.signatureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws when signature exceeds max size', () => {
    const huge = 'x'.repeat(7 * 1024 * 1024);
    expect(() => consentService.normalizeSignaturePayload({ signatureImageBase64: huge })).toThrow('tamanho');
  });

  it('throws for invalid mime type', () => {
    const base64 = Buffer.from('data').toString('base64');
    expect(() =>
      consentService.normalizeSignaturePayload({ signatureImageBase64: base64, signatureMimeType: 'application/pdf' })
    ).toThrow('inválido');
  });

  it('extracts mime from data URL prefix', () => {
    const content = Buffer.from('img').toString('base64');
    const dataUrl = `data:image/jpeg;base64,${content}`;
    const result = consentService.normalizeSignaturePayload({ signatureImageBase64: dataUrl });
    expect(result.signatureMimeType).toBe('image/jpeg');
  });

  it('trims signatureName', () => {
    const result = consentService.normalizeSignaturePayload({ signatureName: '  João  ' });
    expect(result.signatureName).toBe('João');
  });
});

describe('ConsentService.validateTemplatePayload', () => {
  const validTemplate = { title: 'Consent Form', content: 'Terms here' };

  it('does not throw for valid template', () => {
    expect(() => consentService.validateTemplatePayload(validTemplate)).not.toThrow();
  });

  it('throws when title is missing', () => {
    expect(() => consentService.validateTemplatePayload({ content: 'Terms' })).toThrow();
  });

  it('throws when content is missing', () => {
    expect(() => consentService.validateTemplatePayload({ title: 'Title' })).toThrow();
  });

  it('throws for empty title', () => {
    expect(() => consentService.validateTemplatePayload({ title: '', content: 'Terms' })).toThrow();
  });
});

describe('ConsentService.validatePolicyPayload', () => {
  const validPolicy = {
    title: 'Privacy Policy',
    htmlContent: '<p>Content</p>',
    version: 'v1',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-12-31T23:59:59.000Z',
    granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
  };

  it('does not throw for valid policy', () => {
    expect(() => consentService.validatePolicyPayload(validPolicy)).not.toThrow();
  });

  it('throws when required field is missing', () => {
    const { title: _t, ...noTitle } = validPolicy;
    expect(() => consentService.validatePolicyPayload(noTitle)).toThrow();
  });

  it('throws when granularPermissions is empty', () => {
    expect(() =>
      consentService.validatePolicyPayload({ ...validPolicy, granularPermissions: [] })
    ).toThrow();
  });
});

describe('ConsentService.validatePatientConsentPayload', () => {
  const validConsent = { participantId: 'P12345678', consentTemplateId: 'abc123', responses: {} };

  it('does not throw for valid consent', () => {
    expect(() => consentService.validatePatientConsentPayload(validConsent)).not.toThrow();
  });

  it('throws when participantId is missing', () => {
    expect(() =>
      consentService.validatePatientConsentPayload({ consentTemplateId: 'abc', responses: {} })
    ).toThrow();
  });

  it('throws when consentTemplateId is missing', () => {
    expect(() =>
      consentService.validatePatientConsentPayload({ participantId: 'P1', responses: {} })
    ).toThrow();
  });
});

describe('ConsentService.ensureUniquePermissionKeys', () => {
  it('does not throw when keys are unique', () => {
    const perms = [{ key: 'analytics' }, { key: 'marketing' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).not.toThrow();
  });

  it('throws when a key is duplicated', () => {
    const perms = [{ key: 'analytics' }, { key: 'analytics' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).toThrow('duplicada');
  });

  it('trims keys before comparing', () => {
    const perms = [{ key: ' analytics ' }, { key: 'analytics' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).toThrow('duplicada');
  });

  it('does not throw for empty array', () => {
    expect(() => consentService.ensureUniquePermissionKeys([])).not.toThrow();
  });
});

describe('ConsentService.validateResponsesAgainstTemplate', () => {
  const template = {
    permissions: [
      { key: 'analytics', required: false },
      { key: 'marketing', required: true },
    ],
  };

  it('does not throw for valid responses', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: false, marketing: true })
    ).not.toThrow();
  });

  it('throws when required permission is false', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: false, marketing: false })
    ).toThrow('obrigatórias');
  });

  it('throws when response is missing for a permission', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: true })
    ).toThrow('inválidas');
  });

  it('throws when extra keys are present', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: true, marketing: true, extra: true })
    ).toThrow('inválidas');
  });

  it('handles template with no permissions', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate({ permissions: [] }, {})
    ).not.toThrow();
  });
});

describe('ConsentService.generateNextPolicyVersion', () => {
  it('returns v1 when there are no existing templates', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    const version = await consentService.generateNextPolicyVersion(db);
    expect(version).toBe('v1');
  });

  it('increments past the highest existing version', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([{ version: 'v3' }, { version: 'v7' }, { version: 'v2' }])),
    });
    const db = makeDb({ consent_templates: templates });

    const version = await consentService.generateNextPolicyVersion(db);
    expect(version).toBe('v8');
  });
});

describe('ConsentService.createTemplate', () => {
  it('creates a template, deactivating previously active ones', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async (doc) => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, {
      title: 'My Template',
      content: 'Body text',
      caae: 'CAAE-001',
      permissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(result._id).toBeDefined();
    expect(result.title).toBe('My Template');
    expect(result.active).toBe(true);
    expect(templates.updateMany).toHaveBeenCalledWith(
      { active: true },
      expect.objectContaining({ $set: expect.objectContaining({ active: false }) })
    );
    expect(templates.insertOne).toHaveBeenCalled();
  });

  it('creates a template without caae, which validateTemplatePayload treats as optional (#62)', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async (doc) => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, {
      title: 'My Template',
      content: 'Body text',
      permissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(result._id).toBeDefined();
    expect(templates.insertOne).toHaveBeenCalled();
  });

  it('rejects duplicate permission keys without inserting', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createTemplate(db, {
        title: 'T',
        content: 'C',
        permissions: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }],
      })
    ).rejects.toThrow('duplicada');

    expect(templates.insertOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload before touching the database', async () => {
    const templates = makeCollection();
    const db = makeDb({ consent_templates: templates });

    await expect(consentService.createTemplate(db, { title: '' })).rejects.toThrow();
    expect(templates.insertOne).not.toHaveBeenCalled();
  });

  it('auto-generates a version when none is provided', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([{ version: 'v4' }])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'C' });

    expect(result.version).toBe('v5');
  });

  it('falls back to content when htmlContent is not provided', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'Body content' });

    expect(result.htmlContent).toBe('Body content');
  });

  it('generates a random versionGroupId when none is provided', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'C' });

    expect(typeof result.versionGroupId).toBe('string');
    expect(result.versionGroupId.length).toBeGreaterThan(0);
  });

  it('omits caae when not a string in the payload', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'C' });

    expect(result.caae).toBe('');
  });

  it('uses the explicit version when one is provided', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'C', version: 'v9' });

    expect(result.version).toBe('v9');
  });

  it('uses the explicit htmlContent when provided instead of falling back to content', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, {
      title: 'T',
      content: 'ignored',
      htmlContent: 'Explicit HTML',
    });

    expect(result.htmlContent).toBe('Explicit HTML');
  });

  it('respects an explicit active:false without deactivating other templates', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, { title: 'T', content: 'C', active: false });

    expect(result.active).toBe(false);
    expect(templates.updateMany).not.toHaveBeenCalled();
  });

  it('uses an explicit versionGroupId when provided', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createTemplate(db, {
      title: 'T',
      content: 'C',
      versionGroupId: 'explicit-group-id',
    });

    expect(result.versionGroupId).toBe('explicit-group-id');
  });

  it('rejects when the model validation fails on a blank-after-trim caae', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createTemplate(db, { title: 'T', content: 'C', caae: '   ' })
    ).rejects.toThrow('caae');
    expect(templates.insertOne).not.toHaveBeenCalled();
  });
});

describe('ConsentService.getTemplateById', () => {
  it('returns the matching template', async () => {
    const id = new ObjectId();
    const templates = makeCollection({ findOne: vi.fn(async () => ({ _id: id, title: 'Found' })) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getTemplateById(db, id.toString());
    expect(result.title).toBe('Found');
  });

  it('returns null when nothing matches', async () => {
    const templates = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getTemplateById(db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it('throws for a malformed id', async () => {
    const db = makeDb({ consent_templates: makeCollection() });
    await expect(consentService.getTemplateById(db, 'not-an-object-id')).rejects.toThrow('inválido');
  });
});

describe('ConsentService.updateTemplate', () => {
  it('throws when the template to update does not exist', async () => {
    const templates = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.updateTemplate(db, new ObjectId().toString(), { title: 'New' })
    ).rejects.toThrow('não encontrado');
  });

  it('creates a new version bumping the version number', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v2',
      caae: 'CAAE-1',
      active: true,
      permissions: [{ key: 'analytics', label: 'Analytics', required: false }],
    };
    const templates = makeCollection({
      findOne: vi.fn(async () => existing),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), {
      title: 'New title',
    });

    expect(result.version).toBe('v3');
    expect(result.previousTemplateId).toBe(String(existingId));
    expect(templates.updateOne).toHaveBeenCalledWith(
      { _id: existingId },
      expect.objectContaining({ $set: expect.objectContaining({ active: false }) })
    );
    expect(templates.insertOne).toHaveBeenCalled();
  });

  it('throws for a malformed template id', async () => {
    const db = makeDb({ consent_templates: makeCollection() });
    await expect(consentService.updateTemplate(db, 'not-an-object-id', { title: 'x' })).rejects.toThrow('inválido');
  });

  it('reuses the existing permissions when the payload omits them', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
      permissions: [{ key: 'analytics', label: 'Analytics', required: false }],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'New title' });

    expect(result.permissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);
  });

  it('falls back to the existing htmlContent/content when the payload has neither', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Existing body',
      htmlContent: 'Existing body',
      version: 'v1',
      active: true,
      permissions: [],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'New title' });

    expect(result.htmlContent).toBe('Existing body');
  });

  it('defaults caae to empty string when the existing template has none', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
      permissions: [],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'New title' });

    expect(result.caae).toBe('');
  });

  it('falls back to an empty permissions array when the existing template has none', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'New title' });

    expect(result.permissions).toEqual([]);
  });

  it('uses the explicit htmlContent from the payload over the existing content', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
      permissions: [],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), {
      title: 'New title',
      htmlContent: 'Brand new HTML',
    });

    expect(result.htmlContent).toBe('Brand new HTML');
  });

  it('respects an explicit active:false and skips deactivating sibling versions', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
      permissions: [],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), {
      title: 'New title',
      active: false,
    });

    expect(result.active).toBe(false);
    expect(templates.updateMany).not.toHaveBeenCalled();
  });

  it('reuses the existing versionGroupId when the existing template already has one', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Old title',
      content: 'Old content',
      htmlContent: 'Old content',
      version: 'v1',
      active: true,
      permissions: [],
      versionGroupId: 'existing-group-id',
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'New title' });

    expect(result.versionGroupId).toBe('existing-group-id');
  });
});

describe('ConsentService.createPolicy', () => {
  it('creates a policy document and notifies pending patients, resolving patientName via ParticipantIdentity (#561/#564)', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])), // no prior versions -> v1
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const pendingPatient = { _id: new ObjectId(), participantId: '10203040', status: 'PENDING_CONSENT' };
    const patients = makeCollection({
      find: vi.fn(() => makeCursor([pendingPatient])),
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    });
    const participantIdentities = makeCollection({
      findOne: vi.fn(async ({ participantId }) => (participantId === '10203040' ? { participantId: '10203040', patientName: 'Maria Silva' } : null)),
    });
    const db = makeDb({ consent_templates: templates, patients, participantIdentities });

    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'tok-123',
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-123');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const payload = {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    };

    const result = await consentService.createPolicy(db, payload);

    expect(result._id).toBeDefined();
    expect(result.version).toBe('v1');
    expect(result.revisionType).toBe('create');
    expect(templates.insertOne).toHaveBeenCalled();
    expect(notificationService.enqueueConsentNotification).toHaveBeenCalledWith(
      { ...pendingPatient, patientName: 'Maria Silva' },
      'https://example.com/consent/tok-123'
    );
    expect(patients.updateOne).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('resolves patientName from a ciphertext-only ParticipantIdentity record when notifying pending patients (RF005/RNF007 #574)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '10203040',
      patientName: 'Maria Cifrada'
    });
    const ciphertextOnlyIdentity = { ...encrypted, patientName: null };

    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const pendingPatient = { _id: new ObjectId(), participantId: '10203040', status: 'PENDING_CONSENT' };
    const patients = makeCollection({
      find: vi.fn(() => makeCursor([pendingPatient])),
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    });
    const participantIdentities = makeCollection({
      findOne: vi.fn(async ({ participantId }) => (participantId === '10203040' ? ciphertextOnlyIdentity : null)),
    });
    const db = makeDb({ consent_templates: templates, patients, participantIdentities });

    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'tok-123',
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-123');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const payload = {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    };

    await consentService.createPolicy(db, payload);

    expect(notificationService.enqueueConsentNotification).toHaveBeenCalledWith(
      { ...pendingPatient, patientName: 'Maria Cifrada' },
      'https://example.com/consent/tok-123'
    );

    vi.restoreAllMocks();
  });


  // #810: the try/catch used to wrap the whole `for`, so one patient that
  // threw ended the entire sweep -- every patient after them got no
  // invitation and, worse, no consentToken persisted, leaving nothing for a
  // later resend to validate against. The publication still reported success.
  describe('#810 per-patient isolation of the notification sweep', () => {
    const THREE_PENDING = () => [
      { _id: new ObjectId(), participantId: '10203041', status: 'PENDING_CONSENT' },
      { _id: new ObjectId(), participantId: '10203042', status: 'PENDING_CONSENT' },
      { _id: new ObjectId(), participantId: '10203043', status: 'PENDING_CONSENT' },
    ];

    const POLICY_PAYLOAD = {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    };

    function setup(pending) {
      const templates = makeCollection({
        find: vi.fn(() => makeCursor([])),
        insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      });
      const patients = makeCollection({
        find: vi.fn(() => makeCursor(pending)),
        updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
      });
      const participantIdentities = makeCollection({ findOne: vi.fn(async () => null) });
      const db = makeDb({ consent_templates: templates, patients, participantIdentities });

      vi.spyOn(notificationService, 'buildConsentMetadata').mockImplementation(() => ({
        token: 'tok-123',
        createdAt: new Date(),
        expiresAt: new Date(),
      }));
      vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-123');

      return { db, patients, templates };
    }

    /** participantIds the sweep persisted a consentToken for. */
    function tokenedParticipants(patients, pending) {
      return patients.updateOne.mock.calls
        .filter(([, update]) => update?.$set?.consentToken !== undefined)
        .map(([filter]) => pending.find((p) => String(p._id) === String(filter._id))?.participantId);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('keeps notifying the remaining patients after one of them throws', async () => {
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockImplementation(async (patient) => {
        // CONSENT_RECIPIENT_REQUIRED is the realistic case: sendConsentEmail
        // already throws it for a participant with no e-mail, which in a bulk
        // import cohort is not exotic.
        if (patient.participantId === '10203041') throw new Error('CONSENT_RECIPIENT_REQUIRED');
      });

      await consentService.createPolicy(db, POLICY_PAYLOAD);

      const notified = notificationService.enqueueConsentNotification.mock.calls.map(
        ([patient]) => patient.participantId
      );
      expect(notified).toEqual(['10203041', '10203042', '10203043']);
    });

    it('persists a consentToken for the patient whose delivery failed, so a resend can validate it', async () => {
      const pending = THREE_PENDING();
      const { db, patients } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockImplementation(async (patient) => {
        if (patient.participantId === '10203041') throw new Error('CONSENT_RECIPIENT_REQUIRED');
      });

      await consentService.createPolicy(db, POLICY_PAYLOAD);

      expect(tokenedParticipants(patients, pending)).toEqual(['10203041', '10203042', '10203043']);
    });

    it('does not mark a patient as notified when their delivery threw', async () => {
      const pending = THREE_PENDING();
      const { db, patients } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockImplementation(async (patient) => {
        if (patient.participantId === '10203041') throw new Error('CONSENT_RECIPIENT_REQUIRED');
      });

      await consentService.createPolicy(db, POLICY_PAYLOAD);

      const notifiedIds = patients.updateOne.mock.calls
        .filter(([, update]) => update?.$set?.consentNotifiedAt !== undefined)
        .map(([filter]) => pending.find((p) => String(p._id) === String(filter._id))?.participantId);
      expect(notifiedIds).toEqual(['10203042', '10203043']);
    });

    it('survives an identity lookup that throws, which is the other reachable failure in the loop body', async () => {
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      const identities = await db.collection('participantIdentities');
      identities.findOne = vi.fn(async ({ participantId }) => {
        if (participantId === '10203041') throw new Error('decrypt failed');
        return null;
      });
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.createPolicy(db, POLICY_PAYLOAD);

      const notified = notificationService.enqueueConsentNotification.mock.calls.map(
        ([patient]) => patient.participantId
      );
      expect(notified).toEqual(['10203042', '10203043']);
    });

    // The publication reported success with no signal that the sweep stopped
    // a third of the way in. A count makes a partial sweep visible.
    it('reports how many invitations were sent and how many failed', async () => {
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockImplementation(async (patient) => {
        if (patient.participantId === '10203041') throw new Error('CONSENT_RECIPIENT_REQUIRED');
      });

      const result = await consentService.createPolicy(db, POLICY_PAYLOAD);

      expect(result.consentNotifications).toEqual({ total: 3, notified: 2, failed: 1 });
    });

    it('reports a clean sweep when every patient succeeds', async () => {
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      const result = await consentService.createPolicy(db, POLICY_PAYLOAD);

      expect(result.consentNotifications).toEqual({ total: 3, notified: 3, failed: 0 });
    });
  });

  it('rejects when validTo is earlier than validFrom', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createPolicy(db, {
        title: 'Policy',
        htmlContent: '<p>content</p>',
        validFrom: '2026-06-01T00:00:00.000Z',
        validTo: '2026-01-01T00:00:00.000Z',
        granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
      })
    ).rejects.toThrow('vigência');

    expect(templates.insertOne).not.toHaveBeenCalled();
  });

  it('does not fail the whole operation when patient notification throws', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const patients = makeCollection({ find: vi.fn(() => { throw new Error('boom'); }) });
    const db = makeDb({ consent_templates: templates, patients });

    const payload = {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    };

    const result = await consentService.createPolicy(db, payload);
    expect(result._id).toBeDefined();
  });

  it('rejects an unparseable validFrom/validTo period', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createPolicy(db, {
        title: 'Policy',
        htmlContent: '<p>content</p>',
        validFrom: 'not-a-date',
        validTo: '2026-12-31T23:59:59.000Z',
        granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
      })
    ).rejects.toThrow('Período de vigência inválido');

    expect(templates.insertOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid previousPolicyId format', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createPolicy(
        db,
        {
          title: 'Policy',
          htmlContent: '<p>content</p>',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2026-12-31T23:59:59.000Z',
          granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
        },
        { previousPolicyId: 'not-an-object-id' }
      )
    ).rejects.toThrow('ID do TCLE para atualização é inválido');
  });

  it('rejects when previousPolicyId does not match an existing policy', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      findOne: vi.fn(async () => null),
    });
    const db = makeDb({ consent_templates: templates });

    await expect(
      consentService.createPolicy(
        db,
        {
          title: 'Policy',
          htmlContent: '<p>content</p>',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2026-12-31T23:59:59.000Z',
          granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
        },
        { previousPolicyId: new ObjectId().toString() }
      )
    ).rejects.toThrow('TCLE anterior não encontrado para atualização');
  });

  it('inherits versionGroupId from the previous policy when not explicitly provided', async () => {
    const previousId = new ObjectId();
    const previousPolicy = { _id: previousId, versionGroupId: 'group-xyz' };
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      findOne: vi.fn(async () => previousPolicy),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createPolicy(
      db,
      {
        title: 'Policy',
        htmlContent: '<p>content</p>',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-12-31T23:59:59.000Z',
        granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
      },
      { previousPolicyId: previousId.toString() }
    );

    expect(result.versionGroupId).toBe('group-xyz');
    expect(result.revisionType).toBe('update');
  });

  it('defaults validFrom to now when the payload omits it', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createPolicy(db, {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validTo: '2999-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(result.validFrom).toBeDefined();
    expect(Number.isNaN(new Date(result.validFrom).getTime())).toBe(false);
  });

  it('falls back to payload.permissions when granularPermissions is absent', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createPolicy(db, {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2999-12-31T23:59:59.000Z',
      permissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(result.granularPermissions).toEqual([{ key: 'analytics', label: 'Analytics', required: false }]);
  });

  it('trims an explicit caae on the policy', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createPolicy(db, {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      caae: '  CAAE-99  ',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2999-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(result.caae).toBe('CAAE-99');
  });

  it('uses an explicit versionGroupId option without needing a previousPolicyId', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.createPolicy(
      db,
      {
        title: 'Policy',
        htmlContent: '<p>content</p>',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2999-12-31T23:59:59.000Z',
        granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
      },
      { versionGroupId: 'explicit-policy-group' }
    );

    expect(result.versionGroupId).toBe('explicit-policy-group');
  });

  it('skips deactivating other policies when active is explicitly false', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
    });
    const db = makeDb({ consent_templates: templates });

    await consentService.createPolicy(db, {
      title: 'Policy',
      htmlContent: '<p>content</p>',
      active: false,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2999-12-31T23:59:59.000Z',
      granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
    });

    expect(templates.updateMany).not.toHaveBeenCalled();
  });
});

describe('ConsentService.getActiveTemplate / getAllTemplates / getLatestTemplate', () => {
  it('getActiveTemplate returns the first active template found', async () => {
    const item = { _id: new ObjectId(), active: true };
    const templates = makeCollection({ find: vi.fn(() => makeCursor([item])) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getActiveTemplate(db);
    expect(result).toBe(item);
  });

  it('getActiveTemplate returns null when none active', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getActiveTemplate(db);
    expect(result).toBeNull();
  });

  it('getAllTemplates returns the full array from the collection', async () => {
    const items = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
    const templates = makeCollection({ find: vi.fn(() => makeCursor(items)) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getAllTemplates(db);
    expect(result).toEqual(items);
  });

  it('getLatestTemplate returns the first item in the cursor', async () => {
    const items = [{ _id: new ObjectId(), version: 'v9' }];
    const templates = makeCollection({ find: vi.fn(() => makeCursor(items)) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getLatestTemplate(db);
    expect(result).toEqual(items[0]);
  });
});

describe('ConsentService.getActivePolicy / getAllPolicies / getPoliciesHistory / getActivePoliciesWithCaae', () => {
  it('getActivePolicy returns the first active item', async () => {
    const item = { _id: new ObjectId(), active: true };
    const templates = makeCollection({ find: vi.fn(() => makeCursor([item])) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getActivePolicy(db);
    expect(result).toBe(item);
  });

  it('getAllPolicies returns everything from the collection', async () => {
    const items = [{ _id: new ObjectId() }];
    const templates = makeCollection({ find: vi.fn(() => makeCursor(items)) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getAllPolicies(db);
    expect(result).toEqual(items);
  });

  it('getPoliciesHistory paginates and reports totals', async () => {
    const items = [{ _id: new ObjectId() }];
    const templates = makeCollection({
      find: vi.fn(() => makeCursor(items)),
      countDocuments: vi.fn(async () => 25),
    });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getPoliciesHistory(db, { page: 2, limit: 10 });
    expect(result.items).toEqual(items);
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });

  it('getPoliciesHistory filters by versionGroupId when provided', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await consentService.getPoliciesHistory(db, { groupId: 'group-1' });
    expect(templates.find).toHaveBeenCalledWith({ versionGroupId: 'group-1' });
  });

  it('getPoliciesHistory builds a generic $or search filter for free text', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await consentService.getPoliciesHistory(db, { search: 'privacy' });

    const filter = templates.find.mock.calls[0][0];
    expect(filter.$or).toBeDefined();
    expect(filter.$and).toBeUndefined();
  });

  it('getPoliciesHistory narrows the search to active items for "ativo"', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await consentService.getPoliciesHistory(db, { search: 'ativo' });

    const filter = templates.find.mock.calls[0][0];
    expect(filter.$and).toEqual([{ active: true }, { $or: expect.any(Array) }]);
  });

  it('getPoliciesHistory narrows the search to inactive items for "inactive"', async () => {
    const templates = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ consent_templates: templates });

    await consentService.getPoliciesHistory(db, { search: 'inactive' });

    const filter = templates.find.mock.calls[0][0];
    expect(filter.$and).toEqual([{ active: false }, { $or: expect.any(Array) }]);
  });

  it('getActivePoliciesWithCaae only queries active items with a caae', async () => {
    const items = [{ _id: new ObjectId(), caae: 'CAAE-1' }];
    const templates = makeCollection({ find: vi.fn(() => makeCursor(items)) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.getActivePoliciesWithCaae(db);
    expect(result).toEqual(items);
    expect(templates.find).toHaveBeenCalledWith({
      active: true,
      caae: { $exists: true, $nin: ['', null] },
    });
  });
});

describe('ConsentService.updatePolicy', () => {
  it('delegates to createPolicy with previousPolicyId set', async () => {
    const spy = vi.spyOn(consentService, 'createPolicy').mockResolvedValue({ _id: 'fake' });
    const db = makeDb();
    const policyId = new ObjectId().toString();

    const result = await consentService.updatePolicy(db, policyId, { title: 'x' });

    expect(spy).toHaveBeenCalledWith(db, { title: 'x' }, { previousPolicyId: policyId });
    expect(result).toEqual({ _id: 'fake' });

    spy.mockRestore();
  });
});

describe('ConsentService.createPatientConsent', () => {
  const templateId = new ObjectId();
  const activeTemplate = {
    _id: templateId,
    active: true,
    permissions: [{ key: 'analytics', required: false }],
  };
  // signatureImageBase64/signatureName are optional in the schema, but
  // normalizeSignaturePayload always sets signatureHash: null and
  // signatureName/signatureImageBase64: '' when no image is supplied, and the
  // ajv schema enforces minLength:1 / type:string on those *optional*
  // properties whenever they are present. So a consent with no signature at
  // all currently fails schema validation unconditionally - see finding in
  // report. Work around it here by always supplying a valid signature image.
  const validSignature = { signatureImageBase64: Buffer.from('sig').toString('base64'), signatureName: 'Jane Doe' };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a consent when patient and template are valid', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ...validSignature,
    });

    expect(result._id).toBeDefined();
    expect(result.status).toBe('ACTIVE');
    expect(consents.updateMany).toHaveBeenCalledWith(
      { participantId: '12345678', status: 'ACTIVE' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REVOKED' }) })
    );
  });

  it('rejects when the patient does not exist', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ patients, consent_templates: makeCollection(), patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: {},
        ...validSignature,
      })
    ).rejects.toThrow('não encontrado');
  });

  it('rejects when the template is not active', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const inactiveTemplate = { ...activeTemplate, active: false };
    const templates = makeCollection({ findOne: vi.fn(async () => inactiveTemplate) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: { analytics: true },
        ...validSignature,
      })
    ).rejects.toThrow('não está ativo');
  });

  it('accepts a submitted boolean response for a required permission (#63)', async () => {
    // Regression test for #63: the shared ajv instance used to strip every
    // key out of `responses` (removeAdditional: 'all' ignored the nested
    // `additionalProperties: { type: 'boolean' }` schema), so a truthy
    // answer for a required permission never reached
    // validateResponsesAgainstTemplate and always failed as "missing".
    const templateWithRequiredPermission = {
      ...activeTemplate,
      permissions: [{ key: 'analytics', required: true }],
    };
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => templateWithRequiredPermission) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ...validSignature,
    });

    expect(result._id).toBeDefined();
  });

  it('rejects when a required permission response is missing (#63)', async () => {
    const templateWithRequiredPermission = {
      ...activeTemplate,
      permissions: [{ key: 'analytics', required: true }],
    };
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => templateWithRequiredPermission) });
    const consents = makeCollection();
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: {},
        ...validSignature,
      })
    ).rejects.toThrow('inválidas');
  });

  it('rejects when the consentTemplateId matches no template', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: {},
        ...validSignature,
      })
    ).rejects.toThrow('Template de consentimento não encontrado');
  });

  it('rejects when the template is not yet in force', async () => {
    const futureTemplate = { ...activeTemplate, validFrom: '2999-01-01T00:00:00.000Z' };
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => futureTemplate) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: { analytics: true },
        ...validSignature,
      })
    ).rejects.toThrow('ainda não está vigente');
  });

  it('rejects when the template has expired', async () => {
    const expiredTemplate = { ...activeTemplate, validTo: '2000-01-01T00:00:00.000Z' };
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => expiredTemplate) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: { analytics: true },
        ...validSignature,
      })
    ).rejects.toThrow('expirado');
  });

  it('rejects an invalid consentTemplateId format', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const db = makeDb({ patients, consent_templates: makeCollection(), patientConsents: makeCollection() });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: 'not-a-valid-object-id',
        responses: {},
        ...validSignature,
      })
    ).rejects.toThrow('consentTemplateId inválido');
  });

  it('accepts signatureBase64 as an alias for signatureImageBase64 from the frontend', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      signatureName: 'Jane Doe',
      signatureBase64: Buffer.from('sig-via-alias').toString('base64'),
    });

    expect(result._id).toBeDefined();
    expect(result.signatureHash).toBeDefined();
  });

  it('links the consent to a study when a valid studyId is provided (RF021 AC#4, #593)', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const studies = makeCollection({ findOne: vi.fn(async () => ({ studyId: 'study-1', studyStatus: 'active' })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents, studies });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      studyId: 'study-1',
      ...validSignature,
    });

    expect(studies.findOne).toHaveBeenCalledWith({ studyId: 'study-1' });
    expect(result.studyId).toBe('study-1');
  });

  it('rejects when the provided studyId matches no study (RF021 AC#4, #593)', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const studies = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection(), studies });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: { analytics: true },
        studyId: 'does-not-exist',
        ...validSignature,
      })
    ).rejects.toThrow('studyId does-not-exist não encontrado');
  });

  it('rejects with 422 when the linked study is not active (RF021 AC#5, #596)', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const studies = makeCollection({ findOne: vi.fn(async () => ({ studyId: 'study-1', studyStatus: 'closed-to-accrual' })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: makeCollection(), studies });

    await expect(
      consentService.createPatientConsent(db, {
        participantId: '12345678',
        consentTemplateId: templateId.toString(),
        responses: { analytics: true },
        studyId: 'study-1',
        ...validSignature,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('ConsentService.revokeConsent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes an active consent', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, status: 'ACTIVE', patientId: '12345678' };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const db = makeDb({ patientConsents: consents });

    const result = await consentService.revokeConsent(db, consentId.toString());

    expect(result.status).toBe('REVOKED');
    expect(consents.updateOne).toHaveBeenCalledWith(
      { _id: consentId },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REVOKED' }) })
    );
  });

  it('returns the consent unchanged when it is already revoked', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, status: 'REVOKED' };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const db = makeDb({ patientConsents: consents });

    const result = await consentService.revokeConsent(db, consentId.toString());

    expect(result).toBe(consent);
    expect(consents.updateOne).not.toHaveBeenCalled();
  });

  it('#650 (RF015 consentimento) dispatches a consent_revoked notification when a real revocation happens', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, status: 'ACTIVE', participantId: 'PART-1' };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const db = makeDb({ patientConsents: consents });
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await consentService.revokeConsent(db, consentId.toString());

    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'PatientConsent',
      sourceEventId: consentId,
      payload: {
        participantId: 'PART-1',
        consentId: consentId.toString()
      }
    });
  });

  it('#650 (RF015 consentimento) does not dispatch a notification when the consent was already revoked', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, status: 'REVOKED' };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const db = makeDb({ patientConsents: consents });
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await consentService.revokeConsent(db, consentId.toString());

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('#685 does not crash the process when the notification engine itself fails on revocation (unhandled rejection guard)', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, status: 'ACTIVE', participantId: 'PART-1' };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const db = makeDb({ patientConsents: consents });
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue(new Error('notificationRules lookup failed'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await consentService.revokeConsent(db, consentId.toString());

    // Fire-and-forget (`void`, no await in revokeConsent) -- give the
    // rejection a turn of the microtask queue to reach a .catch() before
    // asserting it was actually handled, not left unhandled.
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NOTIFICATION_DISPATCH]'),
      expect.anything()
    ));
  });

  it('returns null when the consent does not exist', async () => {
    const consents = makeCollection({ findOne: vi.fn(async () => null) });
    const db = makeDb({ patientConsents: consents });

    const result = await consentService.revokeConsent(db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it('throws for a malformed consent id', async () => {
    const db = makeDb({ patientConsents: makeCollection() });
    await expect(consentService.revokeConsent(db, 'not-an-object-id')).rejects.toThrow('inválido');
  });
});

// FHIR is a pure serialization boundary (docs/architecture/canonical-data-cleanup.md)
// — getPatientConsent reads directly from the canonical Mongo collection,
// no FHIR-first read path exists (fhir-sync.service.js was removed entirely
// in e2549bee).
describe('ConsentService.getPatientConsent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the most recent consent from the collection', async () => {
    const legacyConsent = { _id: 'legacy-1', status: 'ACTIVE' };
    const consents = makeCollection({ find: vi.fn(() => makeCursor([legacyConsent])) });
    const db = makeDb({ patientConsents: consents });

    const result = await consentService.getPatientConsent(db, '12345678');
    expect(result).toBe(legacyConsent);
  });

  it('returns null when nothing is found', async () => {
    const consents = makeCollection({ find: vi.fn(() => makeCursor([])) });
    const db = makeDb({ patientConsents: consents });

    const result = await consentService.getPatientConsent(db, '12345678');
    expect(result).toBeNull();
  });
});
