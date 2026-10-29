import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  COLLECTION,
  loadConformanceRegistry,
  validateNamespaceReferences,
} = require('../../src/services/identifierNamespaceRegistry.service');
const baseRegistry = require('../../src/resources/fhir/conformance-registry');
const fhirValidator = require('../../src/services/fhir-validator.service');
const logger = require('../../src/utils/logger');

// RF011 AC2/AC3, RNF024 C1/C2, RULE-036 (#1322): the stored
// IdentifierNamespaceRegistry and FHIRProfileRegistry rows the FHIR
// validator's identifier.system and meta.profile checks read.
const SYSTEM_URI = 'https://id.bioadvanced.dev/ns/specimen';
const PROFILE_URL = 'https://id.bioadvanced.dev/fhir/StructureDefinition/patient';
// The FHIRProfileRegistry collection the loader reads (/api/fhir-profiles).
const PROFILE_COLLECTION = 'fhirProfileRegistries';

const namespaceRow = (overrides = {}) => ({
  identifierNamespaceRegistryId: 'ns-1',
  namespaceKey: 'specimen',
  systemUri: SYSTEM_URI,
  authorityDomain: 'bioadvanced.dev',
  targetTypes: ['specimen'],
  semanticVersion: '1.0.0',
  status: 'active',
  effectivePeriod: { start: '2026-01-01' },
  configurationReleaseId: 'cfg-2026-10',
  ...overrides,
});

const profileRow = (overrides = {}) => ({
  fhirProfileRegistryId: 'prof-1',
  canonicalUrl: PROFILE_URL,
  fhirVersion: '4.0.1',
  profileVersion: '1.0.0',
  mappingReleaseId: 'rel-1',
  status: 'active',
  ...overrides,
});

const patient = {
  resourceType: 'Patient',
  name: [{ family: 'Silva', given: ['Ana'] }],
  gender: 'female',
  birthDate: '1990-01-01',
  identifier: [{ system: SYSTEM_URI, value: 'S-0001' }],
};

// A db whose namespace collection answers `rows` to every find, and records
// the filter. The profile collection answers `profiles`, or nothing stored;
// either may be an Error, which its find throws.
function dbWith(rows, profiles = []) {
  const answer = (value) => vi.fn(() => {
    if (value instanceof Error) throw value;
    return { toArray: vi.fn().mockResolvedValue(value) };
  });
  const find = answer(rows);
  const findProfiles = answer(profiles);
  return {
    collection: vi.fn((name) => ({ find: name === PROFILE_COLLECTION ? findProfiles : find })),
    find,
    findProfiles,
  };
}

const reasonsFor = (registry) => fhirValidator.validatePayload(patient, undefined, { registry }).issues.map((issue) => issue.reason);

