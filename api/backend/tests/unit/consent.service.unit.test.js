import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const consentService = require('../../src/services/consent.service');
const notificationService = require('../../src/services/notification.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const logger = require('../../src/utils/logger');
const consentEvidence = require('../../src/services/consentEvidence.service');
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
    insertMany: vi.fn(async (docs) => ({ insertedCount: docs.length })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    // #1313: the outbox's per-aggregate version counter.
    findOneAndUpdate: vi.fn(async () => ({ version: 1 })),
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

// #1313: a replica-set client whose one session runs each transaction, so a
// case can read which writes carried it.
function makeTransactionalClient() {
  const session = { id: 'consent-session', withTransaction: vi.fn(async (fn) => { await fn(); }), endSession: vi.fn(async () => {}) };
  return {
    session,
    client: {
      db: () => ({ command: async () => ({ setName: 'rs0' }) }),
      startSession: vi.fn(() => session),
    },
  };
}

// The session each call of a spy carried, read from its options argument.
function sessionsOf(spy, optionsIndex) {
  return spy.mock.calls.map((call) => call[optionsIndex]?.session);
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
  // #820: these two used to assert the defect -- signatureImageBase64: '',
  // signatureHash: null and a default mime type were emitted for a consent
  // with no signature, and patientConsentSchema declares those optional
  // properties `minLength: 1`, so present-and-empty was rejected. The keys are
  // now omitted instead. Written before the bug was found, so they carried no
  // issue marker while asserting the broken behaviour verbatim.
  it('omits the signature keys entirely when no image is provided, keeping the name', () => {
    const result = consentService.normalizeSignaturePayload({ signatureName: 'Test User' });
    expect(result).toEqual({ signatureName: 'Test User' });
    expect('signatureImageBase64' in result).toBe(false);
    expect('signatureHash' in result).toBe(false);
    expect('signatureMimeType' in result).toBe(false);
  });

  it('returns a completely empty object when there is no signature and no name', () => {
    expect(consentService.normalizeSignaturePayload({})).toEqual({});
  });

  it('still defaults signatureMimeType to image/png when an image IS provided', () => {
    // The default belongs to the signature-present branch; declaring a mime
    // type for an image that does not exist records a fact that is not true.
    const result = consentService.normalizeSignaturePayload({
      signatureImageBase64: Buffer.from('img').toString('base64'),
    });
    expect(result.signatureMimeType).toBe('image/png');
  });

  it('a signature-less payload passes schema validation -- the whole point of #820', () => {
    const normalized = consentService.normalizeSignaturePayload({});
    expect(() =>
      consentService.validatePatientConsentPayload({
        participantId: '12345678',
        consentTemplateId: '000000000000000000000000',
        responses: { analytics: true },
        ...normalized,
      })
    ).not.toThrow();
  });

  it('an explicitly-empty signatureImageBase64 is dropped, not preserved as empty', () => {
    const result = consentService.normalizeSignaturePayload({
      signatureImageBase64: '',
      signatureName: '   ',
    });
    expect(result).toEqual({});
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

  // RNF018: a schema failure is a validation failure, answered 422 with details.
  it('marks a schema failure 422 and lists each failure in details', () => {
    let thrown;
    try {
      consentService.validateTemplatePayload({ title: 'Title', htmlContent: '<p>x</p>' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown.statusCode).toBe(422);
    expect(thrown.details).toEqual([expect.stringContaining("'content'")]);
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

  it('marks a schema failure 422 and lists each failure in details', () => {
    const { title: _t, ...noTitle } = validPolicy;
    let thrown;
    try {
      consentService.validatePolicyPayload(noTitle);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.statusCode).toBe(422);
    expect(thrown.details).toEqual([expect.stringContaining("'title'")]);
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

  it('increments past the highest version of the lineage, reading only that lineage (#1181)', async () => {
    const templates = makeCollection({
      find: vi.fn(() => makeCursor([{ version: 'v3' }, { version: 'v7' }, { version: 'v2' }])),
    });
    const db = makeDb({ consent_templates: templates });

    const version = await consentService.generateNextPolicyVersion(db, 'lineage-a');
    expect(version).toBe('v8');
    expect(templates.find).toHaveBeenCalledWith({ versionGroupId: 'lineage-a' }, expect.anything());
  });

  it('starts a lineage with no id at v1 without reading other terms (#1181)', async () => {
    const templates = makeCollection();
    const db = makeDb({ consent_templates: templates });

    await expect(consentService.generateNextPolicyVersion(db)).resolves.toBe('v1');
    expect(templates.find).not.toHaveBeenCalled();
  });
});

describe('ConsentService.createTemplate', () => {
  it('creates a template, deactivating the active term of its own lineage only (#1181)', async () => {
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
    expect(result.version).toBe('v1');
    expect(templates.updateMany).toHaveBeenCalledWith(
      { versionGroupId: result.versionGroupId, active: true },
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

  // #824 (found proving it on the real stack): the builder's CAAE field is
  // optional, createTemplate stores an absent one as '' (ConsentTemplateModel
  // .create), and this re-validated that stored '' against `caae: minLength 1`
  // -- so a term created without a CAAE could never be revised in the builder.
  it('revises a term that was created without a CAAE', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'No CAAE',
      content: 'c',
      htmlContent: 'c',
      version: 'v1',
      caae: '',
      active: true,
      permissions: [{ key: 'analytics', label: 'Analytics', required: false }],
    };
    const templates = makeCollection({ findOne: vi.fn(async () => existing) });
    const db = makeDb({ consent_templates: templates });

    const result = await consentService.updateTemplate(db, existingId.toString(), { title: 'No CAAE', content: 'c2' });

    expect(result.version).toBe('v2');
    expect(templates.insertOne).toHaveBeenCalled();
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
  // #835: the id a pending cohort actually points at. These two tests used to
  // call createPolicy directly with a filter-blind patients.find mock, so they
  // asserted a notification that could never happen in production -- the sweep
  // filtered on the just-inserted template's own id. They now go through
  // updatePolicy, which is the only path that has a prior cohort at all.
  const PRIOR_POLICY_ID = new ObjectId();

  it('creates a policy document and notifies pending patients, resolving patientName via ParticipantIdentity (#561/#564)', async () => {
    const templates = makeCollection({
      findOne: vi.fn(async () => ({ _id: PRIOR_POLICY_ID, versionGroupId: 'group-561' })),
      find: vi.fn(() => makeCursor([{ _id: PRIOR_POLICY_ID }])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
    });
    const pendingPatient = {
      _id: new ObjectId(),
      participantId: '10203040',
      status: 'PENDING_CONSENT',
      consentTemplateId: PRIOR_POLICY_ID.toString(),
    };
    const patients = makeCollection({
      // #835: honours the filter, so a sweep querying the wrong id finds
      // nobody and fails this test rather than passing it.
      find: vi.fn((filter = {}) =>
        makeCursor(
          Array.isArray(filter?.consentTemplateId?.$in) &&
            filter.consentTemplateId.$in.includes(pendingPatient.consentTemplateId)
            ? [pendingPatient]
            : []
        )
      ),
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

    const result = await consentService.updatePolicy(db, PRIOR_POLICY_ID.toString(), payload);

    expect(result._id).toBeDefined();
    expect(result.version).toBe('v1');
    expect(result.revisionType).toBe('update');
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
      findOne: vi.fn(async () => ({ _id: PRIOR_POLICY_ID, versionGroupId: 'group-574' })),
      find: vi.fn(() => makeCursor([{ _id: PRIOR_POLICY_ID }])),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
    });
    const pendingPatient = {
      _id: new ObjectId(),
      participantId: '10203040',
      status: 'PENDING_CONSENT',
      consentTemplateId: PRIOR_POLICY_ID.toString(),
    };
    const patients = makeCollection({
      // #835: filter-honouring, same as the test above.
      find: vi.fn((filter = {}) =>
        makeCursor(
          Array.isArray(filter?.consentTemplateId?.$in) &&
            filter.consentTemplateId.$in.includes(pendingPatient.consentTemplateId)
            ? [pendingPatient]
            : []
        )
      ),
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

    await consentService.updatePolicy(db, PRIOR_POLICY_ID.toString(), payload);

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
    // #835: these carry a consentTemplateId now, and it is the *previous*
    // policy's id -- which is how a real pending cohort looks, since
    // Patient.consentTemplateId is assigned at patient creation against a
    // template that already exists. Without it the sweep correctly finds
    // nobody.
    const PREVIOUS_POLICY_ID = new ObjectId();

    const THREE_PENDING = () => [
      { _id: new ObjectId(), participantId: '10203041', status: 'PENDING_CONSENT', consentTemplateId: PREVIOUS_POLICY_ID.toString() },
      { _id: new ObjectId(), participantId: '10203042', status: 'PENDING_CONSENT', consentTemplateId: PREVIOUS_POLICY_ID.toString() },
      { _id: new ObjectId(), participantId: '10203043', status: 'PENDING_CONSENT', consentTemplateId: PREVIOUS_POLICY_ID.toString() },
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
        // updatePolicy resolves the previous policy to inherit its
        // versionGroupId, then the sweep looks up the rest of the lineage.
        findOne: vi.fn(async () => ({ _id: PREVIOUS_POLICY_ID, versionGroupId: 'group-810' })),
        find: vi.fn(() => makeCursor([{ _id: PREVIOUS_POLICY_ID }])),
        insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
        updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
      });
      const patients = makeCollection({
        // #835: this used to return `pending` regardless of the filter it was
        // handed, so the sweep's query -- which could never match anyone in
        // production -- looked correct here. That is the #797/#771 mock
        // blindness exactly. It now honours the filter, so a wrong query
        // fails the test instead of passing it.
        find: vi.fn((filter = {}) => {
          const wanted = filter?.consentTemplateId?.$in;
          if (!Array.isArray(wanted)) return makeCursor([]);
          return makeCursor(
            pending.filter(
              (patient) =>
                patient.status === filter.status && wanted.includes(patient.consentTemplateId)
            )
          );
        }),
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

    /** participantIds the sweep persisted a consentTokenHash for (#1049). */
    function tokenedParticipants(patients, pending) {
      return patients.updateOne.mock.calls
        .filter(([, update]) => update?.$set?.consentTokenHash !== undefined)
        .map(([filter]) => pending.find((p) => String(p._id) === String(filter._id))?.participantId);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // #835: the sweep filtered on `result.insertedId` -- the id of the template
    // it had just inserted -- so it matched nobody, ever. These pin the target
    // it must actually use.
    it('targets the cohort pending on the previous version, not the id it just created', async () => {
      const pending = THREE_PENDING();
      const { db, patients, templates } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      const sweepCall = patients.find.mock.calls.find(([filter]) => filter?.status === 'PENDING_CONSENT');
      expect(sweepCall).toBeDefined();

      const targeted = sweepCall[0].consentTemplateId.$in.map(String);
      expect(targeted).toContain(PREVIOUS_POLICY_ID.toString());

      // The decisive assertion: the newly inserted template's own id must not
      // be what the sweep looks for.
      const insertedId = String((await templates.insertOne.mock.results[0].value).insertedId);
      expect(targeted).not.toContain(insertedId);

      expect(
        notificationService.enqueueConsentNotification.mock.calls.map(([patient]) => patient.participantId)
      ).toEqual(['10203041', '10203042', '10203043']);
    });

    // #824: the TCLE builder -- the only UI that publishes a term -- revises
    // through updateTemplate, which created the new version and invited
    // nobody: the sweep lived only in createPolicy, whose frontend client is
    // commented out. dict-07 row 39 makes the two one entity
    // (ConsentTemplate), so both paths now share ONE sweep.
    it('a builder revision (updateTemplate) invites the cohort pending on the term it revises (#824)', async () => {
      const pending = THREE_PENDING();
      const { db, templates } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      const result = await consentService.updateTemplate(db, PREVIOUS_POLICY_ID.toString(), {
        title: 'Policy v2',
        content: '<p>revised</p>',
        permissions: [{ key: 'analytics', label: 'Analytics', required: false }],
      });

      expect(
        notificationService.enqueueConsentNotification.mock.calls.map(([patient]) => patient.participantId)
      ).toEqual(['10203041', '10203042', '10203043']);
      expect(result.consentNotifications).toEqual({ total: 3, notified: 3, failed: 0 });
      // The canonical lineage fields createPolicy writes and the sweep reads
      // (RF010 AC#1), not only the builder's own previousTemplateId.
      expect(templates.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        previousPolicyId: PREVIOUS_POLICY_ID.toString(),
        versionGroupId: 'group-810',
        revisionType: 'update',
      }));
    });

    it('a builder create (createTemplate) starts a lineage and reports an empty sweep (#824)', async () => {
      const pending = THREE_PENDING();
      const { db, templates } = setup(pending);
      db.collection('consent_templates').find = vi.fn((filter = {}) =>
        filter.versionGroupId !== undefined ? makeCursor([]) : makeCursor([{ version: 'v1' }])
      );
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      const result = await consentService.createTemplate(db, {
        title: 'Brand new term',
        content: '<p>new</p>',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-12-31T23:59:59.000Z',
        permissions: [{ key: 'analytics', label: 'Analytics', required: false }],
      });

      expect(notificationService.enqueueConsentNotification).not.toHaveBeenCalled();
      expect(result.consentNotifications).toEqual({ total: 0, notified: 0, failed: 0 });
      expect(templates.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        previousPolicyId: null,
        revisionType: 'create',
        // The validity period the builder sends is kept, not dropped.
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2026-12-31T23:59:59.000Z'),
      }));
    });

    it('sweeps the whole version lineage, so someone pending on an older version is still invited', async () => {
      const olderTemplateId = new ObjectId();
      const pending = THREE_PENDING();
      pending[2].consentTemplateId = olderTemplateId.toString();

      const { db } = setup(pending);
      // The lineage lookup returns both prior versions of this term.
      db.collection('consent_templates').find = vi.fn(() =>
        makeCursor([{ _id: PREVIOUS_POLICY_ID }, { _id: olderTemplateId }])
      );
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      expect(
        notificationService.enqueueConsentNotification.mock.calls.map(([patient]) => patient.participantId)
      ).toEqual(['10203041', '10203042', '10203043']);
    });

    it('issues nothing for a brand-new term with no predecessor -- nobody can be pending on it', async () => {
      const pending = THREE_PENDING();
      const { db, patients } = setup(pending);
      // A fresh create: no previousPolicyId, and no lineage to inherit.
      db.collection('consent_templates').find = vi.fn(() => makeCursor([]));
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.createPolicy(db, POLICY_PAYLOAD);

      expect(notificationService.enqueueConsentNotification).not.toHaveBeenCalled();
      // And no query for a cohort was issued at all, rather than one that
      // silently matches nothing.
      expect(patients.find.mock.calls.filter(([f]) => f?.status === 'PENDING_CONSENT')).toEqual([]);
    });

    it('does not sweep on an empty versionGroupId, which would match every template missing the field', async () => {
      const pending = THREE_PENDING();
      const { db, templates } = setup(pending);
      // A pre-versionGroupId template: the lookup must not run at all.
      templates.findOne = vi.fn(async () => ({ _id: PREVIOUS_POLICY_ID }));
      const lineageLookup = vi.fn(() => makeCursor([]));
      templates.find = lineageLookup;
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      // createPolicy still generates a versionGroupId for the *new* document,
      // so the lookup may run -- but never with an undefined group id.
      for (const [filter] of lineageLookup.mock.calls) {
        if (filter && 'versionGroupId' in filter) {
          expect(filter.versionGroupId).toBeTruthy();
        }
      }
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

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

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

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      expect(tokenedParticipants(patients, pending)).toEqual(['10203041', '10203042', '10203043']);
    });

    it('does not mark a patient as notified when their delivery threw', async () => {
      const pending = THREE_PENDING();
      const { db, patients } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockImplementation(async (patient) => {
        if (patient.participantId === '10203041') throw new Error('CONSENT_RECIPIENT_REQUIRED');
      });

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

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

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

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

      const result = await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      expect(result.consentNotifications).toEqual({ total: 3, notified: 2, failed: 1 });
    });

    // #1166 slice 2: the sweep hands the send path the contact from the
    // decrypted identity record. These pending rows carry no email, as every
    // Patient will after slice 4.
    it('#1166: notifies with the email and phone from the decrypted identity record', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      const identities = await db.collection('participantIdentities');
      identities.findOne = vi.fn(async ({ participantId }) => ({
        ...participantIdentityService.encryptIdentityFields({
          participantId,
          email: `${participantId}@example.com`,
          phone: '11987654321',
        }),
        email: null,
        phone: null,
      }));
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

      expect(
        notificationService.enqueueConsentNotification.mock.calls.map(([patient]) => [patient.email, patient.phone])
      ).toEqual([
        ['10203041@example.com', '11987654321'],
        ['10203042@example.com', '11987654321'],
        ['10203043@example.com', '11987654321'],
      ]);
    });

    it('reports a clean sweep when every patient succeeds', async () => {
      const pending = THREE_PENDING();
      const { db } = setup(pending);
      vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

      const result = await consentService.updatePolicy(db, PREVIOUS_POLICY_ID.toString(), POLICY_PAYLOAD);

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
  // #820 (fixed): this fixture used to exist as a *workaround* -- a consent
  // with no signature failed schema validation unconditionally, because
  // normalizeSignaturePayload emptied rather than omitted the four signature
  // fields and the ajv schema declares them minLength:1. The signature-less
  // path is now covered directly by the 'records a consent with no signature
  // at all' test below; this fixture stays only to exercise the
  // signature-*bearing* branch, which is a real path too (the operator-side
  // POST /api/e-consent/consents carries one).
  const validSignature = { signatureImageBase64: Buffer.from('sig').toString('base64'), signatureName: 'Jane Doe' };

  // #827: every recorded consent now writes an encrypted evidence document.
  // Kept off the disk here; consentEvidence.service.unit.test.js owns it.
  beforeEach(() => {
    vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue({
      evidenceDocumentUri: 'objstore://consents/stub/evidence.json',
      evidenceHash: `sha256:${'0'.repeat(64)}`,
      evidenceMimeType: 'application/json',
      evidenceEncryption: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #1313 (RF023 AC3): on a replica set the consent, its decision event, its
  // derived state and its outbox event are written in one transaction.
  it('writes the consent, its history and its outbox event in one transaction on a replica set', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const decisionEvents = makeCollection();
    const permissions = makeCollection();
    const outbox = makeCollection({ createIndex: vi.fn(async () => 'ok') });
    const db = makeDb({
      patients,
      consent_templates: templates,
      patientConsents: consents,
      consentDecisionEvents: decisionEvents,
      consentPermissions: permissions,
      graph_projection_outbox: outbox,
    });
    const { session, client } = makeTransactionalClient();
    db.client = client;

    await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ...validSignature,
    }, { channel: 'staff_portal', signerRole: 'participant', authenticationLevel: 'session' });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(sessionsOf(consents.insertOne, 1)).toEqual([session]);
    expect(sessionsOf(permissions.insertMany, 1)).toEqual([session]);
    expect(sessionsOf(decisionEvents.insertOne, 1)).toEqual([session]);
    expect(sessionsOf(decisionEvents.find, 1)).toEqual([session]);
    expect(sessionsOf(consents.updateOne, 2)).toEqual([session]);
    expect(sessionsOf(outbox.updateOne, 2)).toEqual([session]);
    expect(outbox.updateOne.mock.calls[0][1].$setOnInsert.eventType).toBe('CONSENT_UPSERTED');
  });

  it('creates a consent when patient and template are valid', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const decisionEvents = makeCollection();
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents, consentDecisionEvents: decisionEvents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ...validSignature,
    }, { channel: 'staff_portal', signerRole: 'participant', authenticationLevel: 'session' });

    expect(result._id).toBeDefined();
    expect(result.status).toBe('ACTIVE');
    expect(result.currentStateDerived).toBe('active');
    // RF010 AC4: the acceptance is an appended decision event.
    expect(decisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      consentId: result.consentId,
      decision: 'accepted',
      channel: 'staff_portal',
      signerRole: 'participant',
      signerId: '12345678',
      authenticationLevel: 'session',
      evidenceUri: 'objstore://consents/stub/evidence.json',
    }));
    // RF010 AC5: no earlier consent is overwritten in bulk.
    expect(consents.updateMany).not.toHaveBeenCalled();
  });

  // RF010 AC5: a newer consent supersedes the participant's consent in force
  // through that consent's history -- a `superseded` decision event and a
  // pointer -- and its state is derived from it.
  it('supersedes the participant\'s consent in force through its history', async () => {
    const priorId = new ObjectId();
    const prior = { _id: priorId, consentId: 'prior-uuid', participantId: '12345678', consentTemplateId: 'tmpl-0', status: 'ACTIVE', responses: { analytics: true } };
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ find: vi.fn(() => makeCursor([prior])) });
    const supersededEvent = { consentId: 'prior-uuid', decision: 'superseded', occurredAt: new Date() };
    const decisionEvents = makeCollection({
      find: vi.fn((query) => makeCursor(query.consentId === 'prior-uuid' ? [supersededEvent] : [])),
    });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents, consentDecisionEvents: decisionEvents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
    });

    expect(result.supersedesConsentId).toBe('prior-uuid');
    expect(decisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      consentId: 'prior-uuid',
      decision: 'superseded',
    }));
    expect(consents.updateOne).toHaveBeenCalledWith(
      { _id: priorId },
      { $set: { supersededByConsentId: result.consentId } }
    );
    expect(consents.updateOne).toHaveBeenCalledWith(
      { _id: priorId },
      { $set: expect.objectContaining({ currentStateDerived: 'superseded', status: 'REVOKED' }) }
    );
    expect(consents.updateMany).not.toHaveBeenCalled();
  });

  // #820: the path production actually takes. POST /api/e-consent/update --
  // the submit handler behind the participant e-consent page -- calls
  // createPatientConsent with no signature fields at all
  // (routes/eConsent.js), and every such acceptance used to 422 before
  // reaching any of the logic below. Covered nowhere until this test: every
  // other case here spreads validSignature.
  it('records a consent with no signature at all -- the participant page path', async () => {
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });

    expect(result.status).toBe('ACTIVE');
    expect(result.consentId).toBeTruthy();
    // PatientConsentModel.create's null defaults are what gets persisted --
    // the record is explicit that there was no signature, rather than carrying
    // an empty string that reads like a blank one.
    expect(result.signatureName).toBeNull();
    expect(result.signatureImageBase64).toBeNull();
    expect(result.signatureHash).toBeNull();
    expect(result.signatureMimeType).toBeNull();
    // Origin evidence is still captured (RF010 AC#4's "origem").
    expect(result.ipAddress).toBe('203.0.113.7');
    expect(result.userAgent).toBe('Mozilla/5.0');
  });

  // #827: RF010 AC#3 ("Vincular as respostas à versão exata do termo") and
  // AC#4's evidence -- dict-02 consentVersion (ELM-0091) and the evidence
  // trio (ELM-0105/0106, P1X-0373), all 1..1 Core. The recorder stored the
  // template id alone, so once the template group was revised the consent
  // could not be resolved back to the text the participant saw.
  it('records the exact term version and the stored evidence on every consent (#827)', async () => {
    const storeSpy = vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue({
      evidenceDocumentUri: 'objstore://consents/x/evidence.json',
      evidenceHash: `sha256:${'a'.repeat(64)}`,
      evidenceMimeType: 'application/json',
      evidenceEncryption: { algorithm: 'aes-256-gcm', keyId: 'k1', iv: 'iv', tag: 'tag' },
    });
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const versioned = { ...activeTemplate, version: '4', htmlContent: '<p>v4</p>' };
    const templates = makeCollection({ findOne: vi.fn(async () => versioned) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      ipAddress: '203.0.113.7',
    });

    expect(result.consentVersion).toBe('4');
    expect(result.evidenceDocumentUri).toBe('objstore://consents/x/evidence.json');
    expect(result.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceMimeType).toBe('application/json');
    // The evidence is written for THIS consent's id, against the template
    // actually loaded, with the answers actually recorded.
    expect(storeSpy).toHaveBeenCalledWith(expect.objectContaining({
      consentId: result.consentId,
      participantId: '12345678',
      template: versioned,
      responses: { analytics: true },
      ipAddress: '203.0.113.7',
    }));
    expect(consents.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      consentVersion: '4',
      evidenceHash: `sha256:${'a'.repeat(64)}`,
    }));
  });

  it('drops a caller-supplied empty signatureImageBase64 instead of 422ing on it', async () => {
    // Guards the merge side of the fix: normalizeSignaturePayload omitting the
    // key is not enough on its own, because createPatientConsent spreads the
    // caller's raw payload underneath it.
    const patients = makeCollection({ findOne: vi.fn(async () => ({ participantId: '12345678' })) });
    const templates = makeCollection({ findOne: vi.fn(async () => activeTemplate) });
    const consents = makeCollection({ insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })) });
    const db = makeDb({ patients, consent_templates: templates, patientConsents: consents });

    const result = await consentService.createPatientConsent(db, {
      participantId: '12345678',
      consentTemplateId: templateId.toString(),
      responses: { analytics: true },
      signatureImageBase64: '',
      signatureName: '',
    });

    expect(result.status).toBe('ACTIVE');
    expect(result.signatureImageBase64).toBeNull();
  });

  it('still records the signature when one IS supplied', async () => {
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

    expect(result.signatureName).toBe('Jane Doe');
    expect(result.signatureImageBase64).toBe(validSignature.signatureImageBase64);
    expect(result.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.signatureMimeType).toBe('image/png');
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
  // RF010 AC4/AC6: a revocation stores its own evidence document; kept off
  // the disk here, consentEvidence.service.unit.test.js owns it.
  beforeEach(() => {
    vi.spyOn(consentEvidence, 'storeRevocationEvidence').mockReturnValue({
      evidenceUri: 'objstore://consents/stub/revocation.json',
      evidenceHash: `sha256:${'1'.repeat(64)}`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The history a revocation appends is what the state is derived from, so
  // the fake revocations collection hands back what was inserted into it.
  function makeHistoryCollections() {
    const rows = { consentDecisionEvents: [], consentRevocations: [] };
    const collections = {};
    for (const name of Object.keys(rows)) {
      collections[name] = makeCollection({
        find: vi.fn(() => makeCursor(rows[name])),
        insertOne: vi.fn(async (doc) => { rows[name].push(doc); return { insertedId: new ObjectId() }; }),
      });
    }
    return collections;
  }

  // #1313 (RF023 AC3): the revocation, its decision event, the derived state
  // and the CONSENT_REVOKED event share one transaction on a replica set.
  it('writes the revocation, its history and its outbox event in one transaction on a replica set', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, consentId: 'c-uuid', status: 'ACTIVE', participantId: '12345678', consentTemplateId: 'tmpl-1', responses: { analytics: true } };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const history = makeHistoryCollections();
    const outbox = makeCollection({ createIndex: vi.fn(async () => 'ok') });
    const db = makeDb({ patientConsents: consents, ...history, graph_projection_outbox: outbox });
    const { session, client } = makeTransactionalClient();
    db.client = client;

    const result = await consentService.revokeConsent(db, consentId.toString());

    expect(result.status).toBe('REVOKED');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(sessionsOf(history.consentDecisionEvents.insertOne, 1)).toEqual([session]);
    expect(sessionsOf(history.consentRevocations.insertOne, 1)).toEqual([session]);
    expect(sessionsOf(consents.updateOne, 2)).toEqual([session]);
    expect(sessionsOf(outbox.updateOne, 2)).toEqual([session]);
    expect(outbox.updateOne.mock.calls[0][1].$setOnInsert.eventType).toBe('CONSENT_REVOKED');
  });

  it('revokes an active consent', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, consentId: 'c-uuid', status: 'ACTIVE', participantId: '12345678', consentTemplateId: 'tmpl-1', responses: { analytics: true } };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const history = makeHistoryCollections();
    const db = makeDb({ patientConsents: consents, ...history });

    const result = await consentService.revokeConsent(db, consentId.toString());

    expect(result.status).toBe('REVOKED');
    expect(result.currentStateDerived).toBe('revoked');
    expect(history.consentDecisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      consentId: 'c-uuid',
      decision: 'revoked',
      evidenceUri: 'objstore://consents/stub/revocation.json',
    }));
    expect(history.consentRevocations.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      consentId: 'c-uuid',
      scope: ['all'],
      priorUseDisposition: 'retain_history',
    }));
    expect(consents.updateOne).toHaveBeenCalledWith(
      { _id: consentId },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REVOKED', currentStateDerived: 'revoked' }) })
    );
  });

  // RF010 AC6: a scope naming some permissions leaves the consent in force
  // with those permissions blocked, and sends no revocation notice.
  it('records the server time and an unavailable location on the revocation evidence', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, consentId: 'c-uuid', status: 'ACTIVE', participantId: 'PART-1', consentTemplateId: 'tmpl-1', responses: { analytics: true, contact: true } };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const history = makeHistoryCollections();
    const db = makeDb({ patientConsents: consents, ...history });

    await consentService.revokeConsent(db, consentId.toString(), {
      scope: ['contact'],
      location: { status: 'unavailable' },
    });

    expect(consentEvidence.storeRevocationEvidence).toHaveBeenCalledWith(expect.objectContaining({
      location: { status: 'unavailable' },
      effectiveAt: expect.any(Date),
      channel: 'paper',
    }));
    expect(history.consentRevocations.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      location: { status: 'unavailable' },
      effectiveAt: expect.any(Date),
    }));
  });

  it('revokes only the scoped permissions and keeps the consent in force', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, consentId: 'c-uuid', status: 'ACTIVE', participantId: 'PART-1', consentTemplateId: 'tmpl-1', responses: { analytics: true, contact: true } };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const history = makeHistoryCollections();
    const db = makeDb({ patientConsents: consents, ...history });
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    const result = await consentService.revokeConsent(db, consentId.toString(), { scope: ['contact'], reason: 'não quer contato' });

    expect(result.status).toBe('ACTIVE');
    expect(result.currentStateDerived).toBe('partially_revoked');
    expect(result.effectivePermissions).toEqual({ analytics: true, contact: false });
    expect(result.responses).toEqual({ analytics: true, contact: true });
    expect(history.consentRevocations.insertOne).toHaveBeenCalledWith(expect.objectContaining({ scope: ['contact'], reason: 'não quer contato' }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('refuses a scope naming no permission of the consent with a 422', async () => {
    const consentId = new ObjectId();
    const consent = { _id: consentId, consentId: 'c-uuid', status: 'ACTIVE', participantId: 'PART-1', consentTemplateId: 'tmpl-1', responses: { analytics: true } };
    const consents = makeCollection({ findOne: vi.fn(async () => consent) });
    const history = makeHistoryCollections();
    const db = makeDb({ patientConsents: consents, ...history });

    await expect(consentService.revokeConsent(db, consentId.toString(), { scope: ['genetic'] }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(history.consentDecisionEvents.insertOne).not.toHaveBeenCalled();
    expect(history.consentRevocations.insertOne).not.toHaveBeenCalled();
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
    const db = makeDb({ patientConsents: consents, ...makeHistoryCollections() });
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await consentService.revokeConsent(db, consentId.toString());

    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'consent_revoked',
      sourceEventType: 'PatientConsent',
      sourceEventId: consentId,
      // #903 (RF015 AC5): linked to its purpose and the consent revoked.
      purpose: 'consent_revocation',
      consentId: consentId.toString(),
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
    const db = makeDb({ patientConsents: consents, ...makeHistoryCollections() });
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
