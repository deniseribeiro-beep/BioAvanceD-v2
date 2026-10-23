import { describe, it, expect } from 'vitest';

const SampleFileModel = require('../../src/models/SampleFile');

describe('SampleFileModel.validate', () => {
  const validData = {
    sampleID: 'sample-1',
    fileName: 'result.csv',
    fileType: 'CSV',
    storagePath: '/storage/result.csv',
    fileSize: 100
  };

  it('accepts fully valid data', () => {
    const { isValid, errors } = SampleFileModel.validate(validData);
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects missing sampleID', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, sampleID: undefined });
    expect(isValid).toBe(false);
    expect(errors).toContain('sampleID é obrigatório');
  });

  it('rejects missing fileName', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileName: undefined });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileName é obrigatório e deve ser string');
  });

  it('rejects non-string fileName', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileName: 123 });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileName é obrigatório e deve ser string');
  });

  it('rejects missing fileType', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileType: undefined });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileType é obrigatório e deve ser string');
  });

  it('rejects a truthy non-string fileType (e.g. a number) instead of throwing', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileType: 42 });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileType é obrigatório e deve ser string');
  });

  it('rejects missing storagePath', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, storagePath: undefined });
    expect(isValid).toBe(false);
    expect(errors).toContain('storagePath é obrigatório e deve ser string');
  });

  it('rejects non-string storagePath', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, storagePath: 999 });
    expect(isValid).toBe(false);
    expect(errors).toContain('storagePath é obrigatório e deve ser string');
  });

  it('rejects missing fileSize (undefined)', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileSize: undefined });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileSize é obrigatório');
  });

  it('rejects null fileSize', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileSize: null });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileSize é obrigatório');
  });

  it('rejects zero fileSize', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileSize: 0 });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileSize deve ser um número maior que zero');
  });

  it('rejects negative fileSize', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileSize: -50 });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileSize deve ser um número maior que zero');
  });

  it('rejects non-number fileSize', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileSize: '100' });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileSize deve ser um número maior que zero');
  });

  it('rejects unsupported fileType', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileType: 'DOC' });
    expect(isValid).toBe(false);
    expect(errors).toContain('fileType deve ser um dos: RAW, ZIP, CSV, XLS, XLSX, PDF, TXT');
  });

  it('accepts fileType regardless of case (lowercase csv)', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileType: 'csv' });
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accumulates multiple errors when several fields are invalid', () => {
    const { isValid, errors } = SampleFileModel.validate({});
    expect(isValid).toBe(false);
    // sampleID, fileName, fileType, storagePath, fileSize all missing
    expect(errors.length).toBe(5);
  });

  it('accepts a valid fileRole (dict-02 ELM-0317)', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileRole: 'processed' });
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an unsupported fileRole', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, fileRole: 'bogus' });
    expect(isValid).toBe(false);
    expect(errors).toContain(
      'fileRole deve ser um dos: raw, intermediate, processed, derived, report, manifest'
    );
  });

  it('does not require fileRole (omitting it is valid, unlike fileType)', () => {
    const { isValid, errors } = SampleFileModel.validate(validData);
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects a non-string storageObjectVersion (V2E-0472, #1321)', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, storageObjectVersion: 42 });
    expect(isValid).toBe(false);
    expect(errors).toContain('storageObjectVersion deve ser string não vazia');
  });

  // RF007 AC3/AC5, V2E-0471/V2E-0476 (#1321): optional, since older rows
  // lack them, but a supplied value is well formed.
  it('accepts a row with no mimeType, ownerId or linkedEntityRefs (V2E-0471, V2E-0476, #1321)', () => {
    const { isValid, errors } = SampleFileModel.validate(validData);
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a well-formed mimeType and linkedEntityRefs (#1321)', () => {
    const { isValid, errors } = SampleFileModel.validate({
      ...validData,
      mimeType: 'text/csv',
      linkedEntityRefs: [{ entityType: 'Specimen', entityId: 's-1' }, { entityType: 'Study', entityId: 'st-1' }]
    });
    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
  });

  it.each([['not a mime'], ['text/'], ['Text/CSV'], [42]])('rejects a malformed mimeType %j (V2E-0471, #1321)', (mimeType) => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, mimeType });
    expect(isValid).toBe(false);
    expect(errors).toContain('mimeType deve ser um tipo MIME válido');
  });

  it('rejects an empty linkedEntityRefs (V2E-0476 is 1..*, #1321)', () => {
    const { isValid, errors } = SampleFileModel.validate({ ...validData, linkedEntityRefs: [] });
    expect(isValid).toBe(false);
    expect(errors).toContain('linkedEntityRefs deve ser uma lista não vazia');
  });

  it('rejects a linkedEntityRefs entry with an unknown entityType (#1321)', () => {
    const { isValid, errors } = SampleFileModel.validate({
      ...validData,
      linkedEntityRefs: [{ entityType: 'Patient', entityId: 'p-1' }]
    });
    expect(isValid).toBe(false);
    expect(errors).toContain(`linkedEntityRefs[0].entityType deve ser um dos: ${SampleFileModel.LINKED_ENTITY_TYPES.join(', ')}`);
  });

  it('rejects a linkedEntityRefs entry with an empty entityId (#1321)', () => {
    const { isValid, errors } = SampleFileModel.validate({
      ...validData,
      linkedEntityRefs: [{ entityType: 'Specimen', entityId: 's-1' }, { entityType: 'Study', entityId: '' }]
    });
    expect(isValid).toBe(false);
    expect(errors).toContain('linkedEntityRefs[1].entityId deve ser string não vazia');
  });
});