describe('identifierNamespaceRegistry.service', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConformanceRegistry', () => {
    it('appends the stored rows to the base namespaces, keeping its profiles and approved authorities', async () => {
      const row = namespaceRow();
      const db = dbWith([row]);
      const base = { profiles: ['p'], namespaces: ['base-ns'], approvedAuthorities: ['gs1.org'] };

      const registry = await loadConformanceRegistry(db, { base });

      expect(db.collection).toHaveBeenCalledWith(COLLECTION);
      expect(COLLECTION).toBe('identifierNamespaceRegistries');
      expect(db.find).toHaveBeenCalledWith({});
      expect(registry).toEqual({ profiles: ['p'], namespaces: ['base-ns', row], approvedAuthorities: ['gs1.org'] });
    });

    it('appends the stored profile rows to the base profiles', async () => {
      const row = namespaceRow();
      const profile = profileRow();
      const db = dbWith([row], [profile]);
      const base = { profiles: ['p'], namespaces: ['base-ns'], approvedAuthorities: ['gs1.org'] };

      const registry = await loadConformanceRegistry(db, { base });

      expect(db.collection).toHaveBeenCalledWith(PROFILE_COLLECTION);
      expect(db.findProfiles).toHaveBeenCalledWith({});
      expect(registry).toEqual({ profiles: ['p', profile], namespaces: ['base-ns', row], approvedAuthorities: ['gs1.org'] });
    });

    it('keeps the stored namespaces and the base profiles when the profile read throws', async () => {
      const row = namespaceRow();
      const base = { profiles: ['p'], namespaces: ['base-ns'], approvedAuthorities: [] };

      const registry = await loadConformanceRegistry(dbWith([row], new Error('mongo down')), { base });

      expect(registry).toEqual({ profiles: ['p'], namespaces: ['base-ns', row], approvedAuthorities: [] });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps the stored namespaces and the base profiles when the profile read answers a non-array', async () => {
      const row = namespaceRow();
      const base = { profiles: ['p'], namespaces: ['base-ns'], approvedAuthorities: [] };

      const registry = await loadConformanceRegistry(dbWith([row], null), { base });

      expect(registry).toEqual({ profiles: ['p'], namespaces: ['base-ns', row], approvedAuthorities: [] });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps the stored profiles and the base namespaces when the namespace read throws', async () => {
      const profile = profileRow();
      const base = { profiles: ['p'], namespaces: ['base-ns'], approvedAuthorities: [] };

      const registry = await loadConformanceRegistry(dbWith(new Error('mongo down'), [profile]), { base });

      expect(registry).toEqual({ profiles: ['p', profile], namespaces: ['base-ns'], approvedAuthorities: [] });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns the base registry with no db, or a db without collection', async () => {
      expect(await loadConformanceRegistry(undefined)).toBe(baseRegistry);
      expect(await loadConformanceRegistry({})).toBe(baseRegistry);
    });

    it('returns the base registry and warns when both reads throw', async () => {
      const db = { collection: vi.fn(() => ({ find: vi.fn(() => { throw new Error('mongo down'); }) })) };

      expect(await loadConformanceRegistry(db)).toBe(baseRegistry);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns the base registry when both reads answer a non-array', async () => {
      expect(await loadConformanceRegistry(dbWith(null, null))).toBe(baseRegistry);
    });

    it('returns the base registry when the collection has no find', async () => {
      expect(await loadConformanceRegistry({ collection: vi.fn(() => ({})) })).toBe(baseRegistry);
    });
  });

  describe('the validator reading the loaded registry', () => {
    it('refuses the identifier.system with an empty store', async () => {
      expect(reasonsFor(await loadConformanceRegistry(dbWith([])))).toEqual(['identifier-system-unknown']);
    });

    it('accepts the identifier.system when the store holds a valid row in force', async () => {
      const result = fhirValidator.validatePayload(patient, undefined, { registry: await loadConformanceRegistry(dbWith([namespaceRow()])) });

      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('keeps the refusal for a stored http:// row (RULE-036)', async () => {
      const registry = await loadConformanceRegistry(dbWith([namespaceRow({ systemUri: 'http://id.bioadvanced.dev/ns/specimen' })]));
      const httpPatient = { ...patient, identifier: [{ system: 'http://id.bioadvanced.dev/ns/specimen', value: 'S-0001' }] };

      const reasons = fhirValidator.validatePayload(httpPatient, undefined, { registry }).issues.map((issue) => issue.reason);
      expect(reasons).toEqual(['identifier-system-unknown']);
    });

    it('accepts a meta.profile an active stored profile row names, which the base alone refuses', async () => {
      const profiled = { ...patient, meta: { profile: [`${PROFILE_URL}|1.0.0`] } };
      const reasons = (registry) => fhirValidator.validatePayload(profiled, undefined, { registry }).issues.map((issue) => issue.reason);

      expect(reasons(baseRegistry)).toContain('profile-not-registered');
      const result = fhirValidator.validatePayload(profiled, undefined, {
        registry: await loadConformanceRegistry(dbWith([namespaceRow()], [profileRow()])),
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('keeps the refusal for a stored row whose period has ended', async () => {
      const expired = namespaceRow({ effectivePeriod: { start: '2025-01-01', end: '2025-06-01' } });

      expect(reasonsFor(await loadConformanceRegistry(dbWith([expired])))).toEqual(['identifier-system-unknown']);
    });
  });

  describe('validateNamespaceReferences (RULE-036, stable URI)', () => {
    it('throws 409 when the key is stored with a different systemUri', async () => {
      const db = dbWith([namespaceRow({ systemUri: 'https://id.bioadvanced.dev/ns/other' })]);

      const error = await validateNamespaceReferences(db, namespaceRow({ semanticVersion: '1.1.0' })).catch((e) => e);

      expect(db.find).toHaveBeenCalledWith({ namespaceKey: 'specimen' });
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('systemUri do namespace specimen não pode mudar entre versões (RULE-036)');
    });

    it('passes when the key is stored with the same systemUri (a new version)', async () => {
      const db = dbWith([namespaceRow()]);

      await expect(validateNamespaceReferences(db, namespaceRow({ semanticVersion: '1.1.0' }))).resolves.toBeUndefined();
    });

    it.each([
      ['an array systemUri', { systemUri: ['https://id.bioadvanced.dev/ns/other'] }, 'systemUri'],
      ['a numeric namespaceKey', { namespaceKey: 7 }, 'namespaceKey'],
    ])('refuses %s with 422 before reading the store', async (_label, change, field) => {
      const db = dbWith([namespaceRow()]);

      const error = await validateNamespaceReferences(db, namespaceRow(change)).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(422);
      expect(error.message).toBe(`${field} deve ser um texto não vazio para IdentifierNamespaceRegistry (RULE-036)`);
      expect(db.collection).not.toHaveBeenCalled();
    });

    it('does nothing for a payload without namespaceKey (a PUT update)', async () => {
      const db = dbWith([namespaceRow({ systemUri: 'https://id.bioadvanced.dev/ns/other' })]);

      await expect(validateNamespaceReferences(db, { semanticVersion: '1.1.0', updatedAt: new Date() })).resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });
  });
});
