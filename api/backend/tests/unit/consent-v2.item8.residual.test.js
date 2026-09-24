import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const consentService = require('../../src/services/consent.service');

function cursor(items = []) {
  const self = {
    sort: vi.fn(() => self),
    skip: vi.fn(() => self),
    limit: vi.fn(() => self),
    toArray: vi.fn(async () => items),
  };
  return self;
}

function collection(overrides = {}) {
  return {
    find: vi.fn(() => cursor([])),
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    insertOne: vi.fn(async (doc) => {
      const insertedId = doc._id || new ObjectId();
      doc._id = insertedId;
      return { insertedId };
    }),
    ...overrides,
  };
}

function dbFor(templates) {
  return {
    collection: vi.fn((name) => (
      name === 'consentTemplates' || name === 'consent_templates' ? templates : collection()
    )),
  };
}

describe('consent v2 item 8 residual canonical branches', () => {
  it('reports permissionCode when a response is missing and key is absent', () => {
    expect(() => consentService.validateResponsesAgainstTemplate({
      permissions: [{ permissionCode: 'research-use', required: false }],
    }, {})).toThrow('research-use');
  });

  it('reports permissionCode when a required permission is denied and key is absent', () => {
    expect(() => consentService.validateResponsesAgainstTemplate({
      permissions: [{ permissionCode: 'research-use', required: true }],
    }, { 'research-use': false })).toThrow('research-use');
  });

  it('uses existing htmlContent as the content fallback while versioning a template', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Existing',
      content: '',
      htmlContent: '<p>Existing HTML</p>',
      version: 'v2',
      active: true,
      permissions: [],
    };
    const templates = collection({ findOne: vi.fn(async () => existing) });
    const result = await consentService.updateTemplate(dbFor(templates), String(existingId), { active: false });

    expect(result.content).toBe('<p>Existing HTML</p>');
    expect(result.htmlContent).toBe('<p>Existing HTML</p>');
    expect(result.version).toBe('v3');
  });

  it('uses existing content as the htmlContent fallback while versioning a template', async () => {
    const existingId = new ObjectId();
    const existing = {
      _id: existingId,
      title: 'Existing',
      content: 'Existing text',
      htmlContent: '',
      version: 'v1',
      active: true,
      permissions: [],
    };
    const templates = collection({ findOne: vi.fn(async () => existing) });
    const result = await consentService.updateTemplate(dbFor(templates), String(existingId), { active: false });

    expect(result.content).toBe('Existing text');
    expect(result.htmlContent).toBe('Existing text');
    expect(result.version).toBe('v2');
  });
});