describe('SampleFileModel.create', () => {
  const baseInput = {
    sampleID: 'sample-1',
    fileName: 'result.csv',
    fileType: 'csv',
    fileSize: 100,
    storagePath: '/storage/result.csv'
  };

  it('builds a normalized object with uppercased fileType', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.fileType).toBe('CSV');
    expect(result.sampleID).toBe('sample-1');
    expect(result.fileName).toBe('result.csv');
    expect(result.fileSize).toBe(100);
    expect(result.storagePath).toBe('/storage/result.csv');
  });

  it('carries storageObjectVersion beside storageUri (V2E-0472, #1321)', () => {
    const version = `sha256:${'c'.repeat(64)}`;
    const result = SampleFileModel.create({ ...baseInput, storageObjectVersion: version });
    expect(result.storageObjectVersion).toBe(version);
    expect(SampleFileModel.create(baseInput).storageObjectVersion).toBeNull();
  });

  it('carries the malwareScan verdict and defaults it to null (RNF029 C4, #1321)', () => {
    const verdict = { status: 'not-available', scanner: 'none', scannedAt: new Date() };
    expect(SampleFileModel.create({ ...baseInput, malwareScan: verdict }).malwareScan).toEqual(verdict);
    expect(SampleFileModel.create(baseInput).malwareScan).toBeNull();
  });

  // RF007 AC3/AC5, V2E-0471/V2E-0474/V2E-0476 (#1321).
  it('writes mimeType, ownerId and linkedEntityRefs (#1321)', () => {
    const result = SampleFileModel.create({
      ...baseInput,
      mimeType: 'text/csv',
      uploaderAnonId: 'anon-1',
      ownerId: 'owner-1',
      linkedEntityRefs: [{ entityType: 'Specimen', entityId: 's-1', extra: 'x' }, { entityType: 'Study', entityId: 'st-1' }]
    });
    expect(result.mimeType).toBe('text/csv');
    expect(result.ownerId).toBe('owner-1');
    expect(result.linkedEntityRefs).toEqual([
      { entityType: 'Specimen', entityId: 's-1' },
      { entityType: 'Study', entityId: 'st-1' }
    ]);
  });

  it('defaults ownerId to the uploader, mimeType to null and linkedEntityRefs to [] (#1321)', () => {
    const result = SampleFileModel.create({ ...baseInput, uploaderAnonId: 'anon-1' });
    expect(result.ownerId).toBe('anon-1');
    expect(result.mimeType).toBeNull();
    expect(result.linkedEntityRefs).toEqual([]);
    expect(SampleFileModel.create(baseInput).ownerId).toBeNull();
  });

  it('defaults uploaderAnonId to null when not provided', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.uploaderAnonId).toBeNull();
  });

  it('passes through uploaderAnonId when provided', () => {
    const result = SampleFileModel.create({ ...baseInput, uploaderAnonId: 'anon-42' });
    expect(result.uploaderAnonId).toBe('anon-42');
  });

  it('defaults uploadDate/createdAt/updatedAt to Date instances when not provided', () => {
    const before = Date.now();
    const result = SampleFileModel.create(baseInput);
    const after = Date.now();
    expect(result.uploadDate).toBeInstanceOf(Date);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('respects a provided uploadDate instead of defaulting', () => {
    const fixedDate = new Date('2025-01-01T00:00:00Z');
    const result = SampleFileModel.create({ ...baseInput, uploadDate: fixedDate });
    expect(result.uploadDate).toBe(fixedDate);
  });

  it('defaults all HL7 optional fields to null when omitted', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.accessionNumber).toBeNull();
    expect(result.orderNumber).toBeNull();
    expect(result.equipmentID).toBeNull();
    expect(result.collectionDateTime).toBeNull();
    expect(result.processingDateTime).toBeNull();
    expect(result.analysisDateTime).toBeNull();
    expect(result.loincCode).toBeNull();
    expect(result.procedureCode).toBeNull();
    expect(result.equipmentManufacturer).toBeNull();
    expect(result.equipmentModel).toBeNull();
    expect(result.equipmentSerialNumber).toBeNull();
    expect(result.softwareVersion).toBeNull();
    expect(result.resultStatus).toBeNull();
    expect(result.unitOfMeasure).toBeNull();
    expect(result.resultValue).toBeNull();
    expect(result.interpretation).toBeNull();
    expect(result.hl7Version).toBeNull();
    expect(result.messageType).toBeNull();
  });

  it('passes through all HL7 optional string/code fields when provided', () => {
    const input = {
      ...baseInput,
      accessionNumber: 'ACC-1',
      orderNumber: 'ORD-1',
      equipmentID: 'EQ-1',
      loincCode: '12345-6',
      procedureCode: 'PROC-1',
      equipmentManufacturer: 'Acme',
      equipmentModel: 'X100',
      equipmentSerialNumber: 'SN-1',
      softwareVersion: '1.2.3',
      resultStatus: 'F',
      unitOfMeasure: 'mg/dL',
      interpretation: 'N',
      hl7Version: '2.8',
      messageType: 'ORU^R01'
    };
    const result = SampleFileModel.create(input);
    expect(result.accessionNumber).toBe('ACC-1');
    expect(result.orderNumber).toBe('ORD-1');
    expect(result.equipmentID).toBe('EQ-1');
    expect(result.loincCode).toBe('12345-6');
    expect(result.procedureCode).toBe('PROC-1');
    expect(result.equipmentManufacturer).toBe('Acme');
    expect(result.equipmentModel).toBe('X100');
    expect(result.equipmentSerialNumber).toBe('SN-1');
    expect(result.softwareVersion).toBe('1.2.3');
    expect(result.resultStatus).toBe('F');
    expect(result.unitOfMeasure).toBe('mg/dL');
    expect(result.interpretation).toBe('N');
    expect(result.hl7Version).toBe('2.8');
    expect(result.messageType).toBe('ORU^R01');
  });

  it('preserves resultValue of 0 instead of coercing to null (falsy-safe)', () => {
    const result = SampleFileModel.create({ ...baseInput, resultValue: 0 });
    expect(result.resultValue).toBe(0);
  });

  it('passes through a non-zero numeric resultValue', () => {
    const result = SampleFileModel.create({ ...baseInput, resultValue: 7.5 });
    expect(result.resultValue).toBe(7.5);
  });

  it('coerces collectionDateTime string input into a Date instance', () => {
    const result = SampleFileModel.create({ ...baseInput, collectionDateTime: '2025-03-15T10:00:00Z' });
    expect(result.collectionDateTime).toBeInstanceOf(Date);
    expect(result.collectionDateTime.toISOString()).toBe('2025-03-15T10:00:00.000Z');
  });

  it('preserves collectionDateTime when already a Date instance (same reference)', () => {
    const d = new Date('2025-03-15T10:00:00Z');
    const result = SampleFileModel.create({ ...baseInput, collectionDateTime: d });
    expect(result.collectionDateTime).toBe(d);
  });

  it('coerces processingDateTime string input into a Date instance', () => {
    const result = SampleFileModel.create({ ...baseInput, processingDateTime: '2025-04-01T08:30:00Z' });
    expect(result.processingDateTime).toBeInstanceOf(Date);
    expect(result.processingDateTime.toISOString()).toBe('2025-04-01T08:30:00.000Z');
  });

  it('preserves processingDateTime when already a Date instance', () => {
    const d = new Date('2025-04-01T08:30:00Z');
    const result = SampleFileModel.create({ ...baseInput, processingDateTime: d });
    expect(result.processingDateTime).toBe(d);
  });

  it('coerces analysisDateTime string input into a Date instance', () => {
    const result = SampleFileModel.create({ ...baseInput, analysisDateTime: '2025-05-20T12:00:00Z' });
    expect(result.analysisDateTime).toBeInstanceOf(Date);
    expect(result.analysisDateTime.toISOString()).toBe('2025-05-20T12:00:00.000Z');
  });

  it('preserves analysisDateTime when already a Date instance', () => {
    const d = new Date('2025-05-20T12:00:00Z');
    const result = SampleFileModel.create({ ...baseInput, analysisDateTime: d });
    expect(result.analysisDateTime).toBe(d);
  });

  it('leaves the HL7 datetime fields null when omitted (not new Date(null))', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.collectionDateTime).toBeNull();
    expect(result.processingDateTime).toBeNull();
    expect(result.analysisDateTime).toBeNull();
  });

  it('defaults fileRole to "raw" (dict-02 ELM-0317 example value) when not provided', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.fileRole).toBe('raw');
  });

  it('passes through an explicit fileRole', () => {
    const result = SampleFileModel.create({ ...baseInput, fileRole: 'derived' });
    expect(result.fileRole).toBe('derived');
  });

  it('derives fileFormat from fileType when not provided', () => {
    const result = SampleFileModel.create(baseInput);
    expect(result.fileFormat).toBe('text/csv');
  });

  it('passes through an explicit fileFormat instead of deriving one', () => {
    const result = SampleFileModel.create({ ...baseInput, fileFormat: 'text/csv; charset=utf-8' });
    expect(result.fileFormat).toBe('text/csv; charset=utf-8');
  });
});

