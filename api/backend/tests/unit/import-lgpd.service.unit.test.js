import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// ImportLGPDService — pure & lightly-mocked unit tests
// ──────────────────────────────────────────────────────────

// Heavy modules that get pulled in at require-time — mock to avoid side effects
vi.mock('../../src/services/patient.service', () => ({}));
vi.mock('../../src/services/notification.service', () => ({}));
vi.mock('../../src/services/PatientIdentityService', () => ({}));
vi.mock('../../src/services/DrugService', () => ({}));
vi.mock('../../src/services/SampleGraphValidator', () => ({ default: class {} }));
vi.mock('../../src/services/MerkleService', () => ({ generateSampleHash: vi.fn() }));
vi.mock('../../src/services/quality-domain.service', () => ({}));
vi.mock('../../src/utils/patientAnonymization', () => ({ generateUniquePatientID: vi.fn() }));
vi.mock('../../src/utils/collectionResolver', () => ({ getCollection: vi.fn() }));
vi.mock('fs');

const service = require('../../src/services/import-lgpd.service');

// ──────────────────────────────────────────────────────────
// normalizeCatalogValue
// ──────────────────────────────────────────────────────────
describe('ImportLGPDService.normalizeCatalogValue', () => {
  const catalog = [
    { id: 'A', label: 'Tipo Alpha' },
    { id: 'B', label: 'Tipo Beta' },
    { id: 'C', label: 'Tipo Gama' },
  ];

  it('returns null for null input', () => {
    expect(service.normalizeCatalogValue(null, catalog)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(service.normalizeCatalogValue(undefined, catalog)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(service.normalizeCatalogValue('', catalog)).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(service.normalizeCatalogValue('   ', catalog)).toBeNull();
  });

  it('returns catalog id on exact id match', () => {
    expect(service.normalizeCatalogValue('A', catalog)).toBe('A');
  });

  it('matches by label case-insensitively', () => {
    expect(service.normalizeCatalogValue('tipo alpha', catalog)).toBe('A');
    expect(service.normalizeCatalogValue('TIPO ALPHA', catalog)).toBe('A');
    expect(service.normalizeCatalogValue('Tipo Alpha', catalog)).toBe('A');
  });

  it('matches label with leading/trailing whitespace in value', () => {
    expect(service.normalizeCatalogValue('  Tipo Beta  ', catalog)).toBe('B');
  });

  it('returns raw value as string when no match found', () => {
    expect(service.normalizeCatalogValue('Desconhecido', catalog)).toBe('Desconhecido');
  });

  it('coerces numeric value and matches by id', () => {
    const numericCatalog = [{ id: '1', label: 'Um' }];
    expect(service.normalizeCatalogValue(1, numericCatalog)).toBe('1');
  });

  it('returns raw value when catalog is empty', () => {
    expect(service.normalizeCatalogValue('X', [])).toBe('X');
  });

  it('prefers id match over label match', () => {
    // catalog where label of one item equals id of another
    const tricky = [
      { id: 'Z', label: 'Alpha' },
      { id: 'Alpha', label: 'Nope' },
    ];
    expect(service.normalizeCatalogValue('Alpha', tricky)).toBe('Alpha');
  });
});

// ──────────────────────────────────────────────────────────
// getPatientsSmartImportMetadata
// ──────────────────────────────────────────────────────────
describe('ImportLGPDService.getPatientsSmartImportMetadata', () => {
  let metadata;

  beforeEach(() => {
    metadata = service.getPatientsSmartImportMetadata();
  });

  it('returns an object', () => {
    expect(typeof metadata).toBe('object');
    expect(metadata).not.toBeNull();
  });

  it('includes acceptedExtensions array with csv, xlsx, txt', () => {
    expect(Array.isArray(metadata.acceptedExtensions)).toBe(true);
    expect(metadata.acceptedExtensions).toContain('csv');
    expect(metadata.acceptedExtensions).toContain('xlsx');
    expect(metadata.acceptedExtensions).toContain('txt');
  });

  it('declares requiredMapping as true', () => {
    expect(metadata.requiredMapping).toBe(true);
  });

  it('includes required fields array with at least patientName and birthDate', () => {
    expect(Array.isArray(metadata.requiredFields)).toBe(true);
    const fields = metadata.requiredFields.map((f) => f.field);
    expect(fields).toContain('patientName');
    expect(fields).toContain('birthDate');
    expect(fields).toContain('sex');
    expect(fields).toContain('email');
  });

  it('includes invalidRowPolicy with a code and message', () => {
    expect(metadata.invalidRowPolicy).toBeDefined();
    expect(typeof metadata.invalidRowPolicy.code).toBe('string');
    expect(typeof metadata.invalidRowPolicy.message).toBe('string');
  });

  it('includes conditionalRules array', () => {
    expect(Array.isArray(metadata.conditionalRules)).toBe(true);
  });

  it('each required field has field, label, description', () => {
    for (const f of metadata.requiredFields) {
      expect(typeof f.field).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.description).toBe('string');
    }
  });

  it('is deterministic — returns same structure on repeated calls', () => {
    const second = service.getPatientsSmartImportMetadata();
    expect(second.acceptedExtensions).toEqual(metadata.acceptedExtensions);
    expect(second.requiredFields.length).toBe(metadata.requiredFields.length);
  });
});

// ──────────────────────────────────────────────────────────
// validateFileFormat
// ──────────────────────────────────────────────────────────
describe('ImportLGPDService.validateFileFormat', () => {
  const makeFile = (originalname, mimetype = '') => ({ originalname, mimetype });

  describe('patients allowedType', () => {
    it('accepts .csv by extension', () => {
      expect(service.validateFileFormat(makeFile('data.csv'), 'patients')).toBe(true);
    });

    it('accepts .xlsx by extension', () => {
      expect(service.validateFileFormat(makeFile('data.xlsx'), 'patients')).toBe(true);
    });

    it('accepts .txt by extension', () => {
      expect(service.validateFileFormat(makeFile('data.txt'), 'patients')).toBe(true);
    });

    it('rejects .pdf extension', () => {
      expect(service.validateFileFormat(makeFile('data.pdf'), 'patients')).toBe(false);
    });

    it('accepts csv by mime type even with wrong extension', () => {
      expect(service.validateFileFormat(makeFile('data.dat', 'text/csv'), 'patients')).toBe(true);
    });

    it('accepts xlsx mime type', () => {
      const mimeXlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      expect(service.validateFileFormat(makeFile('data.dat', mimeXlsx), 'patients')).toBe(true);
    });

    it('is case-insensitive for extension', () => {
      expect(service.validateFileFormat(makeFile('data.CSV'), 'patients')).toBe(true);
      expect(service.validateFileFormat(makeFile('data.XLSX'), 'patients')).toBe(true);
    });
  });

  describe('samples allowedType', () => {
    it('accepts .csv by extension', () => {
      expect(service.validateFileFormat(makeFile('samples.csv'), 'samples')).toBe(true);
    });

    it('accepts .xlsx by extension', () => {
      expect(service.validateFileFormat(makeFile('samples.xlsx'), 'samples')).toBe(true);
    });

    it('rejects .txt extension for samples', () => {
      expect(service.validateFileFormat(makeFile('samples.txt'), 'samples')).toBe(false);
    });

    it('rejects .pdf extension for samples', () => {
      expect(service.validateFileFormat(makeFile('samples.pdf'), 'samples')).toBe(false);
    });
  });

  describe('unknown allowedType', () => {
    it('returns false for unrecognised type', () => {
      expect(service.validateFileFormat(makeFile('data.csv'), 'unknown-type')).toBe(false);
    });
  });
});
