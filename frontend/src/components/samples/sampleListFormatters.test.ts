import { describe, expect, it } from 'vitest';
import { getStorageLabel, buildSprecSummary, buildSprecAxisSummary } from './sampleListFormatters';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';
import type { SampleStorageLocationDTO, SpecimenPreanalyticsProfile } from '../../types/models';

const t = (_key: string, fallback?: string) => fallback ?? _key;

function makeSample(overrides: Partial<SampleWithId> = {}): SampleWithId {
  return {
    id: 'sample-1',
    participantId: 'P1',
    sampleType: 'PLASMA',
    ...overrides,
  } as SampleWithId;
}

function makeLocation(overrides: Partial<SampleStorageLocationDTO> = {}): SampleStorageLocationDTO {
  return {
    specimenId: 'SPEC-1',
    box: { boxId: 'box-1', boxName: null, position: null },
    path: 'N/A',
    fullHierarchy: null,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<SpecimenPreanalyticsProfile> = {}): SpecimenPreanalyticsProfile {
  return {
    specimenId: 'SPEC-1',
    matrixType: 'fluid',
    ...overrides,
  };
}

// #517: SamplesPageView's list view reads these from the batched
// resolvedStorageLocation/currentSpecimenPreanalytics fields GET /samples
// now embeds, instead of the legacy sample.storageLocation/sample.sprec.
describe('getStorageLabel', () => {
  it('reports awaiting storage when no resolvedStorageLocation exists', () => {
    expect(getStorageLabel(makeSample(), t)).toBe('Aguardando Armazenagem');
  });

  it('reports awaiting storage when the resolved location has no box/path/position', () => {
    const sample = makeSample({ resolvedStorageLocation: makeLocation() });
    expect(getStorageLabel(sample, t)).toBe('Aguardando Armazenagem');
  });

  it('treats a resolver path of "N/A" as no path, not a literal label', () => {
    const sample = makeSample({
      resolvedStorageLocation: makeLocation({ box: { boxId: 'box-1', boxName: 'BOX_01', position: 'A1' } }),
    });
    expect(getStorageLabel(sample, t)).toBe('BOX_01 / Posição A1');
  });

  it('prefers the readable path over the box name when both are present', () => {
    const sample = makeSample({
      resolvedStorageLocation: makeLocation({
        path: 'FREEZER_01/SHELF_1/RACK_A/BOX_01',
        box: { boxId: 'box-1', boxName: 'BOX_01', position: 'A1' },
      }),
    });
    expect(getStorageLabel(sample, t)).toBe('FREEZER_01/SHELF_1/RACK_A/BOX_01 / Posição A1');
  });

  it('falls back to just the position when neither path nor box name is present', () => {
    const sample = makeSample({
      resolvedStorageLocation: makeLocation({ box: { boxId: 'box-1', boxName: null, position: 'A1' } }),
    });
    expect(getStorageLabel(sample, t)).toBe('Posição A1');
  });
});

describe('buildSprecSummary', () => {
  it('reports N/A when no currentSpecimenPreanalytics profile is resolved', () => {
    expect(buildSprecSummary(makeSample(), t)).toBe('SPREC: N/A');
  });

  it('prefers the profile\'s own sprecCode when present', () => {
    const sample = makeSample({ currentSpecimenPreanalytics: makeProfile({ sprecCode: 'A-B-C' }) });
    expect(buildSprecSummary(sample, t)).toBe('SPREC A-B-C');
  });

  it('builds a code from the generic axis fields for a fluid matrix profile', () => {
    const sample = makeSample({
      currentSpecimenPreanalytics: makeProfile({
        matrixType: 'fluid',
        sampleType: 'BLD',
        primaryContainer: 'PED',
        preCentrifugation: '30',
        centrifugation: '10',
      }),
    });
    expect(buildSprecSummary(sample, t)).toBe('SPREC BLD-PED-30-10');
  });

  it('builds a code from the solid-aliased canonical fields for a solid matrix profile', () => {
    const sample = makeSample({
      currentSpecimenPreanalytics: makeProfile({
        matrixType: 'solid',
        sampleType: 'TIS',
        warmIschemiaTime: '15',
        coldIschemiaTime: '45',
        fixationStabilizationType: 'FORMALIN',
      }),
    });
    expect(buildSprecSummary(sample, t)).toBe('SPREC TIS-15-45-FORMALIN');
  });

  it('reports N/A when the profile exists but has no code and no fields to derive one from', () => {
    const sample = makeSample({ currentSpecimenPreanalytics: makeProfile({ matrixType: 'fluid' }) });
    expect(buildSprecSummary(sample, t)).toBe('SPREC: N/A');
  });
});

// #518: SampleDetailsPage's per-axis breakdown, sibling to buildSprecSummary
// above — same currentSpecimenPreanalytics source, formatted as one
// `Label:value` pair per axis instead of a single dash-joined code.
describe('buildSprecAxisSummary', () => {
  it('reports N/A for every axis when no currentSpecimenPreanalytics profile is resolved', () => {
    expect(buildSprecAxisSummary(makeSample(), t)).toBe(
      'Ppre:N/A | Pcent1:N/A | Pcent2:N/A | Ppost:N/A | Pstore:N/A',
    );
  });

  it('reports the fluid axes from the generic axis fields', () => {
    const sample = makeSample({
      currentSpecimenPreanalytics: makeProfile({
        matrixType: 'fluid',
        preCentrifugation: '30',
        centrifugation: '10',
        secondCentrifugation: '5',
        postCentrifugationDelay: '20',
        longTermStorage: '-80C',
      }),
    });
    expect(buildSprecAxisSummary(sample, t)).toBe(
      'Ppre:30 | Pcent1:10 | Pcent2:5 | Ppost:20 | Pstore:-80C',
    );
  });

  it('reports the solid-aliased canonical axes for a solid matrix profile', () => {
    const sample = makeSample({
      currentSpecimenPreanalytics: makeProfile({
        matrixType: 'solid',
        warmIschemiaTime: '15',
        coldIschemiaTime: '45',
        fixationStabilizationType: 'FORMALIN',
        fixationTime: '24h',
        longTermStorage: '-80C',
      }),
    });
    expect(buildSprecAxisSummary(sample, t)).toBe(
      'Pwarm:15 | Pcold:45 | Pfix:FORMALIN | PfixTime:24h | Pstore:-80C',
    );
  });
});
