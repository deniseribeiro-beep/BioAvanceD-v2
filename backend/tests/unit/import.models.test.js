import { describe, it, expect } from 'vitest';

const ImportJob = require('../../src/models/ImportJob');
const StagingImport = require('../../src/models/StagingImport');

describe('ImportJob', () => {
  it('valida dataType e arquivo obrigatórios', () => {
    const result = ImportJob.validate({});

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Tipo de dados (dataType) é obrigatório',
      'Arquivo (filePath ou fileName) é obrigatório',
    ]));
  });

  it('aceita job para patients com fileName', () => {
    const result = ImportJob.validate({
      dataType: 'patients',
      fileName: 'patients.csv',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('cria job com defaults e serializa sem campos internos extras', () => {
    const job = ImportJob.create({
      jobID: 'job-1',
      userID: 'user-1',
      dataType: 'samples',
      fileName: 'samples.csv',
      totalRecords: 10,
      successCount: 8,
      errorCount: 2,
      metadata: { source: 'QA' },
    });

    const json = job.toJSON();

    expect(job.status).toBe('pending');
    expect(job.progress).toBe(0);
    expect(json.jobID).toBe('job-1');
    expect(json.fileName).toBe('samples.csv');
    expect(json.metadata).toEqual({ source: 'QA' });
    expect(json.startedAt).toBeNull();
    expect(json.completedAt).toBeNull();
  });
});

describe('StagingImport', () => {
  it('cria documento com status staged por padrão', () => {
    const staging = new StagingImport({
      jobId: 'job-1',
      fileName: 'import.csv',
      rawData: [{ a: 1 }],
    });

    expect(staging.status).toBe('staged');
    expect(staging.totalRows).toBe(0);
    expect(staging.processedRows).toBe(0);
    expect(staging.importErrors).toEqual([]);
  });

  it('valida status inválido no schema', () => {
    const staging = new StagingImport({
      jobId: 'job-1',
      fileName: 'import.csv',
      status: 'invalid',
      rawData: [{ a: 1 }],
    });

    const validationError = staging.validateSync();
    expect(validationError).toBeDefined();
    expect(validationError.errors.status).toBeDefined();
  });
});
