import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  RELEASE_COLLECTION,
  PROFILE_COLLECTION,
  validateMappingReleaseReferences,
  validateProfileReferences,
} = require('../../src/services/interoperabilityMappingRelease.service');

// RF011 AC2, RULE-035 (#1322): the existence checks the
// /api/interoperability-mapping-releases and /api/fhir-profiles mounts run
// after the model validates a payload.

// A db whose collections answer findOne from `stored`, keyed by collection
// name, matching every key of the filter.
function dbWith(stored = {}) {
  const findOne = vi.fn();
  const collection = vi.fn((name) => ({
    findOne: (filter) => {
      findOne(name, filter);
      const rows = stored[name] || [];
      return Promise.resolve(rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) || null);
    },
  }));
  return { collection, findOne };
}

const namespaces = (...ids) => ids.map((id) => ({ identifierNamespaceRegistryId: id }));
const releases = (...ids) => ids.map((id) => ({ interoperabilityMappingReleaseId: id }));

describe('interoperabilityMappingRelease.service', () => {
  it('names the two collections', () => {
    expect(RELEASE_COLLECTION).toBe('interoperabilityMappingReleases');
    expect(PROFILE_COLLECTION).toBe('fhirProfileRegistries');
  });

  describe('validateMappingReleaseReferences', () => {
    it('passes when every namespace and the superseded release are stored', async () => {
      const db = dbWith({
        identifierNamespaceRegistries: namespaces('ns-1', 'ns-2'),
        interoperabilityMappingReleases: releases('rel-0'),
      });

      await expect(validateMappingReleaseReferences(db, {
        identifierNamespaceRegistryIds: ['ns-1', 'ns-2'],
        supersedesReleaseId: 'rel-0',
      })).resolves.toBeUndefined();
      expect(db.findOne).toHaveBeenCalledWith('identifierNamespaceRegistries', { identifierNamespaceRegistryId: 'ns-2' });
      expect(db.findOne).toHaveBeenCalledWith('interoperabilityMappingReleases', { interoperabilityMappingReleaseId: 'rel-0' });
    });

    it('throws 404 for a namespace id that is not stored', async () => {
      const db = dbWith({ identifierNamespaceRegistries: namespaces('ns-1') });

      const error = await validateMappingReleaseReferences(db, { identifierNamespaceRegistryIds: ['ns-1', 'ns-9'] }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('identifierNamespaceRegistryIds ns-9 não encontrado');
    });

    it('throws 404 for a supersedesReleaseId that is not stored', async () => {
      const db = dbWith({ identifierNamespaceRegistries: namespaces('ns-1') });

      const error = await validateMappingReleaseReferences(db, {
        identifierNamespaceRegistryIds: ['ns-1'],
        supersedesReleaseId: 'rel-9',
      }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('supersedesReleaseId rel-9 não encontrado');
    });

    it('looks up no key the payload does not carry (a PUT update)', async () => {
      const db = dbWith();

      await expect(validateMappingReleaseReferences(db, { status: 'candidate', updatedAt: new Date() })).resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });

    it('skips a null supersedesReleaseId (no release superseded)', async () => {
      const db = dbWith();

      await expect(validateMappingReleaseReferences(db, { supersedesReleaseId: null })).resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });

    // The model does not type-check supersedesReleaseId, so the reference
    // check refuses a carried value that is not a non-empty string.
    it.each([
      ['a numeric supersedesReleaseId', 123],
      ['an array supersedesReleaseId', ['rel-0']],
      ['a blank supersedesReleaseId', ' '],
      ['an empty supersedesReleaseId', ''],
      ['an object supersedesReleaseId', { $ne: null }],
    ])('refuses %s with 422 before reading the store', async (_label, supersedesReleaseId) => {
      const db = dbWith({ interoperabilityMappingReleases: releases('rel-0') });

      const error = await validateMappingReleaseReferences(db, { supersedesReleaseId }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(422);
      expect(error.message).toBe('supersedesReleaseId deve ser um texto não vazio para InteroperabilityMappingRelease');
      expect(error.details).toEqual(['supersedesReleaseId deve ser um texto não vazio para InteroperabilityMappingRelease']);
      expect(db.findOne).not.toHaveBeenCalled();
    });

    it('does not resolve profileRegistryIds, canonicalModelReleaseId or terminologyReleaseIds', async () => {
      const db = dbWith();

      await expect(validateMappingReleaseReferences(db, {
        profileRegistryIds: ['prof-9'],
        canonicalModelReleaseId: 'cmr-9',
        terminologyReleaseIds: ['term-9'],
      })).resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-array identifierNamespaceRegistryIds', { identifierNamespaceRegistryIds: 'ns-9' }],
      ['non-string namespace entries', { identifierNamespaceRegistryIds: [7, null, { id: 'ns-9' }, '  '] }],
    ])('skips %s, never a throw', async (_label, payload) => {
      const db = dbWith();

      await expect(validateMappingReleaseReferences(db, payload)).resolves.toBeUndefined();
      expect(db.findOne).not.toHaveBeenCalled();
    });
  });

  describe('validateProfileReferences', () => {
    it('passes when the mapping release is stored', async () => {
      const db = dbWith({ interoperabilityMappingReleases: releases('rel-1') });

      await expect(validateProfileReferences(db, { mappingReleaseId: 'rel-1' })).resolves.toBeUndefined();
      expect(db.findOne).toHaveBeenCalledWith('interoperabilityMappingReleases', { interoperabilityMappingReleaseId: 'rel-1' });
    });

    it('throws 404 for a mappingReleaseId that is not stored', async () => {
      const db = dbWith({ interoperabilityMappingReleases: releases('rel-1') });

      const error = await validateProfileReferences(db, { mappingReleaseId: 'rel-9' }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('mappingReleaseId rel-9 não encontrado');
    });

    it('looks up nothing for a payload without mappingReleaseId (a PUT update)', async () => {
      const db = dbWith();

      await expect(validateProfileReferences(db, { status: 'active', updatedAt: new Date() })).resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });

    it.each([
      ['a numeric mappingReleaseId', 7],
      ['an array mappingReleaseId', ['rel-9']],
      ['a blank mappingReleaseId', '   '],
    ])('skips %s, never a throw', async (_label, mappingReleaseId) => {
      const db = dbWith();

      await expect(validateProfileReferences(db, { mappingReleaseId })).resolves.toBeUndefined();
      expect(db.findOne).not.toHaveBeenCalled();
    });
  });
});
