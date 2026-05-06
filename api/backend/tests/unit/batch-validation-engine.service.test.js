import { afterEach, describe, expect, it, vi } from 'vitest';

const batchValidationEngine = require('../../src/services/batch-validation-engine.service');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');

function createDb(patientsByFilter = {}) {
  return {
    collection(name) {
      if (name !== 'patients') {
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }

      return {
        findOne: vi.fn(async (filter) => {
          if (filter.patientID && patientsByFilter.patientID === filter.patientID) {
            return patientsByFilter.patient;
          }

          if (filter.cpf && patientsByFilter.cpf === filter.cpf) {
            return patientsByFilter.patient;
          }

          if (filter.recordNumber && patientsByFilter.recordNumber === filter.recordNumber) {
            return patientsByFilter.patient;
          }

          if (filter._id && patientsByFilter._id === String(filter._id)) {
            return patientsByFilter.patient;
          }

          return null;
        }),
      };
    },
  };
}

describe('batch-validation-engine.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifica arquivo híbrido como samples quando existem marcadores de amostra', () => {
    const result = batchValidationEngine.detectDataType(
      [{ patientName: 'Paciente QA', sampleType: 'Sangue' }],
      'mixed-import.csv'
    );

    expect(result).toBe('samples');
  });

  it('reutiliza paciente existente e persiste specimen e biomarcadores vinculados', async () => {
    const patient = {
      _id: 'patient-object-id-1',
      patientID: '12345678',
      cpf: '12345678901',
      recordNumber: 'RN-001',
    };

    const db = createDb({
      patientID: '12345678',
      patient,
    });

    const createPatientSpy = vi.spyOn(patientService, 'createPatient');
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-1',
      sampleID: 'sample-001',
    });
    const createObservationSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({
      _id: 'observation-object-id-1',
    });

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo A',
        locationID: 'freezer-a1',
        quantity: '1',
        quality: '1',
        alphaGal: '12.5',
        registrationDate: '2026-03-19T10:00:00.000Z',
      },
      2
    );

    expect(createPatientSpy).not.toHaveBeenCalled();
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(createSampleSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        patientID: '12345678',
        patientObjectId: 'patient-object-id-1',
      }),
      expect.objectContaining({
        batchImport: true,
        source: 'batch-import',
      })
    );
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(createObservationSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        patientID: '12345678',
        patientObjectId: 'patient-object-id-1',
        specimenObjectId: 'sample-object-id-1',
        linkedResourceId: 'patient-object-id-1',
      })
    );

    expect(result.classification).toBe('VALID');
    expect(result.persistedIds).toEqual([
      'patient-object-id-1',
      'sample-object-id-1',
      'observation-object-id-1',
    ]);
  });

  it('cria paciente quando a linha de amostra traz dados suficientes e não encontra linkage', async () => {
    const db = createDb();

    const createPatientSpy = vi.spyOn(patientService, 'createPatient').mockResolvedValue({
      _id: 'patient-object-id-2',
      patientID: '87654321',
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-2',
      sampleID: 'sample-002',
    });
    const createObservationSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({
      _id: 'observation-object-id-2',
    });

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientName: 'Paciente Novo',
        birthDate: '1990-01-01',
        sex: 'F',
        email: 'paciente.novo@example.com',
        consentTemplateId: 'template-1',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo B',
        locationID: 'freezer-b1',
        quantity: '1',
        quality: '1',
        lysoGb3: '4.2',
      },
      3
    );

    expect(createPatientSpy).toHaveBeenCalledTimes(1);
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe('VALID');
    expect(result.persistedIds).toContain('patient-object-id-2');
    expect(result.persistedIds).toContain('sample-object-id-2');
  });
});