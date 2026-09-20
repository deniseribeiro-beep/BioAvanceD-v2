import { afterEach, describe, expect, it, vi } from 'vitest';

const router = require('../../src/routes/intakeWizard');
const patientIdentityService = require('../../src/services/PatientIdentityService');
const consentService = require('../../src/services/consent.service');

const h = router._test;

afterEach(() => {
  vi.restoreAllMocks();
});

function cursor(rows) {
  return {
    limit: () => ({ toArray: async () => rows }),
  };
}

describe('intakeWizard helper residual branch coverage', () => {
  it('covers primitive normalizers and canonical alias collection', () => {
    expect(h.normalizeString(null)).toBe('');
    expect(h.normalizeString('  x  ')).toBe('x');
    expect(h.normalizeNumber('12.5', 0)).toBe(12.5);
    expect(h.normalizeNumber('not-a-number', 7)).toBe(7);
    expect(h.normalizeArray(['x'])).toEqual(['x']);
    expect(h.normalizeArray('x')).toEqual([]);
    expect(h.normalizeObject({ a: 1 })).toEqual({ a: 1 });
    expect(h.normalizeObject(null)).toEqual({});
    expect(h.normalizeObject([])).toEqual({});

    expect(h.collectCanonicalViolations(null, { canonical: ['legacy'] })).toEqual([]);
    expect(h.collectCanonicalViolations([], { canonical: ['legacy'] })).toEqual([]);
    expect(h.collectCanonicalViolations(
      { legacy: 1, old: 2 },
      { canonical: ['legacy', 'legacy'], ignored: 'not-an-array', second: ['old'] }
    )).toEqual(['legacy', 'old']);
  });

  it('builds id variants without blank values and adds numeric equivalents only when valid', () => {
    expect(h.buildIdVariants(undefined, null, '', '   ')).toEqual([]);
    expect(h.buildIdVariants('001', 1, 'alpha', '1')).toEqual(['001', 1, '1', 'alpha']);
  });

  it('parses supported birth dates and rejects malformed values', () => {
    expect(h.parseBirthDate(null)).toBeNull();

    const date = new Date(2020, 4, 3, 13, 10);
    expect(h.parseBirthDate(date)).toEqual(new Date(2020, 4, 3));
    expect(h.parseBirthDate('03/05/2020')).toEqual(new Date(2020, 4, 3));
    expect(h.parseBirthDate('not-a-date')).toBeNull();
    expect(h.parseBirthDate('')).toBeNull();
  });

  it('resolves an explicit participant id and falls back to an 8 digit synthetic id', () => {
    expect(h.resolvePatientID({ participant: { participantId: '12345678' } })).toBe('12345678');

    vi.spyOn(Date, 'now').mockReturnValue(12345);
    expect(h.resolvePatientID({ participant: { participantId: 'abc' } })).toBe('00012345');
    expect(h.resolvePatientID()).toMatch(/^\d{8}$/);
  });

  it('normalizes clinical data with both populated and missing sections', () => {
    expect(h.buildClinicalData()).toEqual({
      orphaCode: '',
      omimCode: '',
      cid: '',
      phenotypes: [],
      charlsonComorbidities: [],
      biomarkerValues: {},
      allergies: [],
      familyHistories: [],
      procedures: [],
      observationRecords: [],
      clinicalOutcomes: [],
    });

    expect(h.buildClinicalData({
      diagnosis: { orphaCode: ' ORPHA:1 ', omimCode: 'OMIM:2', icdCode: ' A00 ' },
      clinical: {
        diseasePhenotypes: [{ hpoId: 'HP:1' }],
        charlsonConditions: ['diabetes'],
        biomarkersValues: { crp: 1 },
        allergies: [{}],
        familyHistories: [{}],
        procedures: [{}],
        observationRecords: [{}],
        clinicalOutcomes: [{}],
      },
    })).toMatchObject({
      orphaCode: 'ORPHA:1',
      omimCode: '2',
      cid: 'A00',
      phenotypes: [{ hpoId: 'HP:1' }],
      biomarkerValues: { crp: 1 },
    });
  });

  it('normalizes pharmacology values, aliases, fallbacks and nullable dates', () => {
    expect(h.buildPharmacologyData()).toEqual({
      treatmentStatus: '',
      medicationName: null,
      atcCode: null,
      atcClass: null,
      lastDoseDate: null,
      washoutStartDate: null,
      washoutEndDate: null,
    });

    expect(h.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'on_treatment',
          medicationName: ' Metformin ',
          atcCode: 'atc:a10ba02',
          lastDoseDate: '2026-01-01',
        },
      },
    })).toMatchObject({
      treatmentStatus: 'ON_TREATMENT',
      medicationName: 'Metformin',
      atcCode: 'A10BA02',
      atcClass: 'A',
      lastDoseDate: '2026-01-01',
    });

    expect(h.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'unexpected',
          atcCode: 'B01',
          atcClass: 'custom',
          washoutStartDate: '2026-01-02',
          washoutEndDate: '2026-01-03',
        },
      },
    })).toMatchObject({
      treatmentStatus: '',
      atcCode: 'B01',
      atcClass: 'CUSTOM',
      washoutStartDate: '2026-01-02',
      washoutEndDate: '2026-01-03',
    });
  });

  it('builds sample documents across explicit and fallback specimen branches', () => {
    const matched = { _id: 'patient-1', participantId: '87654321' };
    const explicit = h.buildSampleDocumentFromIntake({
      specimen: {
        specimenStatus: 'AVAILABLE',
        registeredAt: '2026-01-01T00:00:00.000Z',
        sampleType: 'Plasma',
        sampleOrigin: 'Hospital',
        extractionProtocol: 'EDTA',
        barcode: ' B-1 ',
        quantity: '2.5',
        unit: 'mL',
        linkedProject: 'P1',
        sprec: { sampleType: 'SER' },
      },
      consent: { consentTemplateId: ' tpl-1 ' },
    }, matched);

    expect(explicit).toMatchObject({
      participantId: '87654321',
      patientObjectId: 'patient-1',
      sampleType: 'Plasma',
      sampleOrigin: 'Hospital',
      extractionProtocol: 'EDTA',
      barcode: 'B-1',
      quantity: 2.5,
      unit: 'mL',
      specimenStatus: 'available',
      linkedProject: 'P1',
      consentTemplateId: 'tpl-1',
    });

    const fallback = h.buildSampleDocumentFromIntake({
      participant: { participantId: '12345678' },
      specimen: { sprec: { sampleType: 'SER' }, sampleType: '', quantity: 'bad' },
    });
    expect(fallback).toMatchObject({
      participantId: '12345678',
      patientObjectId: null,
      sampleType: 'SER',
      sampleOrigin: 'UNKNOWN',
      extractionProtocol: 'UNKNOWN',
      barcode: null,
      quantity: 0,
      unit: null,
      specimenStatus: 'quarantined',
      linkedProject: 'INTAKE_WIZARD',
      consentTemplateId: null,
    });
  });

  it('delegates patient matching with a normalized identity document and parsed birth date', async () => {
    const spy = vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue({ created: true });
    const db = {};

    await expect(h.resolveMatchedPatient(db, {
      participant: {
        participantId: '12345678',
        patientName: 'Paciente',
        birthDate: '03/05/2020',
        identityDocument: '  DOC-1 ',
      },
    })).resolves.toEqual({ created: true });

    expect(spy).toHaveBeenCalledWith(db, {
      participantId: '12345678',
      patientName: 'Paciente',
      birthDate: new Date(2020, 4, 3),
      identityDocument: 'DOC-1',
    });
  });

  it('resolves consent decisions for missing, active, revoked and pending consent', async () => {
    await expect(h.resolveConsentDecision({}, {})).rejects.toMatchObject({ statusCode: 400 });

    const spy = vi.spyOn(consentService, 'getPatientConsent');
    spy.mockResolvedValueOnce({ status: 'ACTIVE', _id: 'mongo-consent' });
    await expect(h.resolveConsentDecision({}, { participantId: '12345678' })).resolves.toMatchObject({
      active: true,
      consentId: 'mongo-consent',
      status: 'SIGNED',
    });

    spy.mockResolvedValueOnce({ status: 'REVOKED', consentId: 'consent-2' });
    await expect(h.resolveConsentDecision({}, { participantId: '12345678' })).resolves.toMatchObject({
      active: false,
      consentId: 'consent-2',
      status: 'REVOKED',
      quarantineReason: 'CONSENT_REVOKED',
    });

    spy.mockResolvedValueOnce(null);
    await expect(h.resolveConsentDecision({}, { participantId: '12345678' })).resolves.toMatchObject({
      active: false,
      status: 'PENDING',
      quarantineReason: 'CONSENT_PENDING',
    });
  });

  it('classifies sensor and equipment readiness across empty, ready and blocked statuses', async () => {
    expect(h.isOperationalSensor({})).toBe(true);
    expect(h.isOperationalSensor({ status: 'offline' })).toBe(false);
    expect(h.isOperationalSensor({ maintenanceStatus: 'maintenance' })).toBe(false);
    expect(h.isOperationalSensor({ operationalStatus: 'active' })).toBe(true);

    const sensorFind = vi.fn(() => cursor([{ status: 'offline' }, { status: 'active' }]));
    const equipmentFindOne = vi.fn();
    const db = {
      collection: vi.fn((name) => {
        if (name === 'sensors') return { find: sensorFind };
        if (name === 'equipment') return { findOne: equipmentFindOne };
        throw new Error(name);
      }),
    };

    await expect(h.hasOperationalSensorForContainer(db, { containerID: '01' })).resolves.toBe(true);
    expect(sensorFind.mock.calls[0][0].$or[0].locationId.$in).toEqual(['01', 1]);

    await expect(h.isEquipmentReadyForContainer(db, {})).resolves.toBe(false);
    equipmentFindOne.mockResolvedValueOnce(null);
    await expect(h.isEquipmentReadyForContainer(db, { containerID: 'EQ-1' })).resolves.toBe(false);
    equipmentFindOne.mockResolvedValueOnce({ status: 'Maintenance' });
    await expect(h.isEquipmentReadyForContainer(db, { containerID: 'EQ-1' })).resolves.toBe(false);
    equipmentFindOne.mockResolvedValueOnce({ status: 'Active' });
    await expect(h.isEquipmentReadyForContainer(db, { containerID: 'EQ-1' })).resolves.toBe(true);
  });

  it('walks direct and drawer storage hierarchies', async () => {
    const docs = {
      drawer: { _id: 'drawer', containerType: 'DRAWER', parent_id: 'rack' },
      rack: { _id: 'rack', containerType: 'RACK', parent_id: 'shelf' },
      shelf: { _id: 'shelf', containerType: 'SHELF', parent_id: 'freezer' },
      freezer: { _id: 'freezer', containerType: 'FREEZER', containerID: 'EQ-1' },
    };
    const findOne = vi.fn(async ({ _id }) => docs[_id] || null);
    const db = { collection: () => ({ findOne }) };

    await expect(h.resolveStorageHierarchyForBox(db, { parent_id: 'rack' })).resolves.toMatchObject({
      rack: docs.rack,
      shelf: docs.shelf,
      freezer: docs.freezer,
    });
    await expect(h.resolveStorageHierarchyForBox(db, { parent_id: 'drawer' })).resolves.toMatchObject({
      rack: docs.rack,
      shelf: docs.shelf,
      freezer: docs.freezer,
    });
    await expect(h.resolveStorageHierarchyForBox(db, {})).resolves.toEqual({
      rack: null,
      shelf: null,
      freezer: null,
    });
  });

  it('finds positions for object and Map occupancy grids and rejects unusable boxes', () => {
    expect(h.findFirstAvailablePosition({ dimension: { rows: 0, cols: 2 } })).toBeNull();
    expect(h.findFirstAvailablePosition({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: true },
    })).toBe('A2');

    const map = new Map([['A1', true], ['A2', true]]);
    expect(h.findFirstAvailablePosition({
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: map,
    })).toBe('B1');

    expect(h.findFirstAvailablePosition({
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: { A1: true },
    })).toBeNull();

    const candidates = h.findAvailableStorageBoxCandidates([
      { _id: 'blocked', status: 'FULL', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {} },
      { _id: 'no-capacity', status: 'ACTIVE', dimension: { rows: 0, cols: 1 }, currentOccupancy: 0, occupancyGrid: {} },
      { _id: 'full', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 1, occupancyGrid: {} },
      { _id: 'grid-full', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: { A1: true } },
      { _id: 'ok', status: '', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {} },
    ]);
    expect(candidates.map((box) => box._id)).toEqual(['ok']);
  });

  it('resolves automatic storage or reports 409/422 according to candidate availability', async () => {
    const makeDb = ({ boxes, hierarchy = {}, equipment = null, sensors = [] }) => ({
      collection(name) {
        if (name === 'storageBoxes') {
          const c = { sort: () => c, limit: () => c, toArray: async () => boxes };
          return { find: () => c };
        }
        if (name === 'storageContainers') {
          return { findOne: vi.fn(async ({ _id }) => hierarchy[_id] || null) };
        }
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue(equipment) };
        if (name === 'sensors') return { find: vi.fn(() => cursor(sensors)) };
        throw new Error(name);
      },
    });

    await expect(h.resolveAutomaticLocation(makeDb({ boxes: [] }))).rejects.toMatchObject({ statusCode: 409 });

    const box = { _id: 'box', parent_id: 'rack', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {} };
    await expect(h.resolveAutomaticLocation(makeDb({ boxes: [box] }))).rejects.toMatchObject({ statusCode: 422 });

    const hierarchy = {
      rack: { _id: 'rack', containerType: 'RACK', parent_id: 'shelf' },
      shelf: { _id: 'shelf', containerType: 'SHELF', parent_id: 'freezer' },
      freezer: { _id: 'freezer', containerType: 'FREEZER', containerID: 'EQ-1' },
    };
    await expect(h.resolveAutomaticLocation(makeDb({
      boxes: [box],
      hierarchy,
      equipment: { status: 'Active' },
      sensors: [{ status: 'active' }],
    }))).resolves.toMatchObject({
      box,
      rack: hierarchy.rack,
      shelf: hierarchy.shelf,
      freezer: hierarchy.freezer,
      previewPosition: 'A1',
    });
  });

  it('builds readable storage and label links across optional fields', () => {
    expect(h.buildReadableStoragePlacement(
      { freezer: { containerID: 'EQ-1' }, box: { name: 'Box A' } },
      { positionCode: 'B2' }
    )).toBe('equipamento EQ-1 / box Box A / posição B2');

    expect(h.buildReadableStoragePlacement({ box: { boxID: 'BOX-2' } }, {})).toBe('box BOX-2');
    expect(h.buildReadableStoragePlacement({}, {})).toBe('');

    expect(h.buildLabelLinks({ _id: { toString: () => 'sample-1' }, barcode: 'BC 1' })).toEqual({
      sampleId: 'sample-1',
      symbologyAssetsUrl: '/api/samples/by-barcode/BC%201/symbology-assets',
      printJobUrl: '/api/samples/sample-1/label/print-job',
    });
    expect(h.buildLabelLinks({ sampleID: 'sample-2' })).toEqual({
      sampleId: 'sample-2',
      symbologyAssetsUrl: null,
      printJobUrl: '/api/samples/sample-2/label/print-job',
    });
  });
});
