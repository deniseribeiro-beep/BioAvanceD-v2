import { describe, expect, it } from 'vitest';

const AssayModel = require('../../src/models/Assay');
const ClinicalObservationModel = require('../../src/models/ClinicalObservation');
const ClinicalUnitModel = require('../../src/models/ClinicalUnit');
const DispositionActionModel = require('../../src/models/DispositionAction');
const ImportJob = require('../../src/models/ImportJob');
const LogModel = require('../../src/models/Log');
const OmicsRunModel = require('../../src/models/OmicsRun');
const PatientModel = require('../../src/models/Patient');
const PhenotypeObservationModel = require('../../src/models/PhenotypeObservation');
const PolicyModel = require('../../src/models/Policy');
const ProtocolModel = require('../../src/models/Protocol');
const QuarantineActionModel = require('../../src/models/QuarantineAction');
const ReferenceImportRunModel = require('../../src/models/ReferenceImportRun');
const ReportTemplateModel = require('../../src/models/ReportTemplate');
const { SampleModel } = require('../../src/models/Sample');
const SensorModel = require('../../src/models/Sensor');
const StorageBox = require('../../src/models/StorageBox');
const StorageContainer = require('../../src/models/StorageContainer');
const StudyModel = require('../../src/models/Study');
const TemperatureModel = require('../../src/models/Temperature');
const TemperatureIncidentModel = require('../../src/models/TemperatureIncident');
const TerminologyRelationModel = require('../../src/models/TerminologyRelation');
const { isEquipmentReady } = require('../../src/models/equipmentStatus');

