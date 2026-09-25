import { describe, expect, it } from 'vitest';
import { buildInventoryFields, buildSections, type CatalogFilter } from './ReportQueryPage';

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
