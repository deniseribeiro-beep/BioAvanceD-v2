import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';

const TemperatureModel = require('../../src/models/Temperature');
const AssayModel = require('../../src/models/Assay');
const SensorModel = require('../../src/models/Sensor');
const PolicyModel = require('../../src/models/Policy');
const WorkflowRunModel = require('../../src/models/WorkflowRun');
const PhysicalStorageV2 = require('../../src/models/PhysicalStorageV2');
const ReferenceImportRunModel = require('../../src/models/ReferenceImportRun');
const BiomarkerObservationModel = require('../../src/models/BiomarkerObservation');
const {
  serializeLog,
  serializeLogs,
  serializeLogSimple,
  serializeValue,
  isObjectId,
} = require('../../src/utils/logSerializer');

describe('item 8 compact model and serializer branch pack', () => {
  it('covers Temperature alternate date/default and alert branches', () => {
    const date = new Date('2026-09-21T00:00:00Z');
    const created = TemperatureModel.create({
      logID: 'L1',
      sensorID: 'S1',
      locationID: 'LOC1',
      temperatureValue: -80,
      lastCalibration: date,
      nextCalibration: '2026-10-01T00:00:00Z',
      batteryLevel: 0,
      dataQualityScore: 0,
    });
    expect(created.lastCalibration).toBe(date);
    expect(created.nextCalibration).toBeInstanceOf(Date);
    expect(created.sensorId).toBe('S1');
    expect(created.locationId).toBe('LOC1');

    expect(TemperatureModel.validate({
      sensorID: 'S1',
      temperatureValue: 1,
      batteryLevel: -1,
      dataQualityScore: 2,
    }).errors).toEqual(expect.arrayContaining([
      'batteryLevel deve ser entre 0 e 100',
      'dataQualityScore deve ser entre 0 e 1',
    ]));

    expect(TemperatureModel.shouldGenerateAlert(-80, null, -70, 0)).toBe(false);
    expect(TemperatureModel.shouldGenerateAlert(-90, -85, -70, 0)).toBe(true);
    expect(TemperatureModel.shouldGenerateAlert(-80, -85, -70, 0)).toBe(false);
  });

  it('covers Assay invalid collection element branches and populated control creation', () => {
    const base = {
      studyId: 'ST1',
      specimenIds: ['S1'],
      assayType: 'sequencing',
      protocolId: 'P1',
      operatorId: 'U1',
      laboratoryId: 'LAB1',
      assayDateTime: '2026-09-21T00:00:00Z',
      intendedUse: 'research',
    };

    expect(AssayModel.validate({ ...base, specimenIds: [''] }).errors)
      .toContain('specimenIds deve conter apenas strings não vazias');
    expect(AssayModel.validate({ ...base, controls: 'bad' }).errors)
      .toContain('controls deve ser um array');
    expect(AssayModel.validate({ ...base, controls: [null, []] }).errors)
      .toEqual(expect.arrayContaining(['controls[0] deve ser um objeto', 'controls[1] deve ser um objeto']));
    expect(AssayModel.validate({ ...base, controls: [{ controlType: 'bad' }] }).errors[0])
      .toMatch(/controlType/);
    expect(AssayModel.validate({ ...base, reagentLotIds: [''] }).errors)
      .toContain('reagentLotIds deve conter apenas strings não vazias');
    expect(AssayModel.validate({ ...base, equipmentIds: [''] }).errors)
      .toContain('equipmentIds deve conter apenas strings não vazias');

    const created = AssayModel.create({
      ...base,
      assayId: 'A1',
      omicsDomain: 'genomics',
      assayBatchId: 'B1',
      controls: [{ controlType: 'positive', result: 0, reagentLotId: 'R1', notes: 'ok' }],
      reagentLotIds: ['R1'],
      equipmentIds: ['E1'],
    });
    expect(created.controls[0]).toEqual({
      controlType: 'positive',
      result: 0,
      reagentLotId: 'R1',
      notes: 'ok',
    });
  });

  it('covers Sensor and Policy alternate aliases and date branches', () => {
    const date = new Date('2026-09-21T00:00:00Z');
    const sensor = SensorModel.create({
      sensorID: 'S1',
      sensorType: 'temperature',
      locationID: 'L1',
      policyID: 'P1',
      lastCalibration: date,
      nextCalibration: '2026-10-01T00:00:00Z',
    });
    expect(sensor).toMatchObject({ sensorId: 'S1', locationId: 'L1', policyId: 'P1' });
    expect(sensor.lastCalibration).toBe(date);
    expect(sensor.nextCalibration).toBeInstanceOf(Date);

    const policy = PolicyModel.create({
      policyID: 'P1',
      minThreshold: -90,
      maxThreshold: -70,
      targetTemperature: -80,
      alertDelay: 7,
      validFrom: date,
      validTo: '2026-10-01T00:00:00Z',
    });
    expect(policy.policyId).toBe('P1');
    expect(policy.validFrom).toBe(date);
    expect(policy.validTo).toBeInstanceOf(Date);
    expect(policy.alertDelayMin).toBe(7);
  });

  it('covers WorkflowRun optional validation and creation branches', () => {
    const base = {
      workflowId: 'WF1',
      workflowVersion: '1',
      createdBy: 'U1',
      startedAt: '2026-09-21T00:00:00Z',
      runStatus: 'running',
    };
    expect(WorkflowRunModel.validate({ ...base, completedAt: 'bad' }).errors)
      .toContain('completedAt deve ser uma data válida');
    expect(WorkflowRunModel.validate({ ...base, softwareDependencies: 'bad' }).errors)
      .toContain('softwareDependencies deve ser um array');
    expect(WorkflowRunModel.validate({ ...base, softwareDependencies: [null] }).errors)
      .toContain('softwareDependencies[0] deve ser um objeto');
    expect(WorkflowRunModel.validate({ ...base, parameters: [] }).errors)
      .toContain('parameters deve ser um objeto');
    expect(WorkflowRunModel.validate({ ...base, inputFileIds: [''] }).errors)
      .toContain('inputFileIds deve conter apenas strings não vazias');
    expect(WorkflowRunModel.validate({ ...base, outputFileIds: [''] }).errors)
      .toContain('outputFileIds deve conter apenas strings não vazias');

    const created = WorkflowRunModel.create({
      ...base,
      workflowRunId: 'RUN1',
      containerImageDigest: 'sha256:x',
      softwareDependencies: [{ name: 'R', version: '4.5' }],
      parameters: { alpha: 1 },
      inputFileIds: ['F1'],
      outputFileIds: ['F2'],
      completedAt: '2026-09-21T01:00:00Z',
    });
    expect(created).toMatchObject({
      workflowRunId: 'RUN1',
      inputFileIds: ['F1'],
      outputFileIds: ['F2'],
      parameters: { alpha: 1 },
    });
  });

  it('covers PhysicalStorageV2 optional identifiers, coordinates and source scan branches', () => {
    const createdAt = new Date('2026-09-21T00:00:00Z');
    expect(PhysicalStorageV2.container({
      containerId: 'C1', containerType: 'tube', emptyStatus: 'empty', status: 'inactive', createdAt,
    })).toEqual({
      containerId: 'C1', containerType: 'tube', emptyStatus: 'empty', status: 'inactive', createdAt,
    });

    expect(PhysicalStorageV2.storageRack({
      storageRackId: 'R1',
      rowCount: 2,
      columnCount: 3,
      rackType: 'custom',
      coordinateScheme: 'numeric',
      orientationRule: 'bottom_left',
      status: 'inactive',
      storageLocationId: 'LOC1',
      catalogReference: 'CAT1',
    })).toMatchObject({
      storageRackId: 'R1',
      rackType: 'custom',
      rowCount: 2,
      columnCount: 3,
      storageLocationId: 'LOC1',
      catalogReference: 'CAT1',
    });

    expect(PhysicalStorageV2.storagePosition({
      storagePositionId: 'P1', storageRackId: 'R1', positionCode: 'custom', status: 'blocked',
    })).toMatchObject({
      storagePositionId: 'P1', rowIndex: null, columnIndex: null, status: 'blocked',
    });

    expect(PhysicalStorageV2.storagePosition({
      storageRackId: 'R1', positionCode: 'b12',
    })).toMatchObject({ positionCode: 'B12', rowIndex: 2, columnIndex: 12 });

    expect(PhysicalStorageV2.containerPositionAssignment({
      containerPositionAssignmentId: 'CPA1',
      containerId: 'C1',
      storagePositionId: 'P1',
      placedAt: createdAt,
      removedAt: createdAt,
      assignmentStatus: 'inactive',
      sourceScanEventId: 'SCAN1',
    })).toMatchObject({
      containerPositionAssignmentId: 'CPA1',
      sourceScanEventId: 'SCAN1',
      assignmentStatus: 'inactive',
    });
  });

  it('covers ReferenceImportRun invalid option and numeric counter branches', () => {
    const base = {
      referenceDatasetReleaseId: 'REL1',
      datasetCode: 'HPO',
      idempotencyKey: 'KEY1',
      inputChecksum: 'abc',
      initiatedBy: 'U1',
    };
    expect(ReferenceImportRunModel.validate({ ...base, importMode: 'bad' }).errors[0])
      .toMatch(/importMode/);
    expect(ReferenceImportRunModel.validate({ ...base, runStatus: 'bad' }).errors[0])
      .toMatch(/runStatus/);
    expect(ReferenceImportRunModel.validate({ ...base, recordsRead: '1' }).errors)
      .toContain('recordsRead deve ser numérico');

    const created = ReferenceImportRunModel.create({
      ...base,
      referenceImportRunId: 'RUN1',
      foundationDataRunId: 'F1',
      importMode: 'incremental',
      startedAt: '2026-09-21T00:00:00Z',
      completedAt: '2026-09-21T01:00:00Z',
      runStatus: 'completed',
      checkpoint: 'C1',
      batchSize: 10,
      recordsRead: 5,
      recordsValidated: 4,
      recordsInserted: 3,
      recordsUpdated: 2,
      recordsSkipped: 1,
      recordsRejected: 0,
      validationSummary: { ok: true },
      errorReportUri: 'file://report',
    });
    expect(created).toMatchObject({
      referenceImportRunId: 'RUN1',
      foundationDataRunId: 'F1',
      importMode: 'incremental',
      runStatus: 'completed',
      batchSize: 10,
      recordsRead: 5,
    });
  });

  it('covers BiomarkerObservation negative/invalid vocabulary and alias normalization branches', () => {
    const base = {
      participantId: 'P1',
      biomarkerType: 'CRP',
      value: 1.2,
      unit: 'mg/L',
      collectedAt: '2026-09-21T00:00:00Z',
    };
    expect(BiomarkerObservationModel.validate({ ...base, value: -1 }).errors)
      .toContain('value não pode ser negativo');
    expect(BiomarkerObservationModel.validate({ ...base, status: 'bad' }).errors[0])
      .toMatch(/status inválido/);
    expect(BiomarkerObservationModel.validate({ ...base, eventType: 'bad' }).errors[0])
      .toMatch(/eventType inválido/);

    const validation = BiomarkerObservationModel.validate({
      ...base,
      status: 'AMENDED',
      eventType: 'atualização',
      sampleId: 'S1',
      resourceType: '',
      subject: { reference: 'Patient/P1' },
      effectiveDateTime: '2026-09-21T02:00:00Z',
      notes: ' note ',
      linkedResourceType: 'Specimen',
      linkedResourceId: 'S1',
    });
    expect(validation.isValid).toBe(true);
    expect(validation.normalized).toMatchObject({
      eventType: 'update',
      sampleID: 'S1',
      specimenId: 'S1',
      resourceType: 'Observation',
      linkedResourceType: 'Specimen',
      linkedResourceId: 'S1',
    });
    expect(validation.normalized.specimen).toEqual({ reference: 'Specimen/S1' });

    const created = BiomarkerObservationModel.create(base);
    expect(created.idempotencyKey).toContain('P1');
    expect(() => BiomarkerObservationModel.create({})).toThrow();
  });

  it('covers logSerializer depth, circular, special-value and simple entity branches', () => {
    expect(serializeLog(null)).toBeNull();
    const circular = { name: 'root' };
    circular.self = circular;
    expect(serializeValue(circular).self).toBe('[Referência circular]');

    let deep = {};
    let cursor = deep;
    for (let i = 0; i < 12; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(JSON.stringify(serializeValue(deep))).toContain('Profundidade máxima atingida');

    const oid = new ObjectId();
    expect(isObjectId(oid)).toBe(true);
    expect(serializeValue(oid)).toEqual({ _type: 'ObjectId', _value: oid.toString() });
    expect(serializeValue(Buffer.from('x'))).toMatchObject({ _type: 'Buffer', _size: 1 });
    expect(serializeLogs({ a: 1 })).toEqual({ a: 1 });

    const objectWithValue = { _value: 42 };
    const objectWithString = { toString: () => 'custom-id' };
    const objectWithDefaultString = {};
    const objectWithThrowingString = { toString: () => { throw new Error('boom'); } };

    expect(serializeLogSimple({ entityID: objectWithValue }).entityID).toBe('42');
    expect(serializeLogSimple({ entityID: objectWithString }).entityID).toBe('custom-id');
    expect(serializeLogSimple({ entityID: objectWithDefaultString }).entityID).toBe('{}');
    expect(serializeLogSimple({ entityID: objectWithThrowingString }).entityID).toBe('{}');
    expect(serializeLogSimple({ entityID: true }).entityID).toBe('true');

    expect(serializeLogSimple({
      _id: { toString: () => 'partial-id' },
      timestamp: 'already-string',
      entityID: 7,
      userID: { toString: () => 'u1' },
      userId: { toString: () => 'u2' },
      payload: { d: new Date('2026-09-21T00:00:00Z') },
      metadata: { b: Buffer.from('x') },
    })).toMatchObject({
      _id: 'partial-id',
      timestamp: 'already-string',
      entityID: 7,
      userID: 'u1',
      userId: 'u2',
    });
  });
});
