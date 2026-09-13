import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const { getManifest, getManifestByKey } = require('../../src/reference-data/essential/manifest');

describe('reference-data essential manifest', () => {
  describe('getManifest()', () => {
    it('returns the three known entries with expected keys', () => {
      const manifest = getManifest();
      expect(manifest).toHaveLength(3);
      expect(manifest.map((entry) => entry.key)).toEqual([
        'miabis-minimal',
        'sprec-minimal',
        'rcs-gov-1.0',
      ]);
    });

    it('returns entries with the expected shape and required=true', () => {
      const manifest = getManifest();
      manifest.forEach((entry) => {
        expect(entry.required).toBe(true);
        expect(typeof entry.system).toBe('string');
        expect(typeof entry.version).toBe('string');
        expect(typeof entry.source).toBe('string');
        expect(typeof entry.loader).toBe('string');
        expect(Array.isArray(entry.uniqueKeys)).toBe(true);
        expect(typeof entry.description).toBe('string');
      });
    });

    it('resolves source as an absolute path', () => {
      const manifest = getManifest();
      manifest.forEach((entry) => {
        expect(path.isAbsolute(entry.source)).toBe(true);
      });
    });

    it('returns shallow copies, not references to the frozen internal entries', () => {
      const manifest = getManifest();
      manifest[0].key = 'mutated';
      const manifestAgain = getManifest();
      expect(manifestAgain[0].key).toBe('miabis-minimal');
    });

    it('does not allow mutating the returned array to affect subsequent calls', () => {
      const manifest = getManifest();
      manifest.pop();
      const manifestAgain = getManifest();
      expect(manifestAgain).toHaveLength(3);
    });
  });

  describe('getManifestByKey()', () => {
    it('returns the matching entry for a known key', () => {
      const entry = getManifestByKey('sprec-minimal');
      expect(entry).not.toBeNull();
      expect(entry.system).toBe('SPREC');
      expect(entry.targetCollection).toBe('terminologies');
    });

    it('returns the miabis entry with its multiple target collections', () => {
      const entry = getManifestByKey('miabis-minimal');
      expect(entry.targetCollections).toEqual([
        'sampleTypes',
        'sampleOrigins',
        'extractionProtocols',
        'qualityDescriptions',
      ]);
    });

    it('returns the rcs-gov entry', () => {
      const entry = getManifestByKey('rcs-gov-1.0');
      expect(entry.uniqueKeys).toEqual(['key', 'version']);
    });

    it('returns null for an unknown key', () => {
      expect(getManifestByKey('does-not-exist')).toBeNull();
    });

    it('returns null for undefined/empty key input', () => {
      expect(getManifestByKey(undefined)).toBeNull();
      expect(getManifestByKey('')).toBeNull();
    });
  });
});
