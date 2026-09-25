import { describe, expect, it } from 'vitest';
import { buildInventoryFields, buildQualityFields, buildSections, resolveSectionKey, type CatalogFilter } from './ReportQueryPage';
import { SPREC_FLUID_DICTIONARY } from '../constants/sprecDictionary';

// The shape GET /reports/samples/filters answers (reports.routes.js
// SAMPLE_QUERY_FILTERS), trimmed to the entries these cases read plus two
// the inventory section must NOT pick up.
const SAMPLE_CATALOG: CatalogFilter[] = [
  { name: 'startDate', label: 'Data inicial', type: 'date' },
  { name: 'endDate', label: 'Data final', type: 'date' },
  { name: 'collectionId', label: 'Coleção', type: 'text' },
  { name: 'sampleType', label: 'Tipo de amostra', type: 'select', options: ['PLASMA', 'SERUM'] },
  { name: 'sampleOrigin', label: 'Origem', type: 'select', options: ['VENOUS_BLOOD'] },
  { name: 'status', label: 'Estado', type: 'select', options: ['AVAILABLE', 'QUARANTINE', 'BLOCKED'] },
  { name: 'storageBoxId', label: 'Caixa de armazenamento', type: 'text' },
  { name: 'storagePosition', label: 'Posição na caixa', type: 'text' },
  { name: 'sprecSampleType', label: 'SPREC — tipo de amostra', type: 'text' },
];

const TEMPERATURE_CATALOG: CatalogFilter[] = [
  { name: 'startDate', label: 'Data inicial', type: 'date' },
  { name: 'endDate', label: 'Data final', type: 'date' },
  { name: 'criticalAlertsOnly', label: 'Somente alertas críticos', type: 'checkbox' },
];

// #748 (RF008 AC#1): #739 wired period, collection, type, origin and
// location into the backend's sample query, and #732 publishes them per
// report type. ReportQueryPage rendered none of them.
describe('buildInventoryFields', () => {
  it('#748: renders the AC#1 dimensions the catalog lists, in AC#1 order', () => {
    const fields = buildInventoryFields(SAMPLE_CATALOG, new Set());

    expect(fields.map((field) => field.name)).toEqual([
      'startDate', 'endDate', 'collectionId', 'sampleType', 'sampleOrigin', 'storageBoxId', 'storagePosition',
    ]);
    expect(fields.map((field) => field.kind)).toEqual(['date', 'date', 'text', 'select', 'select', 'text', 'text']);
  });

  it('#748: labels the MIABIS options from the specimen vocabulary, sending the ID', () => {
    const fields = buildInventoryFields(SAMPLE_CATALOG, new Set());
    const sampleType = fields.find((field) => field.name === 'sampleType');

    expect(sampleType).toMatchObject({
      kind: 'select',
      options: [
        { value: 'PLASMA', label: 'Plasma' },
        { value: 'SERUM', label: 'Soro' },
      ],
    });
  });

  it('#748: an option outside the known vocabulary still renders, labelled by its ID', () => {
    const fields = buildInventoryFields(
      [{ name: 'sampleOrigin', label: 'Origem', type: 'select', options: ['NEW_ORIGIN'] }],
      new Set()
    );

    expect(fields[0]).toMatchObject({ options: [{ value: 'NEW_ORIGIN', label: 'NEW_ORIGIN' }] });
  });

  it('skips a dimension another section already renders', () => {
    const fields = buildInventoryFields(TEMPERATURE_CATALOG, new Set(['startDate', 'endDate', 'criticalAlertsOnly']));

    expect(fields).toEqual([]);
  });

  it('CONTROL: an empty catalog yields no fields', () => {
    expect(buildInventoryFields([], new Set())).toEqual([]);
  });
});

describe('buildSections', () => {
  it('#748: a samples report gets an inventory section built from its catalog', () => {
    const sections = buildSections('samples', [], SAMPLE_CATALOG);
    const inventory = sections.find((section) => section.id === 'inventory');

    expect(inventory?.fields.map((field) => field.name)).toContain('collectionId');
  });

  it('#748: the temperature report gets no inventory section -- monitoring already renders its dates', () => {
    const sections = buildSections('temperature', [], TEMPERATURE_CATALOG);

    expect(sections.map((section) => section.id)).toEqual(['monitoring']);
  });

  it('CONTROL: with no catalog the sections are the pre-#748 ones', () => {
    expect(buildSections('samples', []).map((section) => section.id)).toEqual(['quality']);
    expect(buildSections('patients', []).map((section) => section.id)).toEqual(['clinical']);
  });
});

