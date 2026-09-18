import { describe, expect, it } from 'vitest';

const ReferenceDatasetReleaseModel = require('../../src/models/ReferenceDatasetRelease');
const PhysicalStorageV2 = require('../../src/models/PhysicalStorageV2');
const RetentionPolicyModel = require('../../src/models/RetentionPolicy');
const NotificationRuleModel = require('../../src/models/NotificationRule');

describe('simple model branch coverage for item 8', () => {
  it('covers ReferenceDatasetRelease validation type branches and explicit date/file branches', () => {
    const invalid = ReferenceDatasetReleaseModel.validate({
      sourceId: 1,
      datasetCode: 'CODE',
      datasetName: 2,
      systemUri: 3,
      datasetVersion: 4,
      retrievalUri: 5,
      accessMethod: 'download',
      sourceFormat: 'csv',
      license: 6,
      sourceChecksum: 'sha256:abc',
      parserVersion: 7,
      mappingVersion: 8,
      releaseStatus: 'planned',
    });

    expect(invalid.isValid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'sourceId é obrigatório e deve ser string',
      'datasetName é obrigatório e deve ser string',
      'systemUri é obrigatório e deve ser string',
      'datasetVersion é obrigatório e deve ser string',
      'retrievalUri é obrigatório e deve ser string',
      'sourceFormat deve ser um array',
      'license é obrigatório e deve ser string',
      'parserVersion é obrigatório e deve ser string (SemVer)',
      'mappingVersion é obrigatório e deve ser string (SemVer)',
    ]));

    const explicit = ReferenceDatasetReleaseModel.create({
      referenceDatasetReleaseId: 'release-1',
      sourceId: 'SRC',
      datasetCode: 'CODE',
      datasetName: 'Dataset',
      systemUri: 'urn:test',
      datasetVersion: 'v1',
      releaseDate: '2026-01-02T00:00:00.000Z',
      retrievalUri: 'file:///tmp/test',
      retrievedAt: '2026-01-03T00:00:00.000Z',
      accessMethod: 'download',
      sourceFormat: ['json'],
      license: 'CC0',
      licenseUri: 'https://example.test/license',
      sourceChecksum: 'sha256:abc',
      fileSize: 123,
      parserVersion: '1.0.0',
      mappingVersion: '1.0.0',
      releaseStatus: 'active',
      previousReleaseId: 'release-0',
    });

    expect(explicit).toEqual(expect.objectContaining({
      referenceDatasetReleaseId: 'release-1',
      accessMethod: 'download',
      sourceFormat: ['json'],
      licenseUri: 'https://example.test/license',
      fileSize: 123,
      releaseStatus: 'active',
      previousReleaseId: 'release-0',
    }));
    expect(explicit.releaseDate).toBeInstanceOf(Date);
    expect(explicit.retrievedAt).toBeInstanceOf(Date);

    const nonNumericFileSize = ReferenceDatasetReleaseModel.create({
      sourceId: 'SRC',
      datasetCode: 'CODE',
      datasetName: 'Dataset',
      systemUri: 'urn:test',
      datasetVersion: 'v1',
      retrievalUri: 'file:///tmp/test',
      license: 'CC0',
      sourceChecksum: 'sha256:abc',
      parserVersion: '1.0.0',
      mappingVersion: '1.0.0',
      fileSize: '123',
    });
    expect(nonNumericFileSize.fileSize).toBeNull();
  });

  it('covers PhysicalStorageV2 explicit/default identifiers, optional fields and coordinate branches', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    expect(PhysicalStorageV2.container({
      containerId: 'c-1',
      specimenId: 's-1',
      containerType: 'tube',
      emptyStatus: 'empty',
      status: 'inactive',
      createdAt,
    })).toEqual({
      containerId: 'c-1',
      containerType: 'tube',
      emptyStatus: 'empty',
      status: 'inactive',
      createdAt,
    });

    const rack = PhysicalStorageV2.storageRack({
      storageRackId: 7,
      rackType: 'drawer',
      rowCount: 8,
      columnCount: 12,
      coordinateScheme: 'numeric',
      orientationRule: 'bottom_left',
      status: 'inactive',
      storageLocationId: 99,
      catalogReference: 123,
    });
    expect(rack).toEqual(expect.objectContaining({
      storageRackId: '7',
      rackType: 'drawer',
      rowCount: 8,
      columnCount: 12,
      coordinateScheme: 'numeric',
      orientationRule: 'bottom_left',
      status: 'inactive',
      storageLocationId: '99',
      catalogReference: '123',
    }));

    const invalidPosition = PhysicalStorageV2.storagePosition({
      storagePositionId: 'pos-custom',
      storageRackId: 'rack-1',
      positionCode: 'custom',
      status: 'blocked',
    });
    expect(invalidPosition).toEqual(expect.objectContaining({
      storagePositionId: 'pos-custom',
      positionCode: 'CUSTOM',
      rowIndex: null,
      columnIndex: null,
      status: 'blocked',
    }));

    const assignedAt = new Date('2026-02-01T00:00:00.000Z');
    const releasedAt = new Date('2026-02-02T00:00:00.000Z');
    const specimenAssignment = PhysicalStorageV2.specimenContainerAssignment({
      specimenContainerAssignmentId: 'sca-1',
      specimenId: 10,
      containerId: 20,
      assignedAt,
      releasedAt,
      assignmentStatus: 'inactive',
      sourceEventId: 'evt-1',
    });
    expect(specimenAssignment).toEqual(expect.objectContaining({
      specimenContainerAssignmentId: 'sca-1',
      specimenId: '10',
      containerId: '20',
      loadedAt: assignedAt,
      unloadedAt: releasedAt,
      assignmentStatus: 'inactive',
      sourceEventId: 'evt-1',
    }));

    const placedAt = new Date('2026-03-01T00:00:00.000Z');
    const removedAt = new Date('2026-03-02T00:00:00.000Z');
    const positionAssignment = PhysicalStorageV2.containerPositionAssignment({
      containerPositionAssignmentId: 'cpa-1',
      containerId: 1,
      storagePositionId: 2,
      placedAt,
      removedAt,
      assignmentStatus: 'inactive',
      sourceScanEventId: 3,
    });
    expect(positionAssignment).toEqual(expect.objectContaining({
      containerPositionAssignmentId: 'cpa-1',
      sourceScanEventId: '3',
      placedAt,
      removedAt,
      assignmentStatus: 'inactive',
    }));

    const rackAssignment = PhysicalStorageV2.rackLocationAssignment({
      rackLocationAssignmentId: 'rla-1',
      storageRackId: 1,
      storageLocationId: 2,
      placedAt,
      removedAt,
      assignmentStatus: 'inactive',
      sourceEventId: 'evt-rack',
    });
    expect(rackAssignment).toEqual(expect.objectContaining({
      rackLocationAssignmentId: 'rla-1',
      sourceEventId: 'evt-rack',
      placedAt,
      removedAt,
      assignmentStatus: 'inactive',
    }));

    const defaultClose = PhysicalStorageV2.closeFields();
    expect(defaultClose.removedAt).toBeInstanceOf(Date);
    expect(PhysicalStorageV2.closeFields(placedAt)).toEqual({ removedAt: placedAt, assignmentStatus: 'inactive' });

    const defaultUnload = PhysicalStorageV2.unloadContainerFields();
    expect(defaultUnload.unloadedAt).toBeInstanceOf(Date);
    expect(PhysicalStorageV2.unloadContainerFields(removedAt)).toEqual({
      unloadedAt: removedAt,
      assignmentStatus: 'inactive',
    });
  });

  it('covers RetentionPolicy element, effective-period, active and create branches', () => {
    const base = {
      applicableEntityTypes: ['AuditEvent'],
      triggerEvent: 'creation',
      postRetentionAction: 'archive',
      retentionPeriod: 'P365D',
      version: 'v1',
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
    };

    const invalidElement = RetentionPolicyModel.validate({
      ...base,
      applicableEntityTypes: ['AuditEvent', '   ', 7],
      effectivePeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: 'not-a-date',
      },
      active: 'yes',
    });
    expect(invalidElement.errors).toEqual(expect.arrayContaining([
      'applicableEntityTypes[1] deve ser um código de texto válido',
      'applicableEntityTypes[2] deve ser um código de texto válido',
      'effectivePeriod.end deve ser uma data válida quando informado',
      'active deve ser booleano',
    ]));

    const validEnd = RetentionPolicyModel.validate({
      ...base,
      effectivePeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z',
      },
      active: false,
    });
    expect(validEnd).toEqual({ isValid: true, errors: [] });

    const explicit = RetentionPolicyModel.create({
      ...base,
      description: '  governed policy  ',
      active: false,
      effectivePeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z',
      },
    });
    expect(explicit.description).toBe('governed policy');
    expect(explicit.active).toBe(false);
    expect(explicit.effectivePeriod.end).toBeInstanceOf(Date);

    const nonStringDescription = RetentionPolicyModel.create({
      ...base,
      description: 123,
    });
    expect(nonStringDescription.description).toBe('');
  });

  it('covers NotificationRule validation/escalation and create branches', () => {
    const base = {
      eventType: 'TEMPERATURE_EXCURSION',
      channels: ['in_app'],
      recipientRoleCodes: ['ADMIN'],
      maxDeliveryMinutes: 2,
      version: 'v1',
    };

    const invalid = NotificationRuleModel.validate({
      ...base,
      channels: ['sms'],
      sensitiveFieldsAllowlist: 'sampleId',
      escalation: 'invalid',
      maxDeliveryMinutes: 0,
      active: 'yes',
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('channels[0]'),
      'sensitiveFieldsAllowlist deve ser um array quando informado',
      'escalation deve ser um objeto quando informado',
      'maxDeliveryMinutes é obrigatório e deve ser um número positivo',
      'active deve ser booleano',
    ]));

    const invalidEscalation = NotificationRuleModel.validate({
      ...base,
      escalation: {
        enabled: true,
        channel: 'sms',
        afterFailures: 0,
      },
    });
    expect(invalidEscalation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('escalation.channel'),
      'escalation.afterFailures deve ser um inteiro >= 1',
    ]));

    expect(NotificationRuleModel.validate({
      ...base,
      sensitiveFieldsAllowlist: [],
      escalation: { enabled: false },
      active: false,
    })).toEqual({ isValid: true, errors: [] });

    const enabled = NotificationRuleModel.create({
      ...base,
      channels: ['email', 'in_app'],
      recipientRoleCodes: ['ADMIN', 'AUDITOR'],
      sensitiveFieldsAllowlist: ['sensorId'],
      escalation: {
        enabled: true,
        channel: 'in_app',
        afterFailures: 2,
      },
      description: '  critical notification  ',
      active: false,
    });
    expect(enabled).toEqual(expect.objectContaining({
      sensitiveFieldsAllowlist: ['sensorId'],
      escalation: { enabled: true, afterFailures: 2, channel: 'in_app' },
      description: 'critical notification',
      active: false,
    }));

    const defaults = NotificationRuleModel.create(base);
    expect(defaults).toEqual(expect.objectContaining({
      sensitiveFieldsAllowlist: [],
      escalation: { enabled: false, afterFailures: null, channel: null },
      description: '',
      active: true,
    }));
  });
});