describe('SampleFileModel.isValidFileType', () => {
  it('returns true for each allowed type in canonical uppercase form', () => {
    ['RAW', 'ZIP', 'CSV', 'XLS', 'XLSX', 'PDF', 'TXT'].forEach((type) => {
      expect(SampleFileModel.isValidFileType(type)).toBe(true);
    });
  });

  it('is case-insensitive (lowercase accepted)', () => {
    expect(SampleFileModel.isValidFileType('csv')).toBe(true);
  });

  it('is case-insensitive (mixed case accepted)', () => {
    expect(SampleFileModel.isValidFileType('PdF')).toBe(true);
  });

  it('returns false for an unsupported type', () => {
    expect(SampleFileModel.isValidFileType('DOC')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(SampleFileModel.isValidFileType('')).toBe(false);
  });
});

describe('SampleFileModel.getFileTypeFromExtension', () => {
  it('maps a simple lowercase extension to its uppercase type constant', () => {
    expect(SampleFileModel.getFileTypeFromExtension('report.csv')).toBe('CSV');
  });

  it('maps an uppercase extension to its type constant', () => {
    expect(SampleFileModel.getFileTypeFromExtension('REPORT.CSV')).toBe('CSV');
  });

  it('maps every supported extension correctly', () => {
    expect(SampleFileModel.getFileTypeFromExtension('a.raw')).toBe('RAW');
    expect(SampleFileModel.getFileTypeFromExtension('a.zip')).toBe('ZIP');
    expect(SampleFileModel.getFileTypeFromExtension('a.xls')).toBe('XLS');
    expect(SampleFileModel.getFileTypeFromExtension('a.xlsx')).toBe('XLSX');
    expect(SampleFileModel.getFileTypeFromExtension('a.pdf')).toBe('PDF');
    expect(SampleFileModel.getFileTypeFromExtension('a.txt')).toBe('TXT');
  });

  it('handles filenames with multiple dots by using the last segment', () => {
    expect(SampleFileModel.getFileTypeFromExtension('archive.backup.zip')).toBe('ZIP');
  });

  it('returns null for an unknown extension', () => {
    expect(SampleFileModel.getFileTypeFromExtension('report.doc')).toBeNull();
  });

  it('returns null for a filename with no extension (whole name treated as extension)', () => {
    expect(SampleFileModel.getFileTypeFromExtension('README')).toBeNull();
  });

  it('does not throw for an empty filename', () => {
    expect(() => SampleFileModel.getFileTypeFromExtension('')).not.toThrow();
    expect(SampleFileModel.getFileTypeFromExtension('')).toBeNull();
  });
});

describe('SampleFileModel.getFileFormatFromType', () => {
  it('maps every supported fileType to a distinct MIME format', () => {
    expect(SampleFileModel.getFileFormatFromType('RAW')).toBe('application/octet-stream');
    expect(SampleFileModel.getFileFormatFromType('ZIP')).toBe('application/zip');
    expect(SampleFileModel.getFileFormatFromType('CSV')).toBe('text/csv');
    expect(SampleFileModel.getFileFormatFromType('XLS')).toBe('application/vnd.ms-excel');
    expect(SampleFileModel.getFileFormatFromType('XLSX')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(SampleFileModel.getFileFormatFromType('PDF')).toBe('application/pdf');
    expect(SampleFileModel.getFileFormatFromType('TXT')).toBe('text/plain');
  });

  it('is case-insensitive', () => {
    expect(SampleFileModel.getFileFormatFromType('csv')).toBe('text/csv');
  });

  it('falls back to the generic binary type for an unknown fileType instead of throwing', () => {
    expect(SampleFileModel.getFileFormatFromType('DOC')).toBe('application/octet-stream');
    expect(SampleFileModel.getFileFormatFromType(undefined)).toBe('application/octet-stream');
  });
});

describe('SampleFileModel.FILE_ROLES', () => {
  it('exposes the dict-02 ELM-0317 pipeline-stage vocabulary', () => {
    expect(SampleFileModel.FILE_ROLES).toEqual([
      'raw',
      'intermediate',
      'processed',
      'derived',
      'report',
      'manifest'
    ]);
  });
});

describe('SampleFileModel.isValidExtension', () => {
  it('returns true for each allowed extension in lowercase', () => {
    ['a.raw', 'a.zip', 'a.csv', 'a.xls', 'a.xlsx', 'a.pdf', 'a.txt'].forEach((name) => {
      expect(SampleFileModel.isValidExtension(name)).toBe(true);
    });
  });

  it('is case-insensitive for uppercase extensions', () => {
    expect(SampleFileModel.isValidExtension('REPORT.CSV')).toBe(true);
  });

  it('handles filenames with multiple dots by using the last segment', () => {
    expect(SampleFileModel.isValidExtension('archive.backup.zip')).toBe(true);
  });

  it('returns false for an unsupported extension', () => {
    expect(SampleFileModel.isValidExtension('report.doc')).toBe(false);
  });

  it('returns false for a filename with no extension', () => {
    // whole filename becomes the "extension" candidate and won't match any allowed one
    expect(SampleFileModel.isValidExtension('README')).toBe(false);
  });

  it('does not throw for an empty filename', () => {
    expect(() => SampleFileModel.isValidExtension('')).not.toThrow();
    expect(SampleFileModel.isValidExtension('')).toBe(false);
  });
});

describe('SampleFileModel cross-method consistency', () => {
  it('every type accepted by isValidFileType is also reachable via getFileTypeFromExtension using its lowercase extension form', () => {
    const types = ['RAW', 'ZIP', 'CSV', 'XLS', 'XLSX', 'PDF', 'TXT'];
    types.forEach((type) => {
      expect(SampleFileModel.isValidFileType(type)).toBe(true);
      expect(SampleFileModel.getFileTypeFromExtension(`file.${type.toLowerCase()}`)).toBe(type);
      expect(SampleFileModel.isValidExtension(`file.${type.toLowerCase()}`)).toBe(true);
    });
  });
});
