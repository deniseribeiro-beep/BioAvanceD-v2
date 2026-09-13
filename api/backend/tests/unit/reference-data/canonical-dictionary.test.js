import { describe, it, expect } from 'vitest';
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary');

describe('canonical dictionary v2.0.0 approved contract', () => {
  it('loads all 1,644 canonical elements', async () => {
    const catalog = await canonicalDictionary.loadCanonicalDictionary();
    expect(catalog).toHaveLength(1644);
    expect(catalog.filter((el) => el.elementId.startsWith('ELM-'))).toHaveLength(423);
    expect(catalog.filter((el) => el.elementId.startsWith('P1X-'))).toHaveLength(506);
    expect(catalog.filter((el) => el.elementId.startsWith('V2E-'))).toHaveLength(715);
    expect(new Set(catalog.map((el) => el.entity)).size).toBe(146);
  });

  it('preserves the executable metadata required to reconcile the backend', async () => {
    const catalog = await canonicalDictionary.loadCanonicalDictionary();
    for (const element of catalog) {
      expect(element.elementId).toMatch(/^(ELM|P1X|V2E)-\d{4}$/);
      expect(element.entity).toBeTruthy();
      expect(element.canonicalField).toBeTruthy();
      expect(element.dataType).toBeTruthy();
      expect(element.cardinality).toBeTruthy();
      expect(element.requirement).toBeTruthy();
      expect(element.authoritativePersistence).toBeTruthy();
      expect(element.preparationPhase).toBe('Phase 1');
      expect(element.populationPhase).toBeTruthy();
      expect(element.changeStatus).toBeTruthy();
    }
  });

  it('has no duplicate element IDs', async () => {
    const catalog = await canonicalDictionary.loadCanonicalDictionary();
    const ids = catalog.map((el) => el.elementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loads the normalized physical custody chain from the approved model', async () => {
    const specimenContainer = await canonicalDictionary.getElementById('V2E-0677');
    const containerPosition = await canonicalDictionary.getElementById('V2E-0670');
    const rackLocation = await canonicalDictionary.getElementById('V2E-0684');

    expect(specimenContainer).toMatchObject({ entity: 'SpecimenContainerAssignment', canonicalField: 'specimenContainerAssignmentId' });
    expect(containerPosition).toMatchObject({ entity: 'ContainerPositionAssignment', canonicalField: 'containerPositionAssignmentId' });
    expect(rackLocation).toMatchObject({ entity: 'RackLocationAssignment', canonicalField: 'rackLocationAssignmentId' });
  });

  it('returns null for an unknown element id', async () => {
    expect(await canonicalDictionary.getElementById('V2E-9999')).toBeNull();
  });

  it('computes a stable sha256 checksum over the approved catalog content', async () => {
    const first = await canonicalDictionary.dictionaryChecksum();
    const second = await canonicalDictionary.dictionaryChecksum();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it('reports the complete v2 accounting as verified', async () => {
    const completeness = await canonicalDictionary.checkCompleteness();
    expect(completeness).toMatchObject({
      dictionaryVersion: '2.0.0',
      expectedTotal: 1644,
      loadedTotal: 1644,
      uniqueTotal: 1644,
      expectedHistoricalTotal: 929,
      historicalTotal: 929,
      expectedNewTotal: 715,
      newTotal: 715,
      expectedEntityTotal: 146,
      entityTotal: 146,
      duplicateIds: [],
      missingRequiredFieldIds: [],
      nonPhaseOneIds: [],
      verified: true,
    });
  });
});
