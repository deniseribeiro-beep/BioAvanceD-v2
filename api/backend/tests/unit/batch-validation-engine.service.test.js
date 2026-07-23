import { afterEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');

const batchValidationEngine = require('../../src/services/batch-validation-engine.service');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const StagingImport = require('../../src/models/StagingImport');

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
        biomarkers: 'alphaGal:12.5',
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

    expect(result.classification).toBe('PARTIAL');
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
        biomarkers: 'lysoGb3:4.2',
      },
      3
    );

    expect(createPatientSpy).toHaveBeenCalledTimes(1);
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe('PARTIAL');
    expect(result.persistedIds).toContain('patient-object-id-2');
    expect(result.persistedIds).toContain('sample-object-id-2');
  });

  it('returns INVALID when required sample fields are missing', async () => {
    const db = createDb();
    const result = await batchValidationEngine.persistSample(db, {}, 4);

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('sampleType é obrigatório');
    expect(result.errors).toContain('sampleOrigin é obrigatório');
    expect(result.errors).toContain('quantity deve ser um número maior que zero');
  });

  it('returns INVALID when disease text is given without a structured ORPHA code', async () => {
    const db = createDb();
    const result = await batchValidationEngine.persistSample(
      db,
      {
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
        disease: 'Doença de Fabry',
      },
      6
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('Doenca informada sem codigo ORPHA estruturado (campo orpha/orphaCode).');
  });

  it('returns INVALID when no patient links and the row lacks enough data to create one', async () => {
    const db = createDb();
    const createPatientSpy = vi.spyOn(patientService, 'createPatient');

    const result = await batchValidationEngine.persistSample(
      db,
      {
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      7
    );

    expect(createPatientSpy).not.toHaveBeenCalled();
    expect(result.classification).toBe('INVALID');
    expect(result.errors[0]).toMatch(/Paciente não encontrado/);
  });

  it('returns INVALID with the thrown error message when createSample rejects', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-3', patientID: '12345678' },
    });

    vi.spyOn(sampleService, 'createSample').mockRejectedValue(new Error('storage collision'));

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      8
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['storage collision']);
  });

  it('returns INVALID with a fallback message when the persist step throws a non-Error value', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-4', patientID: '12345678' },
    });

    vi.spyOn(sampleService, 'createSample').mockRejectedValue('a plain string rejection');

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      9
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['Erro ao processar follow-up clínico']);
  });
});

describe('batch-validation-engine.service processBatchImport', () => {
  let tmpDir;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  function writeTmpFile(fileName, content) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-import-'));
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('throws when no StagingImport document is found for the jobId', async () => {
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue(null);

    await expect(batchValidationEngine.processBatchImport({}, 'missing-job')).rejects.toThrow(
      'StagingImport não encontrado para jobId missing-job'
    );
  });

  it('throws when the staged file no longer exists on disk', async () => {
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-1',
      fileName: 'rows.json',
      rawData: { storagePath: '/nonexistent/path/rows.json' },
    });

    await expect(batchValidationEngine.processBatchImport({}, 'job-1')).rejects.toThrow(
      'Arquivo bruto do staging não encontrado'
    );
  });

  it('throws when the file contains no rows', async () => {
    const filePath = writeTmpFile('empty.json', JSON.stringify([]));
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-2',
      fileName: 'empty.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    await expect(batchValidationEngine.processBatchImport({}, 'job-2')).rejects.toThrow(
      'Arquivo não contém registros válidos para processar'
    );
  });

  it('processes a patients JSON file end to end, mixing VALID and INVALID rows', async () => {
    const filePath = writeTmpFile('patients.json', JSON.stringify([
      {
        patientName: 'Ana Silva',
        birthDate: '1990-05-01',
        sex: 'F',
        email: 'ana@example.com',
        consentTemplateId: 'template-1',
      },
      { patientName: 'Sem Dados' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-3',
      fileName: 'patients.json',
      rawData: { storagePath: filePath },
    });
    const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const result = await batchValidationEngine.processBatchImport({}, 'job-3');

    expect(result.dataType).toBe('patients');
    expect(result.totalRows).toBe(2);
    expect(result.processedRows).toBe(2);
    // "Ana Silva" row is missing optional fields (phone/recordNumber/etc.), so
    // classifyPatientRow attaches warnings and it lands PARTIAL rather than VALID.
    expect(result.partialRows).toBe(1);
    expect(result.invalidRows).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.persistedIds).toEqual(['new-patient-id']);

    const finalUpdateCall = updateOneSpy.mock.calls.find(
      ([, update]) => update.$set?.status === 'completed'
    );
    expect(finalUpdateCall).toBeTruthy();
  });

  it('marks the job failed when every row is invalid', async () => {
    const filePath = writeTmpFile('patients-invalid.json', JSON.stringify([
      { patientName: 'Sem Dados' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-4',
      fileName: 'patients-invalid.json',
      rawData: { storagePath: filePath },
    });
    const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    const result = await batchValidationEngine.processBatchImport({}, 'job-4');

    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);

    const finalUpdateCall = updateOneSpy.mock.calls.find(
      ([, update]) => update.$set?.status === 'failed'
    );
    expect(finalUpdateCall).toBeTruthy();
  });

  it('reports progress via job.updateProgress when a job is supplied', async () => {
    const filePath = writeTmpFile('patients-progress.json', JSON.stringify([
      {
        patientName: 'Ana Silva',
        birthDate: '1990-05-01',
        sex: 'F',
        email: 'ana@example.com',
        consentTemplateId: 'template-1',
      },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-5',
      fileName: 'patients-progress.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const updateProgress = vi.fn().mockResolvedValue();
    await batchValidationEngine.processBatchImport({}, 'job-5', { updateProgress });

    expect(updateProgress).toHaveBeenCalledWith(100);
  });

  it('processes a samples JSON file end to end with a fully-valid, warning-free row', async () => {
    const filePath = writeTmpFile('samples.json', JSON.stringify([
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo A',
        quantity: '1',
      },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-6',
      fileName: 'samples.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-5', patientID: '12345678' },
    });
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-object-id-5' });

    const result = await batchValidationEngine.processBatchImport(db, 'job-6');

    expect(result.dataType).toBe('samples');
    expect(result.validRows).toBe(1);
    expect(result.partialRows).toBe(0);
    expect(result.invalidRows).toBe(0);
  });
});