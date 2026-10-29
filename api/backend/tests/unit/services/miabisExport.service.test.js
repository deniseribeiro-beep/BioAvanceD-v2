import { describe, it, expect } from 'vitest';

const { buildMiabisExport, BIOBANK_MAPPING, COLLECTION_MAPPING } = require('../../../src/services/miabisExport.service');

// RF020 AC5-AC8 (#1322), MAP-V2-010/011: the MIABIS export of Biobank and
// Collection, its national extensions and its round-trip loss report.

const fullBiobank = {
  biobankId: 'bb-1',
  acronym: 'BBS',
  biobankName: 'Biobanco Sintético',
  biobankDescription: 'Biobanco de teste',
  url: 'https://example.org/bb-1',
  legalEntityId: 'org-1',
  countryCode: 'BR',
  contactInformation: { email: 'contato@example.org' },
  infrastructuralCapabilities: ['storage'],
  organisationalCapabilities: ['governance'],
  bioprocessingAnalyticalCapabilities: ['dna-extraction'],
  qualityManagementStandards: [{ code: 'ISO-20387' }],
};

describe('buildMiabisExport', () => {
  it('maps each Biobank table element from its canonical field', () => {
    const out = buildMiabisExport({ biobanks: [fullBiobank], collections: [] });

    expect(out.biobanks).toHaveLength(1);
    const { miabis } = out.biobanks[0];
    expect(Object.keys(miabis)).toEqual(BIOBANK_MAPPING.map(([element]) => element));
    for (const [element, field] of BIOBANK_MAPPING) {
      expect(miabis[element]).toEqual(fullBiobank[field]);
    }
    expect(miabis.juristicPerson).toBe('org-1');
    expect(miabis.country).toBe('BR');
    expect(out.biobanks[0].nationalExtensions).toEqual({});
  });

  it('lists a biobank status and an ELM capability pair entry as dropped, with entity and id', () => {
    const out = buildMiabisExport({
      biobanks: [{
        biobankId: 'bb-2',
        biobankName: 'Biobanco',
        countryCode: 'BR',
        biobankStatus: 'active',
        infrastructureCapabilities: [{ code: 'x' }],
      }],
    });

    expect(out.roundTripLoss.dropped).toEqual([
      { entity: 'Biobank', id: 'bb-2', field: 'biobankStatus' },
      { entity: 'Biobank', id: 'bb-2', field: 'infrastructureCapabilities' },
    ]);
    expect(out.roundTripLoss.droppedFieldCount).toBe(out.roundTripLoss.dropped.length);
  });

  it('carries governanceRegime and governanceContext as national extensions, outside the MIABIS record and the loss', () => {
    const governanceContext = { caae: '00000000.0.0000.0000', ethicsApprovalId: 'ap-1' };
    const out = buildMiabisExport({
      collections: [{ collectionId: 'col-1', collectionName: 'Coleção', governanceRegime: 'biorepository', governanceContext }],
    });

    const [record] = out.collections;
    expect(record.nationalExtensions).toEqual({ governanceRegime: 'biorepository', governanceContext });
    expect(Object.keys(record.miabis)).not.toContain('governanceRegime');
    expect(Object.keys(record.miabis)).not.toContain('governanceContext');
    expect(out.roundTripLoss.dropped.map(({ field }) => field)).not.toContain('governanceRegime');
    expect(out.roundTripLoss.dropped.map(({ field }) => field)).not.toContain('governanceContext');
  });

  it('drops unmapped collection fields that have values, and not those that are empty', () => {
    const out = buildMiabisExport({
      collections: [{
        collectionId: 'col-2',
        collectionStatus: 'active',
        sampleCount: 12,
        emptyNull: null,
        emptyString: '',
        blankString: '  ',
        emptyList: [],
      }],
    });

    expect(out.roundTripLoss.dropped).toEqual([
      { entity: 'Collection', id: 'col-2', field: 'collectionStatus' },
      { entity: 'Collection', id: 'col-2', field: 'sampleCount' },
    ]);
    expect(out.roundTripLoss.droppedFieldCount).toBe(2);
  });

  it('neither exports nor drops _id, createdAt and updatedAt', () => {
    const out = buildMiabisExport({
      collections: [{ _id: 'abc', collectionId: 'col-3', createdAt: new Date(), updatedAt: new Date() }],
    });

    const [record] = out.collections;
    for (const field of ['_id', 'createdAt', 'updatedAt']) {
      expect(Object.keys(record.miabis)).not.toContain(field);
      expect(Object.keys(record.nationalExtensions)).not.toContain(field);
    }
    expect(out.roundTripLoss.dropped).toEqual([]);
  });

  it('gives null for a mapped field absent from the record', () => {
    const out = buildMiabisExport({ collections: [{ collectionId: 'col-4' }] });

    const { miabis } = out.collections[0];
    expect(Object.keys(miabis)).toEqual(COLLECTION_MAPPING.map(([element]) => element));
    expect(miabis.id).toBe('col-4');
    expect(miabis.name).toBeNull();
    expect(miabis.materialTypes).toBeNull();
  });

  it('sorts the records by id', () => {
    const out = buildMiabisExport({
      biobanks: [{ biobankId: 'bb-b' }, { biobankId: 'bb-a' }],
      collections: [{ collectionId: 'col-z' }, { collectionId: 'col-y' }],
    });

    expect(out.biobanks.map(({ miabis }) => miabis.id)).toEqual(['bb-a', 'bb-b']);
    expect(out.collections.map(({ miabis }) => miabis.id)).toEqual(['col-y', 'col-z']);
  });

  it('leaves its input unchanged', () => {
    const input = {
      biobanks: [{ ...fullBiobank, biobankStatus: 'active' }],
      collections: [{ collectionId: 'col-5', governanceRegime: 'biobank', governanceContext: { custodianId: 'c-1' }, sampleCount: 3 }],
      generatedAt: '2026-10-23T00:00:00.000Z',
    };
    const before = structuredClone(input);

    buildMiabisExport(input);

    expect(input).toEqual(before);
  });

  it('treats inputs that are not arrays as empty', () => {
    const out = buildMiabisExport({});

    expect(out.biobanks).toEqual([]);
    expect(out.collections).toEqual([]);
    expect(out.roundTripLoss).toEqual({ droppedFieldCount: 0, dropped: [] });
  });

  it('names no mapping release and claims no conformance', () => {
    const out = buildMiabisExport({ generatedAt: '2026-10-23T00:00:00.000Z' });

    expect(out.mappingReleaseId).toBeNull();
    expect(out.conformanceClaimed).toBe(false);
    expect(out.generatedAt).toBe('2026-10-23T00:00:00.000Z');
    expect(out.mappings.map(({ mappingId, status }) => [mappingId, status])).toEqual([
      ['MAP-V2-010', 'prepared Phase 1'],
      ['MAP-V2-011', 'prepared Phase 1'],
    ]);
  });
});
