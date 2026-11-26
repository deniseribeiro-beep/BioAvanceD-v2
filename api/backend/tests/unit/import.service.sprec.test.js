import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const importService = require('../../src/services/import.service');
const sampleCollectionGate = require('../../src/services/sample-collection-gate.service');

describe('ImportService SPREC import', () => {
  let db;
  let tempDir;
  let samplesCollection;

  beforeEach(() => {
    // RF004 AC2 (#1538): these cases are about SPREC; the collection gate admits each row.
    vi.spyOn(sampleCollectionGate, 'assertSampleCollectionAdmits').mockResolvedValue(null);
    tempDir =fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-import-'));

    samplesCollection = {
      findOne: vi.fn().mockResolvedValue(null),
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
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,2026-01-01,Projeto QA,fluid,BLD,PED,C,A,D,E,F',
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
    expect(inserted.participantId).toBe('12345678');
    expect(inserted.sprec.sampleType).toBe('BLD');
    expect(inserted.sprec.primaryContainer).toBe('PED');
  });

  it('importa XLSX fake com colunas SPREC', async () => {
    const xlsxPath = path.join(tempDir, 'samples.xlsx');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Samples');
    sheet.addRow([
      'participantId',
      'sampleType',
      'sampleOrigin',
      'extractionProtocol',
      'quantity',
      'quality',
      'registeredAt',
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
    expect(inserted.participantId).toBe('87654321');
    expect(inserted.sprec.sampleType).toBe('SER');
    expect(inserted.sprec.primaryContainer).toBe('SST');
  });

  it('mapeia a ontologia SPREC completa preservando os 7 eixos', async () => {
    const csvPath = path.join(tempDir, 'samples-sprec-complete.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,consentTemplateId,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '11223344,PLASMA,VENOUS_BLOOD,TUBE_EDTA,2.5,GOOD,2026-03-03,Projeto Ontologia,tcle-ontology-1,fluid,BLD,PED,A,B,C,D,E',
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
      primaryContainer: 'PED',
      preCentrifugation: 'A',
      centrifugation: 'B',
      secondCentrifugation: 'C',
      postCentrifugationDelay: 'D',
      longTermStorage: 'E',
    });
    expect(inserted.consentTemplateId).toBe('tcle-ontology-1');
  });

  it('preserva quality_score/category externos como sugestão não canônica', async () => {
    const csvPath = path.join(tempDir, 'samples-external-quality.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,quality_score,quality_category,registeredAt,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,100,A,2026-01-01,Projeto QA,fluid,BLD,PED,X,A,A,A,C',
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-external-quality.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    const inserted = samplesCollection.insertOne.mock.calls[0][0];
    expect(inserted.rcsScore).toBeNull();
    expect(inserted.scoreBasedGrade).toBe('');
    expect(inserted.externalQualityAssessment).toMatchObject({
      score: 100,
      category: 'A',
      source: 'external-import',
      canonical: false,
    });
  });

  it('records a referenced RcsAssessment snapshot for the imported specimen (#383)', async () => {
    const rcsAssessmentsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'assessment-1' }),
    };
    db.collection = (name) => {
      if (name === 'samples') return samplesCollection;
      if (name === 'rcsAssessments') return rcsAssessmentsCollection;
      // #1320: recordAssessment first freezes the RCS input in its own collection.
      if (name === 'rcsInputSnapshots') return { insertOne: vi.fn().mockResolvedValue({ insertedId: 'snapshot-1' }), deleteOne: vi.fn() };
      if (name === 'rcsGovernanceEvidenceSnapshots') return { insertOne: vi.fn().mockResolvedValue({ insertedId: 'evidence-1' }), deleteOne: vi.fn() };
      throw new Error(`Unexpected collection name: ${name}`);
    };

  const csvPath = path.join(tempDir, 'samples-rcs-assessment.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,2026-01-01,Projeto QA,fluid,BLD,PED,C,A,D,E,F',
    ].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-rcs-assessment.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    expect(rcsAssessmentsCollection.insertOne).toHaveBeenCalledTimes(1);

    const insertedSample = samplesCollection.insertOne.mock.calls[0][0];
    const recorded = rcsAssessmentsCollection.insertOne.mock.calls[0][0];
    expect(recorded.specimenId).toBe(insertedSample.specimenId);
    expect(recorded.calculationTrace).toEqual(insertedSample.calculationTrace);
  });

  it('records a referenced SpecimenPreanalytics snapshot for the imported specimen (#388)', async () => {
    const specimenPreanalyticsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'profile-1' }),
    };
    db.collection = (name) => {
      if (name === 'samples') return samplesCollection;
      if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
      throw new Error(`Unexpected collection name: ${name}`);
    };

    const csvPath = path.join(tempDir, 'samples-sprec-profile.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,2026-01-01,Projeto QA,fluid,BLD,PED,C,A,D,E,F',
    ].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-sprec-profile.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    expect(specimenPreanalyticsCollection.insertOne).toHaveBeenCalledTimes(1);

    const insertedSample = samplesCollection.insertOne.mock.calls[0][0];
    const recorded = specimenPreanalyticsCollection.insertOne.mock.calls[0][0];
    expect(recorded.specimenId).toBe(insertedSample.specimenId);
    expect(recorded.sampleType).toBe(insertedSample.sprec.sampleType);
    expect(recorded.primaryContainer).toBe(insertedSample.sprec.primaryContainer);
  });

  it('parses sprec_code/sprec_version (ELM-0145/0146) and records dict-02\'s fuller canonical field set (#392)', async () => {
    const specimenPreanalyticsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'profile-2' }),
    };
    db.collection = (name) => {
      if (name === 'samples') return samplesCollection;
      if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
      throw new Error(`Unexpected collection name: ${name}`);
    };

    const csvPath = path.join(tempDir, 'samples-sprec-canonical-fluid.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,'
        + 'sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,'
        + 'sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage,sprec_code,sprec_version',
      '12345678,PLASMA,VENOUS_BLOOD,TUBE_EDTA,1.5,GOOD,2026-01-01,Projeto QA,'
        + 'fluid,BLD,PED,C,A,D,E,F,BLD-PED-C-A-D-E-F,2.0',
    ].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-sprec-canonical-fluid.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    const recorded = specimenPreanalyticsCollection.insertOne.mock.calls[0][0];

    expect(recorded.sprecCode).toBe('BLD-PED-C-A-D-E-F');
    expect(recorded.sprecVersion).toBe('2.0');
    expect(recorded.sprecProfileId).toEqual(expect.any(String));
    expect(recorded.sprecProfileId.length).toBeGreaterThan(0);
    expect(recorded.profileStatus).toBe('draft');
    expect(recorded.sprecSpecimenType).toBe('BLD');
    expect(recorded.sprecPrimaryContainer).toBe('PED');
    expect(recorded.sprecCollectionType).toBeNull();
    expect(recorded.warmIschemiaTime).toBeNull();
    expect(recorded.coldIschemiaTime).toBeNull();
    expect(recorded.fixationStabilizationType).toBeNull();
    expect(recorded.fixationTime).toBeNull();
  });

  it('derives the solid-matrix canonical fields (ELM-0149, 0154-0157) from the same positional columns when matrixType is solid (#392)', async () => {
    const specimenPreanalyticsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'profile-3' }),
    };
    db.collection = (name) => {
      if (name === 'samples') return samplesCollection;
      if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
      throw new Error(`Unexpected collection name: ${name}`);
    };

    const csvPath = path.join(tempDir, 'samples-sprec-canonical-solid.csv');
    const csvContent = [
      'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,registeredAt,linkedProject,'
        + 'sprec_matrix_type,sprec_sample_type,sprec_primary_container,sprec_pre_centrifugation,sprec_centrifugation,'
        + 'sprec_second_centrifugation,sprec_post_centrifugation_delay,sprec_long_term_storage',
      '87654321,TISSUE_FRESH,VENOUS_BLOOD,TUBE_EDTA,1.0,GOOD,2026-01-01,Projeto QA,'
        + 'solid,TIS,BPS,B,C,NBF,D,G',
    ].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');

    const result = await importService.importSamples(db, {
      originalname: 'samples-sprec-canonical-solid.csv',
      mimetype: 'text/csv',
      path: csvPath,
    });

    expect(result.success).toBe(1);
    const recorded = specimenPreanalyticsCollection.insertOne.mock.calls[0][0];

    expect(recorded.sprecSpecimenType).toBe('TIS');
    expect(recorded.sprecCollectionType).toBe('BPS');
    expect(recorded.sprecPrimaryContainer).toBeNull();
    expect(recorded.warmIschemiaTime).toBe('B');
    expect(recorded.coldIschemiaTime).toBe('C');
    expect(recorded.fixationStabilizationType).toBe('NBF');
    expect(recorded.fixationTime).toBe('D');
  });
});