// #1214: the page chose its sections from hardcoded key sets, so four report
// types offered clinical and SPREC filters their handlers never read, and the
// grade select sent `final_grade`, a key the backend has never read (it reads
// qualityCategory). With the type's catalog loaded, a field renders only when
// the catalog lists it.
describe('#1214: sections render only the filters the catalog lists for the type', () => {
  const QUALITY_FIELDS = buildQualityFields(SPREC_FLUID_DICTIONARY);
  const WITHDRAWAL_CATALOG: CatalogFilter[] = [
    { name: 'startDate', label: 'Data inicial', type: 'date' },
    { name: 'endDate', label: 'Data final', type: 'date' },
  ];
  const FULL_SAMPLE_CATALOG: CatalogFilter[] = [
    ...SAMPLE_CATALOG,
    { name: 'sprecMatrixType', type: 'text' },
    { name: 'sprecPrimaryContainer', type: 'text' },
    { name: 'sprecPreCentrifugation', type: 'text' },
    { name: 'sprecCentrifugation', type: 'text' },
    { name: 'sprecSecondCentrifugation', type: 'text' },
    { name: 'sprecPostCentrifugationDelay', type: 'text' },
    { name: 'sprecLongTermStorage', type: 'text' },
    { name: 'qualityCategory', type: 'text' },
    { name: 'orphaCode', type: 'text' },
    { name: 'atcCode', type: 'text' },
    { name: 'treatmentStatus', type: 'select', options: ['NAIVE'] },
  ];

  it('#1214: the grade select sends qualityCategory, the key the backend reads', () => {
    const names = QUALITY_FIELDS.map((field) => field.name);
    expect(names).toContain('qualityCategory');
    expect(names).not.toContain('final_grade');
  });

  it('#1214: results, whose catalog is empty, gets no clinical section', () => {
    expect(buildSections('results', QUALITY_FIELDS, [])).toEqual([]);
  });

  it('#1214: sampleAnalysis, whose catalog is empty, gets neither clinical nor quality', () => {
    expect(buildSections('sampleAnalysis', QUALITY_FIELDS, [])).toEqual([]);
  });

  it('#1214: withdrawalHistory gets only its period, and no SPREC section', () => {
    const sections = buildSections('withdrawalHistory', QUALITY_FIELDS, WITHDRAWAL_CATALOG);
    expect(sections.map((section) => section.id)).toEqual(['inventory']);
    expect(sections[0].fields.map((field) => field.name)).toEqual(['startDate', 'endDate']);
  });

  it('#1214: tissueOriginHistory, whose catalog is empty, gets no quality section', () => {
    expect(buildSections('tissueOriginHistory', QUALITY_FIELDS, [])).toEqual([]);
  });

  it('#1214: samples keeps every quality field its catalog lists, grade included', () => {
    const quality = buildSections('samples', QUALITY_FIELDS, FULL_SAMPLE_CATALOG).find((section) => section.id === 'quality');
    expect(quality?.fields.map((field) => field.name)).toEqual(
      QUALITY_FIELDS.map((field) => field.name).filter((name) => FULL_SAMPLE_CATALOG.some((entry) => entry.name === name))
    );
    expect(quality?.fields.length).toBeGreaterThanOrEqual(9);
  });

  it('CONTROL: an unknown catalog (null, fetch pending or failed) renders the key-set sections unfiltered', () => {
    expect(buildSections('results', QUALITY_FIELDS, null).map((section) => section.id)).toEqual(['clinical']);
  });
});

// #735: a custom template (RF008 AC#6) has no REPORT_TYPE_DEFINITIONS entry,
// so its code matched none of the key sets and its handler's clinical,
// quality or monitoring filters never rendered. The catalog response names
// the handler; the page groups sections as that handler's system type.
describe('#735: resolveSectionKey', () => {
  it('a custom template over the sample handler groups as samples', () => {
    expect(resolveSectionKey('inventario_mensal', false, 'sample')).toBe('samples');
  });

  it('maps every handler whose system type differs by name', () => {
    expect(resolveSectionKey('x', false, 'patient')).toBe('patients');
    expect(resolveSectionKey('x', false, 'sensor')).toBe('sensors');
    expect(resolveSectionKey('x', false, 'result')).toBe('results');
    expect(resolveSectionKey('x', false, 'auditEvents')).toBe('audit');
  });

  it('a custom template over the sample handler renders the quality section its catalog lists', () => {
    const qualityFields = buildQualityFields(SPREC_FLUID_DICTIONARY);
    const sections = buildSections(resolveSectionKey('inventario_mensal', false, 'sample'), qualityFields, SAMPLE_CATALOG);

    expect(sections.map((section) => section.id)).toContain('quality');
  });

  it('CONTROL: a known type keeps its own key whatever the handler', () => {
    expect(resolveSectionKey('temperatureControl', true, 'temperature')).toBe('temperatureControl');
  });

  it('CONTROL: an unknown handler, or none yet, keeps the key', () => {
    expect(resolveSectionKey('inventario_mensal', false, null)).toBe('inventario_mensal');
    expect(resolveSectionKey('inventario_mensal', false, 'noSuchHandler')).toBe('inventario_mensal');
  });
});
