import { describe, expect, it } from 'vitest';

const AccessRequestModel = require('../../src/models/AccessRequest');
const IngestionQuarantineRecordModel = require('../../src/models/IngestionQuarantineRecord');
const MedicationExposureModel = require('../../src/models/MedicationExposure');
const OmicsRunModel = require('../../src/models/OmicsRun');
const OrganizationModel = require('../../src/models/Organization');
const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
const ProtocolModel = require('../../src/models/Protocol');
const QuarantineActionModel = require('../../src/models/QuarantineAction');
const ReagentLotModel = require('../../src/models/ReagentLot');
const ReportTemplateModel = require('../../src/models/ReportTemplate');

describe('simple domain-model residual branches for item 8', () => {
  it('covers AccessRequest invalid item shape and approval-period end validation', () => {
    const base = {
      requesterId: 'user-1',
      studyId: 'study-1',
      requestedPurpose: 'research',
      requestedItems: [{ itemType: 'specimen', itemId: 'S1' }],
    };

    const invalidItem = AccessRequestModel.validate({
      ...base,
      requestedItems: [null],
    });
    expect(invalidItem.errors).toContain('requestedItems[0] deve ser um objeto');

    const invalidEnd = AccessRequestModel.validateDecision({
      status: 'approved',
      justification: 'approved',
      approvalPeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: 'not-a-date',
      },
    });
    expect(invalidEnd.errors).toContain('approvalPeriod.end deve ser uma data válida quando informado');
  });

  it('covers explicit IngestionQuarantineRecord detected/resolved dates', () => {
    const doc = IngestionQuarantineRecordModel.create({
      ingestionQuarantineRecordId: 'q-1',
      entityType: 'Specimen',
      sourceRecordId: 'row-1',
      idempotencyKey: 'key-1',
      payload: false,
      violations: ['invalid'],
      severity: 'fatal',
      provenance: { source: 'test' },
      resolutionStatus: 'closed',
      detectedAt: '2026-01-01T00:00:00.000Z',
      resolvedAt: '2026-01-02T00:00:00.000Z',
      resolvedBy: 'Actor/1',
      resolutionNotes: 'fixed',
    });

    expect(doc.payload).toBe(false);
    expect(doc.detectedAt).toBeInstanceOf(Date);
    expect(doc.resolvedAt).toBeInstanceOf(Date);
    expect(doc.resolutionStatus).toBe('closed');
  });

  it('covers MedicationExposure medication-period start/end conversion branches', () => {
    const fields = MedicationExposureModel.fieldsOf({
      medicationCoding: [{ systemUri: 'urn:atc', code: 'A01' }],
      recordType: 'prescribed',
      medicationStatus: 'active',
      medicationPeriod: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z',
      },
    });

    expect(fields.medicationPeriod.start).toBeInstanceOf(Date);
    expect(fields.medicationPeriod.end).toBeInstanceOf(Date);

    const emptyPeriod = MedicationExposureModel.fieldsOf({
      medicationPeriod: {},
    });
    expect(emptyPeriod.medicationPeriod).toEqual({ start: null, end: null });
  });

  it('covers OmicsRun non-array fileLinks and missing link field validation branches', () => {
    expect(OmicsRunModel.validate({
      modality: 'genomics',
      fileLinks: 'not-array',
    }).errors).toContain('fileLinks deve ser um array');

    const invalidLinks = OmicsRunModel.validate({
      modality: 'genomics',
      fileLinks: [
        null,
        { role: '', fileId: 'F1' },
        { role: 'raw', fileId: '' },
      ],
    });
    expect(invalidLinks.errors).toEqual(expect.arrayContaining([
      'fileLinks[0] deve ser um objeto',
      'fileLinks[1].role é obrigatório',
      'fileLinks[2].fileId é obrigatório',
    ]));
  });

  it('covers Organization empty normalization and too-short name branch', () => {
    expect(OrganizationModel.normalizeName()).toBe('');

    const result = OrganizationModel.validate({
      officialName: 'A',
      countryCode: 'BR',
    });
    expect(result.errors).toContain('officialName deve ter ao menos 2 caracteres');
  });

  it('covers ParticipantIdentity empty participant and explicit identity fields', () => {
    expect(ParticipantIdentityModel.fieldsOf().participantId).toBe('');
    expect(() => ParticipantIdentityModel.create()).toThrow('participantId é obrigatório');

    const fields = ParticipantIdentityModel.fieldsOf({
      participantId: ' P1 ',
      patientName: ' Person ',
      birthDate: '2000-01-01',
      identityDocument: ' DOC ',
      email: ' USER@EXAMPLE.COM ',
      phone: '123',
      representativeName: 'Rep',
      representativeEmail: 'rep@example.com',
      representativeIdentityDocument: 'RDOC',
      representativePhone: '456',
    });
    expect(fields).toEqual(expect.objectContaining({
      participantId: 'P1',
      patientName: 'Person',
      identityDocument: 'DOC',
      email: 'user@example.com',
      phone: '123',
      representativeName: 'Rep',
    }));
    expect(fields.birthDate).toBeInstanceOf(Date);
  });

  it('covers Protocol invalid start and invalid/ordered end branches', () => {
    expect(ProtocolModel.validate({
      protocolId: 'P1',
      protocolName: 'Protocol',
      effectivePeriod: {},
    }).errors).toContain('effectivePeriod.start é obrigatório e deve ser uma data válida');

    expect(ProtocolModel.validate({
      protocolId: 'P1',
      protocolName: 'Protocol',
      effectivePeriod: {
        start: '2026-01-01',
        end: 'not-a-date',
      },
    }).errors).toContain('effectivePeriod.end deve ser uma data válida');

    expect(ProtocolModel.validate({
      protocolId: 'P1',
      protocolName: 'Protocol',
      effectivePeriod: {
        start: '2026-02-01',
        end: '2026-01-01',
      },
    }).errors).toContain('effectivePeriod.end não pode ser anterior a effectivePeriod.start');
  });

  it('covers QuarantineAction scalar specimen and release default timestamp branches', () => {
    const fields = QuarantineActionModel.fieldsOf({
      specimenIds: 'S1',
      actionStatus: 'ACTIVE',
    });
    expect(fields.specimenIds).toEqual(['S1']);
    expect(fields.actionStatus).toBe('active');

    const released = QuarantineActionModel.release({ actionStatus: 'active' });
    expect(released.actionStatus).toBe('released');
    expect(released.releasedAt).toBeInstanceOf(Date);
  });

  it('covers ReagentLot optional-type errors', () => {
    const result = ReagentLotModel.validate({
      reagentName: 'R',
      lotNumber: 'L1',
      manufacturer: 1,
      catalogNumber: 2,
      expirationDate: '2026-01-01',
      storageCondition: 3,
    });

    expect(result.errors).toEqual(expect.arrayContaining([
      'manufacturer deve ser string',
      'catalogNumber deve ser string',
      'storageCondition deve ser string',
    ]));
  });

  it('covers ReportTemplate handlerOptions fallback and invalid template status', () => {
    const fields = ReportTemplateModel.fieldsOf({
      code: 'report',
      name: 'Report',
      handlerKey: 'patient',
      handlerOptions: 'not-object',
    });
    expect(fields.handlerOptions).toEqual({});

    const result = ReportTemplateModel.validate({
      code: 'report',
      name: 'Report',
      handlerKey: 'patient',
      templateStatus: 'unknown',
    });
    expect(result.errors).toContain('templateStatus inválido: unknown');
  });
});
