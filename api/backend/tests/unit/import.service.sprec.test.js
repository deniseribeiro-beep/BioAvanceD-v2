import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const importService = require('../../src/services/import.service');

describe('ImportService SPREC import', () => {
  let db;
  let tempDir;
  let samplesCollection;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-import-'));

    samplesCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'samples' }]),
      }),
      collection: (name) => {
        if (name === 'samples') return samplesCollection;
        throw new Error(`Unexpected collection name: ${name}`);
      },
    };

    vi.spyOn(SampleGraphValidator.prototype, 'validateSampleCompliance').mockResolvedValue({
      suggestedStatus: 'AVAILABLE',
      graphPath: {
        ethics: { valid: true },
        quality: { valid: true },
        clinical: { valid: true },
        integrity: { valid: true },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('importa CSV fake com colunas SPREC', async () => {
    const csvPath = path.join(tempDir, 'samples.csv');
    const csvContent = [
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registerDate,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,2026-01-01,Projeto QA,fluid,BLD,EDTA,C,A,D,E,F',
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);

    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.patientID).toBe('12345678');
    expect(inserted.sprec.sampleType).toBe('BLD');
    expect(inserted.sprec.primaryContainer).toBe('EDTA');
  });

  it('importa XLSX fake com colunas SPREC', async () => {
    const xlsxPath = path.join(tempDir, 'samples.xlsx');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Samples');
    sheet.addRow([
      'patientID',
      'sampleType',
      'sampleOrigin',
      'extractionProtocol',
      'quantity',
      'quality',
      'registerDate',
      'linkedProject',
      'sprec_matrix_type',
      'sprec_sample_type',
      'sprec_primary_container',
      'sprec_pre_centrifugation',
      'sprec_centrifugation',
      'sprec_second_centrifugation',
      'sprec_post_centrifugation_delay',
      'sprec_long_term_storage',
    ]);
    sheet.addRow([
      '87654321',
      'PLASMA',
      'VENOUS_BLOOD',
      'TUBE_EDTA',
      '2.0',
      'GOOD',
      '2026-02-02',
      'Projeto QA',
      'fluid',
      'SER',
      'SST',
      'B',
      'A',
      'C',
      'D',
      'E',
    ]);

    await workbook.xlsx.writeFile(xlsxPath);

    const result = await importService.importSamples(db, {
      originalname: 'samples.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      path: xlsxPath,
    });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);

    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.patientID).toBe('87654321');
    expect(inserted.sprec.sampleType).toBe('SER');
    expect(inserted.sprec.primaryContainer).toBe('SST');
  });

  it('mapeia a ontologia SPREC completa preservando os 7 eixos', async () => {
    const csvPath = path.join(tempDir, 'samples-sprec-complete.csv');
    const csvContent = [
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registerDate,linkedProject,tcle_id,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '11223344,PLASMA,VENOUS_BLOOD,TUBE_EDTA,2.5,GOOD,2026-03-03,Projeto Ontologia,tcle-ontology-1,fluid,BLD,EDTA,A,B,C,D,E',
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-sprec-complete.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);

    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.sprec).toMatchObject({
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'EDTA',
      preCentrifugation: 'A',
      centrifugation: 'B',
      secondCentrifugation: 'C',
      postCentrifugationDelay: 'D',
      longTermStorage: 'E',
    });
    expect(inserted.tcle_id).toBe('tcle-ontology-1');
    expect(inserted.release_status).toBe('AVAILABLE');
  });

  it('preserva quality_score/category externos como sugestão não canônica', async () => {
    const csvPath = path.join(tempDir, 'samples-external-quality.csv');
    const csvContent = [
      'patientID,sampleType,sampleOrigin,extractionProtocol,quantity,quality,quality_score,quality_category,registerDate,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,100,A,2026-01-01,Projeto QA,fluid,BLD,EDTA,X,A,A,A,cryogenic_or_ultralow_workflow_appropriate',
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-external-quality.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.quality_score).toBeNull();
    expect(inserted.quality_category).toBe('C');
    expect(inserted.release_status).toBe('QUARANTINE');
    expect(inserted.external_quality_assessment).toMatchObject({
      score: 100,
      category: 'A',
      source: 'external-import',
      canonical: false,
    });
  });
});
