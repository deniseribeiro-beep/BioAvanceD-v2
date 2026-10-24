// RF011 AC6, RNF024 C6 (#1322): FHIR staging names the elements no
// normalized field carries, as paths only, and the resources no record
// attaches.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  MAX_UNMAPPED_PATHS,
  buildRecordRoundTripLoss,
  buildBundleRoundTripLoss,
  ROUND_TRIP_LIMITATIONS,
} = require('../../src/resources/fhir/round-trip-loss');

function paths(loss, source) {
  return loss.unmapped.filter((item) => item.source === source).map((item) => item.path);
}

function fixture() {
  const patient = {
    resourceType: 'Patient',
    id: 'P-RT',
    name: [
      { text: 'Maria Round Trip', given: ['Maria'], family: 'Trip' },
      { family: 'Apelido Secundario' },
    ],
    identifier: [{ system: 'urn:oid:cpf', value: '123.456.789-00' }],
    telecom: [
      { system: 'email', value: 'maria.rt@example.org' },
      { system: 'fax', value: '+55 11 0000-0000' },
    ],
    birthDate: '1980-01-01',
    gender: 'female',
  };
  const specimen = {
    resourceType: 'Specimen',
    id: 'S-RT',
    identifier: [{ value: 'S-RT-ID' }],
    subject: { reference: 'Patient/P-RT' },
    type: { text: 'SANGUE' },
    collection: { collectedDateTime: '2026-01-01T10:00:00Z', quantity: { value: 5 } },
    extension: [
      { url: 'https://example.org/fhir/matrix-rt-primeira', valueString: 'plasma' },
      { url: 'https://example.org/fhir/matrix-rt-segunda', valueString: 'soro' },
    ],
  };
  const consent = { resourceType: 'Consent', status: 'active', patient: { reference: 'Patient/P-RT' }, scope: { text: 'pesquisa' } };
  const condition = {
    resourceType: 'Condition',
    subject: { reference: 'Patient/P-RT' },
    code: {
      text: 'Doença rara',
      coding: [
        { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E75', display: 'CID' },
        { system: 'http://snomed.info/sct', code: '1234' },
      ],
    },
  };
  const observation = {
    resourceType: 'Observation',
    subject: { reference: 'Patient/P-RT' },
    code: { coding: [{ system: 'http://loinc.org', code: '2345-7', display: 'Glicose' }] },
    valueQuantity: { value: 90, unit: 'mg/dL', system: 'http://unitsofmeasure.org' },
  };
  return { patient, specimen, consents: [consent], conditions: [condition], observations: [observation] };
}

describe('buildRecordRoundTripLoss (RF011 AC6, RNF024 C6, #1322)', () => {
  it('reports a second Patient.name and the identifier system, not the mapped name, CPF value or email', () => {
    const loss = buildRecordRoundTripLoss(fixture());
    const patient = paths(loss, 'patient');
    expect(patient).toContain('Patient.name[1].family');
    expect(patient).toContain('Patient.identifier[0].system');
    expect(patient).toContain('Patient.telecom[1].system');
    expect(patient).toContain('Patient.telecom[1].value');
    expect(patient).not.toContain('Patient.name[0].family');
    expect(patient).not.toContain('Patient.name[0].given[0]');
    expect(patient).not.toContain('Patient.identifier[0].value');
    expect(patient).not.toContain('Patient.telecom[0].value');
    expect(patient).not.toContain('Patient.id');
    expect(patient).not.toContain('Patient.resourceType');
  });

  it('reports a Specimen collection quantity and a second matrix extension, not the first one or the collection date', () => {
    const loss = buildRecordRoundTripLoss(fixture());
    const specimen = paths(loss, 'specimen');
    expect(specimen).toContain('Specimen.collection.quantity.value');
    expect(specimen).toContain('Specimen.extension[1].url');
    expect(specimen).toContain('Specimen.extension[1].valueString');
    expect(specimen).not.toContain('Specimen.extension[0].url');
    expect(specimen).not.toContain('Specimen.extension[0].valueString');
    expect(specimen).not.toContain('Specimen.collection.collectedDateTime');
    expect(specimen).not.toContain('Specimen.type.text');
  });

  it('reports Specimen.identifier[0].value when the Specimen id is set, and not when it is blank', () => {
    const withId = buildRecordRoundTripLoss(fixture());
    expect(paths(withId, 'specimen')).toContain('Specimen.identifier[0].value');

    const blank = fixture();
    blank.specimen.id = '';
    const withoutId = buildRecordRoundTripLoss(blank);
    expect(paths(withoutId, 'specimen')).not.toContain('Specimen.identifier[0].value');
  });

  it('reports an unread Consent element, not its status or patient reference', () => {
    const consent = paths(buildRecordRoundTripLoss(fixture()), 'consents[0]');
    expect(consent).toEqual(['Consent.scope.text']);
  });

  it('reports a Condition coding matching no term group and the CID system, not the CID code or display', () => {
    const condition = paths(buildRecordRoundTripLoss(fixture()), 'conditions[0]');
    expect(condition).toEqual([
      'Condition.code.coding[0].system',
      'Condition.code.coding[1].code',
      'Condition.code.coding[1].system',
    ]);
  });

  it('reports Observation.valueQuantity.system, not the biomarker value or unit', () => {
    const observation = paths(buildRecordRoundTripLoss(fixture()), 'observations[0]');
    expect(observation).toContain('Observation.valueQuantity.system');
    expect(observation).toContain('Observation.code.coding[0].system');
    expect(observation).not.toContain('Observation.valueQuantity.value');
    expect(observation).not.toContain('Observation.valueQuantity.unit');
    expect(observation).not.toContain('Observation.code.coding[0].code');
  });

  it('on an HPO observation keeps only the HPO coding and reports valueQuantity.value', () => {
    const record = fixture();
    record.observations = [{
      resourceType: 'Observation',
      subject: { reference: 'Patient/P-RT' },
      code: { coding: [{ system: 'http://human-phenotype-ontology.org', code: 'HP:0001250', display: 'Seizure' }] },
      valueQuantity: { value: 3 },
    }];
    const observation = paths(buildRecordRoundTripLoss(record), 'observations[0]');
    expect(observation).toEqual(['Observation.code.coding[0].system', 'Observation.valueQuantity.value']);
  });

  it('reads the Specimen identifier as extractIdentifier does: a null first element falls through to the first non-blank one', () => {
    const record = fixture();
    record.specimen = { resourceType: 'Specimen', identifier: [null, { system: 'urn:s', value: 'S1' }] };
    const specimen = paths(buildRecordRoundTripLoss(record), 'specimen');
    expect(specimen).toEqual(['Specimen.identifier[0]', 'Specimen.identifier[1].system']);
  });

  it('quotes a key that is not an identifier, so a leaf under it never matches a mapped path', () => {
    const record = fixture();
    record.patient = { resourceType: 'Patient', id: 'P-RT', 'name[0]': { text: 'Nome Escondido' } };
    const patient = paths(buildRecordRoundTripLoss(record), 'patient');
    expect(patient).toEqual(['Patient["name[0]"].text']);
  });

  it('declares the Condition diseaseName chain and the coding system as limitations', () => {
    expect(ROUND_TRIP_LIMITATIONS.some((text) => /Condition: diseaseName/.test(text))).toBe(true);
    expect(ROUND_TRIP_LIMITATIONS.some((text) => /Nenhum system de coding/.test(text))).toBe(true);
  });

  it('stores at most MAX_UNMAPPED_PATHS paths, counts them all and marks the cut', () => {
    const observations = Array.from({ length: 60 }, () => ({
      resourceType: 'Observation',
      valueQuantity: { value: 1, system: 'http://unitsofmeasure.org' },
    }));
    const loss = buildRecordRoundTripLoss({ observations });
    expect(MAX_UNMAPPED_PATHS).toBe(50);
    expect(loss.unmappedCount).toBe(60);
    expect(loss.unmapped).toHaveLength(50);
    expect(loss.truncated).toBe(true);
    expect(loss.unmapped[0]).toEqual({ source: 'observations[0]', path: 'Observation.valueQuantity.system' });
    expect(loss.unmapped[49].source).toBe('observations[49]');

    const small = buildRecordRoundTripLoss(fixture());
    expect(small.truncated).toBe(false);
    expect(small.unmappedCount).toBe(small.unmapped.length);
  });

  it('walks an Observation shared through one cache once, with the same result', () => {
    const record = fixture();
    const cache = new WeakMap();
    const first = buildRecordRoundTripLoss(record, cache);
    expect(cache.has(record.observations[0])).toBe(true);
    expect(buildRecordRoundTripLoss(record, cache)).toEqual(first);
    expect(first).toEqual(buildRecordRoundTripLoss(record));
  });

  it('carries no value, id or extension url from the resources, and declares its limitations', () => {
    const loss = buildRecordRoundTripLoss(fixture());
    const text = JSON.stringify(loss);
    [
      'Maria Round Trip',
      'Apelido Secundario',
      '123.456.789-00',
      'maria.rt@example.org',
      'https://example.org/fhir/matrix-rt-segunda',
      'S-RT-ID',
      'P-RT',
      'soro',
    ].forEach((value) => expect(text).not.toContain(value));
    expect(loss.unmappedCount).toBe(loss.unmapped.length);
    expect(loss.limitations).toBe(ROUND_TRIP_LIMITATIONS);
    expect(Object.isFrozen(ROUND_TRIP_LIMITATIONS)).toBe(true);
  });

  it('sorts by source then path', () => {
    const loss = buildRecordRoundTripLoss(fixture());
    const sources = [...new Set(loss.unmapped.map((item) => item.source))];
    expect(sources).toEqual(['conditions[0]', 'consents[0]', 'observations[0]', 'patient', 'specimen']);
  });
});

describe('buildBundleRoundTripLoss (RF011 AC6, #1322)', () => {
  it('reports an Organization and a Patient without Specimen, not the linked Patient', () => {
    const { patient, specimen } = fixture();
    const organization = { resourceType: 'Organization', name: 'Biobanco' };
    const lonePatient = { resourceType: 'Patient', id: 'P-SOZINHO' };
    const resources = [patient, organization, specimen, lonePatient, 'texto'];
    const records = [{ fhir: { patient, specimen, consents: [], conditions: [], observations: [] } }];

    expect(buildBundleRoundTripLoss(resources, records)).toEqual({
      unattachedResourceCount: 3,
      unattached: [
        { resourceIndex: 1, resourceType: 'Organization' },
        { resourceIndex: 3, resourceType: 'Patient' },
        { resourceIndex: 4, resourceType: null },
      ],
    });
  });

  it('leaves out a resource in the mapped set and keeps the Organization', () => {
    const { patient, specimen } = fixture();
    const organization = { resourceType: 'Organization', name: 'Biobanco' };
    const provenance = { resourceType: 'Provenance', id: 'WR-1' };
    const study = { resourceType: 'ResearchStudy', id: 'ST-1' };
    const resources = [patient, provenance, organization, specimen, study];
    const records = [{ fhir: { patient, specimen, consents: [], conditions: [], observations: [] } }];

    expect(buildBundleRoundTripLoss(resources, records, new Set([provenance, study]))).toEqual({
      unattachedResourceCount: 1,
      unattached: [{ resourceIndex: 2, resourceType: 'Organization' }],
    });
  });
});