describe('item 8 branch-95 model behaviors', () => {
  it('validates DispositionAction optional and collection fields without coercing invalid values', () => {
    const base = {
      retentionPolicyId: 'RP-1',
      entityType: 'Specimen',
      affectedRecordIds: ['SPEC-1'],
      dispositionAction: 'destroy',
      performedBy: 'User/operator',
    };

    expect(DispositionActionModel.validate({ ...base, affectedRecordIds: [''] }).errors)
      .toContain('affectedRecordIds deve conter apenas strings não vazias');
    expect(DispositionActionModel.validate({ ...base, dispositionMethod: 42 }).errors)
      .toContain('dispositionMethod deve ser string');
    expect(DispositionActionModel.validate({ ...base, dispositionCertificateUri: 42 }).errors)
      .toContain('dispositionCertificateUri deve ser string');
    expect(DispositionActionModel.validate({ ...base, dispositionMethod: null, dispositionCertificateUri: null }).isValid)
      .toBe(true);
  });

  it('validates all required ReferenceImportRun identifiers independently', () => {
    const base = {
      referenceDatasetReleaseId: 'REL-1',
      datasetCode: 'HPO',
      idempotencyKey: 'KEY-1',
      inputChecksum: 'abc',
      initiatedBy: 'User/importer',
    };
    expect(ReferenceImportRunModel.validate({ ...base, referenceDatasetReleaseId: null }).errors)
      .toContain('referenceDatasetReleaseId é obrigatório e deve ser string');
    expect(ReferenceImportRunModel.validate({ ...base, datasetCode: 7 }).errors)
      .toContain('datasetCode é obrigatório e deve ser string');
    expect(ReferenceImportRunModel.validate({ ...base, inputChecksum: null }).errors)
      .toContain('inputChecksum é obrigatório e deve ser string (SHA-256)');
    expect(ReferenceImportRunModel.validate({ ...base, initiatedBy: null }).errors)
      .toContain('initiatedBy é obrigatório e deve ser string');
  });

  it('covers Study required identifiers and non-array creation preservation', () => {
    expect(StudyModel.validate({
      studyId: '',
      studyTitle: '',
      ethicsApprovalId: ['CEP-1'],
    }).errors).toEqual(expect.arrayContaining([
      'studyId é obrigatório e deve ser string',
      'studyTitle é obrigatório e deve ser string',
    ]));

    const created = StudyModel.create({
      studyId: 'ST-1',
      studyTitle: 'Synthetic study',
      ethicsApprovalId: 'CEP-1',
    });
    expect(created.ethicsApprovalId).toBe('CEP-1');
  });

  it('preserves ClinicalObservation array/date options and their absent defaults', () => {
    const issued = new Date('2026-09-22T10:00:00.000Z');
    const fields = ClinicalObservationModel.fieldsOf({
      participantId: 'P1',
      observationCoding: { systemUri: 'http://loinc.org', code: '718-7' },
      effectiveDateTime: '2026-09-22T09:00:00.000Z',
      issuedDateTime: issued,
      observationStatus: 'final',
      referenceRange: [{ low: 1 }],
      interpretation: [{ text: 'normal' }],
    });
    expect(fields.referenceRange).toEqual([{ low: 1 }]);
    expect(fields.interpretation).toEqual([{ text: 'normal' }]);
    expect(fields.issuedDateTime).toEqual(issued);

    const sparse = ClinicalObservationModel.fieldsOf({});
    expect(sparse.referenceRange).toEqual([]);
    expect(sparse.interpretation).toEqual([]);
    expect(sparse.issuedDateTime).toBeNull();
  });

  it('rejects a non-string optional Assay omicsDomain', () => {
    const validation = AssayModel.validate({
      studyId: 'ST1',
      specimenIds: ['S1'],
      assayType: 'sequencing',
      protocolId: 'P1',
      operatorId: 'U1',
      laboratoryId: 'LAB1',
      assayDateTime: '2026-09-22T00:00:00Z',
      intendedUse: 'research',
      omicsDomain: 42,
    });
    expect(validation.errors).toContain('omicsDomain deve ser string');
  });

  it('creates explicit TemperatureIncident lifecycle timestamps', () => {
    const created = TemperatureIncidentModel.create({
      sensorKey: 'S1',
      sensorName: 'Sensor 1',
      openedAt: '2026-09-22T00:00:00Z',
      closedAt: '2026-09-22T01:00:00Z',
      acknowledgedAt: '2026-09-22T00:30:00Z',
      currentTemperature: -70,
      maxTemperature: -65,
      minTemperature: -85,
      samplesOutOfRange: 1,
      lastEscalatedAt: '2026-09-22T00:45:00Z',
    });
    expect(created.closedAt).toBeInstanceOf(Date);
    expect(created.acknowledgedAt).toBeInstanceOf(Date);
    expect(created.lastEscalatedAt).toBeInstanceOf(Date);
  });

  it('validates TerminologyRelation version and status independently', () => {
    const base = {
      sourceConceptId: 'A',
      targetConceptId: 'B',
      relationType: 'maps_to',
      relationVersion: '1',
      referenceDatasetReleaseId: 'REL1',
    };
    expect(TerminologyRelationModel.validate({ ...base, relationVersion: null }).errors)
      .toContain('relationVersion é obrigatório e deve ser string');
    expect(TerminologyRelationModel.validate({ ...base, relationStatus: 'invalid' }).errors[0])
      .toMatch(/relationStatus/);
  });

  it('covers ClinicalUnit empty-name create fallback while preserving explicit canonical names', () => {
    expect(ClinicalUnitModel.create({}).name).toBe('');
    expect(ClinicalUnitModel.create({ name: ' Unidade  Clínica ' })).toMatchObject({
      name: 'Unidade Clínica',
      normalizedName: 'UNIDADE CLINICA',
    });
  });

  it('keeps ImportJob absent canonical fields null', () => {
    const job = ImportJob.create({});
    expect(job.dataType).toBeNull();
    expect(job.fileName).toBeNull();
  });

  it('covers Log resource/user fallbacks without inventing identifiers', () => {
    const now = new Date();
    const fromResource = LogModel.create({
      dateTime: now,
      action: 'READ',
      resourceType: 'Specimen',
      userID: 'user-1',
    });
    expect(fromResource.resourceType).toBe('Specimen');
    expect(fromResource.userId).toBe('user-1');

    const defaults = LogModel.create({ dateTime: now, action: 'READ' });
    expect(defaults.resourceType).toBe('Sistema');
    expect(defaults.userId).toBe('system');
  });

  it('covers Patient optional consent/date fields with explicit values', () => {
    const createdAt = new Date('2026-09-21T00:00:00Z');
    const updatedAt = new Date('2026-09-22T00:00:00Z');
    const patient = PatientModel.create({
      participantId: '12345678',
      sex: 'F',
      consentTemplateId: 'TCLE-1',
      createdAt,
      updatedAt,
    });
    expect(patient.consentTemplateId).toBe('TCLE-1');
    expect(patient.createdAt).toEqual(createdAt);
    expect(patient.updatedAt).toEqual(updatedAt);
  });

  it('covers PhenotypeObservation evidence-array mapping', () => {
    const fields = PhenotypeObservationModel.fieldsOf({
      phenotypeEvidence: ['DR-1', '', 'DR-2'],
    });
    expect(fields.phenotypeEvidence).toEqual(['DR-1', 'DR-2']);
  });

  it('covers Policy Date-instance validTo preservation', () => {
    const validTo = new Date('2026-12-31T00:00:00Z');
    const policy = PolicyModel.create({
      minThreshold: -90,
      maxThreshold: -70,
      targetTemperature: -80,
      validTo,
    });
    expect(policy.validTo).toBe(validTo);
  });

  it('validates Protocol identifiers independently', () => {
    const period = { start: '2026-01-01T00:00:00Z' };
    expect(ProtocolModel.validate({ protocolName: 'P', effectivePeriod: period }).errors)
      .toContain('protocolId é obrigatório e deve ser string');
    expect(ProtocolModel.validate({ protocolId: 'P1', effectivePeriod: period }).errors)
      .toContain('protocolName é obrigatório e deve ser string');
  });

  it('covers QuarantineAction blank status normalization and explicit release timestamp', () => {
    expect(QuarantineActionModel.validateActionStatus()).toBe(false);
    const released = QuarantineActionModel.create({
      specimenIds: ['S1'],
      actionStatus: 'released',
      releasedAt: '2026-09-22T00:00:00Z',
    });
    expect(released.releasedAt).toBeInstanceOf(Date);
  });

  it('covers ReportTemplate empty handler fallback and validation guard', () => {
    expect(ReportTemplateModel.fieldsOf({}).handlerKey).toBe('');
    expect(ReportTemplateModel.validate({ code: 'custom', name: 'Custom' }).errors)
      .toContain('handlerKey é obrigatório');
  });

  it('covers Sample optional withdrawn/created dates', () => {
    const createdAt = new Date('2026-09-20T00:00:00Z');
    const sample = SampleModel.create({
      specimenId: 'SPEC-1',
      participantId: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      registeredAt: '2026-09-21T00:00:00Z',
      withdrawnAt: '2026-09-22T00:00:00Z',
      quantity: 1,
      linkedProject: 'P1',
      createdAt,
    });
    expect(sample.withdrawnAt).toBeInstanceOf(Date);
    expect(sample.createdAt).toEqual(createdAt);
  });

  it('covers Sensor and Temperature absent calibration fallbacks', () => {
    expect(SensorModel.create({ sensorId: 'S1', sensorType: 'temperature' }).lastCalibration).toBeNull();
    expect(TemperatureModel.create({ sensorId: 'S1', temperatureValue: -80 }).lastCalibration).toBeNull();
  });

  it('covers equipment readiness with an absent status', () => {
    expect(isEquipmentReady()).toBe(false);
  });

  it('covers StorageBox invalid positions and a missing occupancy grid', () => {
    const box = new StorageBox({
      name: 'Box 1',
      parent_id: '507f1f77bcf86cd799439011',
      dimension: { rows: 2, cols: 2 },
    });
    expect(box.isValidPosition()).toBe(false);
    expect(box.isValidPosition('AA1')).toBe(false);
    expect(box.isValidPosition('A3')).toBe(false);

    const occupancy = StorageBox.prototype.checkPositionOccupancy.call({
      isValidPosition: () => true,
      occupancyGrid: null,
    }, 'A1');
    expect(occupancy).toEqual({ occupied: false, specimenObjectId: null });
  });

  it('covers StorageContainer static missing-type validation', () => {
    expect(StorageContainer.validate({ name: 'Container' }).errors)
      .toContain('containerType é obrigatório');
  });

  it('rejects invalid optional OmicsRun mixsChecklist', () => {
    const base = {
      assayId: 'A1',
      omicsType: 'genomics',
      pipelineId: 'P1',
      pipelineVersion: '1',
      runDateTime: '2026-09-22T00:00:00Z',
      operatorId: 'U1',
    };
    expect(OmicsRunModel.validate({ ...base, mixsChecklist: 42 }).errors)
      .toContain('mixsChecklist deve ser uma string não vazia');
  });
});
