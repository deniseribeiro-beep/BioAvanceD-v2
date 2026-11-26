import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const importLgpdService = require2('../../src/services/import-lgpd.service');

describe('ImportLGPDService', () => {
  describe('normalizeCatalogValue', () => {
    const catalog = [
      { id: 'VENOUS_BLOOD', label: 'Sangue Venoso Periférico' },
      { id: 'ORAL_MUCOSA', label: 'Mucosa Oral (Swab)' },
    ];

    it('returns null for undefined/null input', () => {
      expect(importLgpdService.normalizeCatalogValue(undefined, catalog)).toBeNull();
      expect(importLgpdService.normalizeCatalogValue(null, catalog)).toBeNull();
    });

    it('returns null for blank/whitespace-only input', () => {
      expect(importLgpdService.normalizeCatalogValue('   ', catalog)).toBeNull();
    });

    it('matches directly by catalog id', () => {
      expect(importLgpdService.normalizeCatalogValue('VENOUS_BLOOD', catalog)).toBe('VENOUS_BLOOD');
    });

    it('matches case-insensitively by label', () => {
      expect(importLgpdService.normalizeCatalogValue('sangue venoso periférico', catalog)).toBe('VENOUS_BLOOD');
    });

    it('falls back to the trimmed raw value when nothing matches', () => {
      expect(importLgpdService.normalizeCatalogValue('  Unknown Thing  ', catalog)).toBe('Unknown Thing');
    });
  });

  describe('validateFileFormat', () => {
    it('accepts a valid CSV for patients by extension', () => {
      const file = { originalname: 'patients.csv', mimetype: 'text/csv' };
      expect(importLgpdService.validateFileFormat(file, 'patients')).toBe(true);
    });

    it('accepts a valid file purely by mimetype even with a mismatched extension', () => {
      const file = { originalname: 'patients.dat', mimetype: 'text/csv' };
      expect(importLgpdService.validateFileFormat(file, 'patients')).toBe(true);
    });

    it('rejects .txt files for samples (only allowed for patients)', () => {
      const file = { originalname: 'samples.txt', mimetype: 'text/plain' };
      expect(importLgpdService.validateFileFormat(file, 'samples')).toBe(false);
    });

    it('rejects an unknown category outright', () => {
      const file = { originalname: 'x.csv', mimetype: 'text/csv' };
      expect(importLgpdService.validateFileFormat(file, 'nonsense')).toBe(false);
    });
  });

  describe('parseBirthDate', () => {
    it('parses DD/MM/YYYY format', () => {
      const d = importLgpdService.parseBirthDate('25/12/1990');
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBe(1990);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('parses YYYY-MM-DD format', () => {
      const d = importLgpdService.parseBirthDate('1990-12-25');
      expect(d.getFullYear()).toBe(1990);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('rejects invalid calendar dates like 31/02/1990', () => {
      // Feb 31 doesn't exist; none of the regex branches nor the fallback should accept it validly
      expect(importLgpdService.parseBirthDate('31/02/1990')).toBeNull();
    });

    it('returns null for empty/undefined input', () => {
      expect(importLgpdService.parseBirthDate(null)).toBeNull();
      expect(importLgpdService.parseBirthDate('')).toBeNull();
    });

    it('passes through a valid Date instance unchanged', () => {
      const input = new Date(2000, 0, 1);
      expect(importLgpdService.parseBirthDate(input)).toBe(input);
    });

    it('returns null for an invalid Date instance', () => {
      const invalid = new Date('not-a-date');
      expect(importLgpdService.parseBirthDate(invalid)).toBeNull();
    });

    it('parses DD-MM-YYYY (dash-separated) format', () => {
      const d = importLgpdService.parseBirthDate('25-12-1990');
      expect(d.getFullYear()).toBe(1990);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('rejects formats outside DD/MM/YYYY, YYYY-MM-DD and DD-MM-YYYY (issue #37)', () => {
      // Bug: previously fell back to bare `new Date(str)`, silently accepting
      // ambiguous/non-documented formats with different day/month semantics.
      expect(importLgpdService.parseBirthDate('December 25, 1990')).toBeNull();
      expect(importLgpdService.parseBirthDate('1990/12/25')).toBeNull();
    });
  });

  describe('parseSex', () => {
    it('accepts M, F, O directly', () => {
      expect(importLgpdService.parseSex('M')).toBe('M');
      expect(importLgpdService.parseSex('F')).toBe('F');
      expect(importLgpdService.parseSex('O')).toBe('O');
    });

    it('translates Portuguese words to canonical codes', () => {
      expect(importLgpdService.parseSex('Masculino')).toBe('M');
      expect(importLgpdService.parseSex('Feminino')).toBe('F');
      expect(importLgpdService.parseSex('Outro')).toBe('O');
    });

    it('returns null for unrecognized values', () => {
      expect(importLgpdService.parseSex('xyz-unrecognized-123')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(importLgpdService.parseSex('')).toBeNull();
      expect(importLgpdService.parseSex(null)).toBeNull();
    });
  });

  describe('parseBoolean', () => {
    it('recognizes truthy string variants', () => {
      expect(importLgpdService.parseBoolean('true')).toBe(true);
      expect(importLgpdService.parseBoolean('1')).toBe(true);
      expect(importLgpdService.parseBoolean('sim')).toBe(true);
      expect(importLgpdService.parseBoolean('YES')).toBe(true);
      expect(importLgpdService.parseBoolean('S')).toBe(true);
    });

    it('treats unrecognized strings as false', () => {
      expect(importLgpdService.parseBoolean('no')).toBe(false);
      expect(importLgpdService.parseBoolean('false')).toBe(false);
      expect(importLgpdService.parseBoolean('0')).toBe(false);
    });

    it('treats missing values as false', () => {
      expect(importLgpdService.parseBoolean(undefined)).toBe(false);
      expect(importLgpdService.parseBoolean(null)).toBe(false);
      expect(importLgpdService.parseBoolean('')).toBe(false);
    });
  });

  describe('parseFloatField', () => {
    it('parses a numeric string', () => {
      expect(importLgpdService.parseFloatField('12.5')).toBe(12.5);
    });

    it('returns null for empty/placeholder sentinel strings', () => {
      expect(importLgpdService.parseFloatField('')).toBeNull();
      expect(importLgpdService.parseFloatField('null')).toBeNull();
      expect(importLgpdService.parseFloatField('N/A')).toBeNull();
      expect(importLgpdService.parseFloatField('-')).toBeNull();
    });

    it('returns null for non-numeric garbage', () => {
      expect(importLgpdService.parseFloatField('abc')).toBeNull();
    });
  });

  describe('normalizeText', () => {
    it('trims and optionally uppercases', () => {
      expect(importLgpdService.normalizeText('  hello  ')).toBe('hello');
      expect(importLgpdService.normalizeText('  hello  ', { uppercase: true })).toBe('HELLO');
    });

    it('returns null for blank or missing input', () => {
      expect(importLgpdService.normalizeText('   ')).toBeNull();
      expect(importLgpdService.normalizeText(undefined)).toBeNull();
      expect(importLgpdService.normalizeText(null)).toBeNull();
    });
  });

  describe('normalizeCpf', () => {
    it('strips non-digit characters', () => {
      expect(importLgpdService.normalizeCpf('123.456.789-09')).toBe('12345678909');
    });

    it('returns null for missing input or an all-non-digit string', () => {
      expect(importLgpdService.normalizeCpf(null)).toBeNull();
      expect(importLgpdService.normalizeCpf('abc')).toBeNull();
    });
  });

  describe('isValidCpf', () => {
    it('accepts a known-valid CPF (check digits correct)', () => {
      // 111.444.777-35 is a commonly used valid-format CPF for testing
      expect(importLgpdService.isValidCpf('111.444.777-35')).toBe(true);
    });

    it('rejects a CPF with wrong length', () => {
      expect(importLgpdService.isValidCpf('123456')).toBe(false);
    });

    it('rejects a CPF made of a single repeated digit', () => {
      expect(importLgpdService.isValidCpf('111.111.111-11')).toBe(false);
    });

    it('rejects a CPF with tampered check digits', () => {
      expect(importLgpdService.isValidCpf('111.444.777-99')).toBe(false);
    });
  });

  describe('isFutureDate', () => {
    it('returns true for a date after today', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(importLgpdService.isFutureDate(future)).toBe(true);
    });

    it('returns false for today and for past dates', () => {
      expect(importLgpdService.isFutureDate(new Date())).toBe(false);
      const past = new Date(2000, 0, 1);
      expect(importLgpdService.isFutureDate(past)).toBe(false);
    });

    it('returns false for a non-Date or invalid Date input', () => {
      expect(importLgpdService.isFutureDate('2099-01-01')).toBe(false);
      expect(importLgpdService.isFutureDate(new Date('garbage'))).toBe(false);
    });
  });

  describe('sanitizeRowForError', () => {
    it('always strips row content regardless of input, to avoid leaking sensitive data in error logs', () => {
      const sensitiveRow = { patientName: 'John Doe', cpf: '11144477735', birthDate: '01/01/1990' };
      const sanitized = importLgpdService.sanitizeRowForError(sensitiveRow);
      expect(sanitized).toEqual({});
      expect(sanitized.patientName).toBeUndefined();
      expect(sanitized.cpf).toBeUndefined();
    });
  });

  describe('parsePatientRow', () => {
    it('parses a well-formed row into normalized patient data', () => {
      const row = {
        patientName: '  Maria Silva  ',
        email: '  MARIA@Example.com ',
        birthDate: '15/06/1985',
        sex: 'Feminino',
        recordNumber: '00123',
        heightCm: '1.70',
        clinicalUnit: ' UTI ',
        consentTemplateId: ' 64d0f0f0f0f0f0f0f0f0f0f0 ',
      };
      const result = importLgpdService.parsePatientRow(row);

      expect(result.patientName).toBe('Maria Silva');
      expect(result.email).toBe('maria@example.com');
      expect(result.sex).toBe('F');
      expect(result.birthDate.getFullYear()).toBe(1985);
      expect(result.recordNumber).toBe(123);
      // 1.70 is < 3 so it's treated as meters and converted to cm
      expect(result.heightCm).toBe(170);
      expect(result.clinicalUnit).toBe('UTI');
      expect(result.consentTemplateId).toBe('64d0f0f0f0f0f0f0f0f0f0f0');
    });

    it('defaults optional fields to null when absent', () => {
      const result = importLgpdService.parsePatientRow({});
      expect(result.patientName).toBeNull();
      expect(result.email).toBeNull();
      expect(result.birthDate).toBeNull();
      expect(result.sex).toBeNull();
      expect(result.consentTemplateId).toBeNull();
      expect(result.recordNumber).toBeNull();
    });

    it('keeps a non-numeric recordNumber as a trimmed string', () => {
      const result = importLgpdService.parsePatientRow({ recordNumber: 'AB-123' });
      expect(result.recordNumber).toBe('AB-123');
    });

    it('falls back to the "height" column (in meters, converted to cm) when heightCm is absent', () => {
      const result = importLgpdService.parsePatientRow({ height: '1.80' });
      expect(result.heightCm).toBe(180);
    });

    it('treats a heightCm value >= 3 as already in centimeters', () => {
      const result = importLgpdService.parsePatientRow({ heightCm: '175' });
      expect(result.heightCm).toBe(175);
    });
  });

  describe('parseSampleRow', () => {
    it('parses core identity and specimen fields', () => {
      const row = {
        participantId: ' 12345678 ',
        patientName: ' João  ',
        birthDate: '01/01/1990',
        email: 'joao@example.com',
        sex: 'M',
        sampleType: ' Plasma ',
        sampleOrigin: 'Sangue Venoso Periférico',
        extractionProtocol: 'Tubo EDTA (Tampa Roxa)',
        barcode: ' BC-001 ',
        quantity: '5.5',
      };
      const result = importLgpdService.parseSampleRow(row);

      expect(result.participantId).toBe('12345678');
      expect(result.patientName).toBe('João');
      expect(result.patientBirthDate.getFullYear()).toBe(1990);
      expect(result.sampleType).toBe('Plasma');
      expect(result.sampleOrigin).toBe('VENOUS_BLOOD');
      expect(result.extractionProtocol).toBe('TUBE_EDTA');
      expect(result.barcode).toBe('BC-001');
      expect(result.quantity).toBe(5.5);
    });

    it('defaults registeredAt to now when no date columns are supplied', () => {
      const before = Date.now();
      const result = importLgpdService.parseSampleRow({});
      const after = Date.now();
      expect(result.registeredAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.registeredAt.getTime()).toBeLessThanOrEqual(after);
    });

    // #758: the only registeredAt coverage was the default-to-now path above,
    // which is exactly why a rename collision in the mapping could sit here
    // undetected -- an empty row takes the same branch whether the mapping is
    // right or not. This pins the positive case: a supplied date must survive
    // to the output, and must not be quietly replaced by today.
    it('carries a supplied registeredAt through to the output instead of defaulting to now', () => {
      const result = importLgpdService.parseSampleRow({ registeredAt: '15/03/2024' });

      expect(result.registeredAt).toBeInstanceOf(Date);
      expect(result.registeredAt.getFullYear()).toBe(2024);
      expect(result.registeredAt.getMonth()).toBe(2); // March, 0-indexed
      expect(result.registeredAt.getDate()).toBe(15);
    });

    // #758: e2549bee renamed both arms of a two-alias fallback
    // (registerDate/registrationDate) to the same canonical name, leaving a
    // dead `else if` in the parse and a duplicate key in the output literal.
    // Both were behaviour-invariant, but this pins the shape so a future
    // rename cannot reintroduce a second date key without a test noticing.
    it('emits exactly one registration-date key on the parsed row', () => {
      const result = importLgpdService.parseSampleRow({ registeredAt: '15/03/2024' });

      const dateKeys = Object.keys(result).filter((k) => /^regist/i.test(k));
      expect(dateKeys).toEqual(['registeredAt']);
    });

    it('only accepts a whitelisted set of pharmacology treatmentStatus values', () => {
      const valid = importLgpdService.parseSampleRow({ treatmentStatus: 'TREATED' });
      expect(valid.pharmacologyData.treatmentStatus).toBe('TREATED');

      const invalid = importLgpdService.parseSampleRow({ treatmentStatus: 'BOGUS_STATUS' });
      expect(invalid.pharmacologyData.treatmentStatus).toBe('');
    });

    it('maps the legacy lifecycleStatus column onto specimenStatus, not the trio', () => {
      // RF006 AC2 (V2E-0544): the v1.3.0 `depleted` folds to available; the
      // depletion is quantityStatus, derived from the quantities.
      const result = importLgpdService.parseSampleRow({ lifecycleStatus: 'DEPLETED' });
      expect(result.specimenStatus).toBe('available');
      expect(result.lifecycleStatus).toBeUndefined();
    });

    it('maps v1.3.0 destroyed to unavailable and never imports closed (RF026 AC7)', () => {
      expect(importLgpdService.parseSampleRow({ specimenStatus: 'destroyed' }).specimenStatus).toBe('unavailable');
      expect(importLgpdService.parseSampleRow({ specimenStatus: 'closed' }).specimenStatus).toBe('unavailable');
    });

    it('defaults specimenStatus to available when no status column is supplied', () => {
      const result = importLgpdService.parseSampleRow({});
      expect(result.specimenStatus).toBe('available');
    });

    it('strips an ATC: prefix and uppercases the atcCode', () => {
      const result = importLgpdService.parseSampleRow({ atcCode: 'atc:a10bx02' });
      expect(result.pharmacologyData.atcCode).toBe('A10BX02');
    });

    it('maps a named collectionSite column, trimmed (ELM-0128, #1376)', () => {
      expect(importLgpdService.parseSampleRow({ collectionSite: ' org-b ' }).collectionSite).toBe('org-b');
    });

    it('maps a blank or absent collectionSite column to null (ELM-0128, #1376)', () => {
      expect(importLgpdService.parseSampleRow({ collectionSite: '   ' }).collectionSite).toBeNull();
      expect(importLgpdService.parseSampleRow({}).collectionSite).toBeNull();
    });
  });

  describe('buildMappedPatientRow', () => {
    it('applies explicit mapping over the raw row', () => {
      const rawRow = { Coluna1: 'Fulano de Tal', ColunaEmail: 'fulano@example.com' };
      const mapping = { Coluna1: 'patientName', ColunaEmail: 'email' };
      const result = importLgpdService.buildMappedPatientRow(rawRow, mapping);
      expect(result.patientName).toBe('Fulano de Tal');
      expect(result.email).toBe('fulano@example.com');
    });

    it('falls back to canonical header inference (accent/case-insensitive) when no explicit mapping matches', () => {
      const rawRow = { 'Nome Paciente': 'Ciclana', 'Data Nascimento': '01/01/2000' };
      // canonicalHeaderMap keys are fully normalized (no spaces/accents), so
      // "Nome Paciente" normalizes to "nomepaciente" which maps to patientName.
      const result = importLgpdService.buildMappedPatientRow(rawRow, {});
      expect(result.patientName).toBe('Ciclana');
    });

    it('does not let an empty/whitespace-only raw value override an already-mapped field', () => {
      const rawRow = { patientName: 'Real Name', extra: '   ' };
      const result = importLgpdService.buildMappedPatientRow(rawRow, {});
      expect(result.patientName).toBe('Real Name');
      expect(result.extra).toBeUndefined();
    });

    it('promotes responsavelNome/responsavelEmail aliases to representativeName/Email', () => {
      const rawRow = { responsavelNome: 'Responsavel X' };
      const result = importLgpdService.buildMappedPatientRow(rawRow, {});
      expect(result.representativeName).toBe('Responsavel X');
    });
  });

  describe('getPatientsSmartImportMetadata', () => {
    it('lists consentTemplateId among the required fields (LGPD consent gate)', () => {
      const metadata = importLgpdService.getPatientsSmartImportMetadata();
      const fieldNames = metadata.requiredFields.map((f) => f.field);
      expect(fieldNames).toContain('consentTemplateId');
      expect(fieldNames).toContain('email');
    });

    it('declares SKIP_INVALID_ROWS as the invalid-row policy', () => {
      const metadata = importLgpdService.getPatientsSmartImportMetadata();
      expect(metadata.invalidRowPolicy.code).toBe('SKIP_INVALID_ROWS');
    });
  });

  describe('readFile', () => {
    it('rejects unsupported file extensions', async () => {
      await expect(
        importLgpdService.readFile('/tmp/whatever.pdf', 'whatever.pdf', 'patients')
      ).rejects.toThrow('Formato de arquivo não suportado');
    });

    it('rejects when the CSV file does not exist on disk', async () => {
      await expect(
        importLgpdService.readFile('/definitely/does/not/exist.csv', 'exist.csv', 'patients')
      ).rejects.toThrow('Arquivo não encontrado');
    });

    it('rejects when the Excel file does not exist on disk', async () => {
      await expect(
        importLgpdService.readFile('/definitely/does/not/exist.xlsx', 'exist.xlsx', 'patients')
      ).rejects.toThrow(/Erro ao processar arquivo Excel/);
    });
  });

  describe('importPatientsSmart', () => {
    it('rejects when no mapping is provided (mapping is mandatory for smart import)', async () => {
      const fakeDb = {};
      const fakeFile = { path: '/does/not/matter.csv', originalname: 'x.csv' };
      await expect(
        importLgpdService.importPatientsSmart(fakeDb, fakeFile, { mapping: {} })
      ).rejects.toThrow('Mapeamento inteligente é obrigatório');
    });
  });

  describe('cleanupFile', () => {
    it('does not throw when the file does not exist', () => {
      expect(() => importLgpdService.cleanupFile('/definitely/does/not/exist-cleanup.tmp')).not.toThrow();
    });
  });

  describe('parsePatientRow blank text fields (#1337)', () => {
    it('maps a whitespace-only patientName and unitAcronym to null', () => {
      const result = importLgpdService.parsePatientRow({ patientName: '   ', unitAcronym: '  ' });
      expect(result.patientName).toBeNull();
      expect(result.unitAcronym).toBeNull();
    });
  });

  describe('parseSampleRow alias and blank arms (#1337)', () => {
    it('maps a null or blank sourceRecordId to null and trims a set one', () => {
      expect(importLgpdService.parseSampleRow({ sourceRecordId: null }).sourceRecordId).toBeNull();
      expect(importLgpdService.parseSampleRow({ sourceRecordId: '   ' }).sourceRecordId).toBeNull();
      expect(importLgpdService.parseSampleRow({ sourceRecordId: ' SRC-77 ' }).sourceRecordId).toBe('SRC-77');
    });

    it('reads the participant sex from the gender column, then from sexo', () => {
      expect(importLgpdService.parseSampleRow({ gender: 'F' }).patientSex).toBe('F');
      expect(importLgpdService.parseSampleRow({ sexo: 'Masculino' }).patientSex).toBe('M');
    });

    it('takes the representative name from responsavelNome alone, and null when neither column is set', () => {
      expect(importLgpdService.parseSampleRow({ responsavelNome: ' Ana Lima ' }).representativeName).toBe('Ana Lima');
      expect(importLgpdService.parseSampleRow({}).representativeName).toBeNull();
    });

    it('trims and lowercases a present representativeEmail', () => {
      expect(importLgpdService.parseSampleRow({ representativeEmail: ' Rep@Example.COM ' }).representativeEmail).toBe('rep@example.com');
    });
  });

  describe('sanitizeCorrectedRow scalar values (#1337)', () => {
    it('keeps null, number and boolean values as they are', () => {
      expect(importLgpdService.sanitizeCorrectedRow({ a: null, b: 3, c: false, d: 'x' }))
        .toEqual({ a: null, b: 3, c: false, d: 'x' });
    });
  });

  describe('assertSampleHeaders patient identification (#1337)', () => {
    it('throws when neither participantId nor the patientName + birthDate pair is present', () => {
      expect(() => importLgpdService.assertSampleHeaders(['sampleType', 'sampleOrigin']))
        .toThrow('Identificação do paciente ausente');
      expect(() => importLgpdService.assertSampleHeaders(['sampleType', 'sampleOrigin', 'patientName']))
        .toThrow('Identificação do paciente ausente');
    });

    it('accepts the nome + dataNascimento aliases as the identification pair', () => {
      expect(() => importLgpdService.assertSampleHeaders(['sampleType', 'sampleOrigin', 'nome', 'dataNascimento']))
        .not.toThrow();
    });
  });

  describe('findFirstAvailablePositionInBox (#1337)', () => {
    it('returns null for a box with no cols', () => {
      expect(importLgpdService.findFirstAvailablePositionInBox({ dimension: { rows: 2 } })).toBeNull();
    });

    it('reads a Map occupancyGrid through has/get', () => {
      const box = { dimension: { rows: 1, cols: 3 }, occupancyGrid: new Map([['A1', 'sample-1'], ['A2', null]]) };
      expect(importLgpdService.findFirstAvailablePositionInBox(box)).toBe('A2');
    });

    it('returns null when every position is occupied', () => {
      const box = { dimension: { rows: 1, cols: 2 }, occupancyGrid: { A1: 's1', A2: 's2' } };
      expect(importLgpdService.findFirstAvailablePositionInBox(box)).toBeNull();
    });
  });

  describe('resolveStorageHierarchyForBox (#1337)', () => {
    function makeDb(docs) {
      const findOne = vi.fn(async ({ _id }) => docs[_id] || null);
      return { db: { collection: vi.fn(() => ({ findOne })) }, findOne };
    }

    it('walks through a DRAWER with a parent_id up to its rack, shelf and freezer', async () => {
      const { db } = makeDb({
        'drawer-1': { _id: 'drawer-1', containerType: 'DRAWER', parent_id: 'rack-1' },
        'rack-1': { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' },
        'shelf-1': { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' },
        'freezer-1': { _id: 'freezer-1', containerType: 'FREEZER' },
      });

      const result = await importLgpdService.resolveStorageHierarchyForBox(db, { parent_id: 'drawer-1' });

      expect(result.rack._id).toBe('rack-1');
      expect(result.shelf._id).toBe('shelf-1');
      expect(result.freezer._id).toBe('freezer-1');
    });

    it('resolves no rack, shelf or freezer for a DRAWER without a parent_id', async () => {
      const { db, findOne } = makeDb({
        'drawer-2': { _id: 'drawer-2', containerType: 'DRAWER' },
      });

      const result = await importLgpdService.resolveStorageHierarchyForBox(db, { parent_id: 'drawer-2' });

      expect(result).toEqual({ rack: null, shelf: null, freezer: null });
      expect(findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('isPlacementReady status fallbacks (#1337)', () => {
    function makeDb({ equipment, sensors = [] }) {
      const equipmentFindOne = vi.fn().mockResolvedValue(equipment);
      const sensorsFind = vi.fn(() => ({ limit: () => ({ toArray: async () => sensors }) }));
      const db = {
        collection: vi.fn((name) => (name === 'equipment' ? { findOne: equipmentFindOne } : { find: sensorsFind })),
      };
      return { db, equipmentFindOne, sensorsFind };
    }

    it('looks the equipment up by the id, its string and its number form', async () => {
      const { db, equipmentFindOne } = makeDb({ equipment: null });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 7 })).resolves.toBe(false);
      expect(equipmentFindOne).toHaveBeenCalledWith({ equipmentID: { $in: [7, '7'] } });
    });

    it('blocks equipment whose only status is a blocked maintenanceStatus', async () => {
      const { db, sensorsFind } = makeDb({ equipment: { maintenanceStatus: 'Maintenance' } });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 'FRZ-1' })).resolves.toBe(false);
      expect(sensorsFind).not.toHaveBeenCalled();
    });

    it('accepts equipment whose only status is a ready operationalStatus', async () => {
      const { db } = makeDb({ equipment: { operationalStatus: 'Active' }, sensors: [{ operationalStatus: 'ok' }] });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 'FRZ-1' })).resolves.toBe(true);
    });

    it('rejects a sensor whose only status is a critical maintenanceStatus', async () => {
      const { db } = makeDb({ equipment: { status: 'Active' }, sensors: [{ maintenanceStatus: 'calibration' }] });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 'FRZ-1' })).resolves.toBe(false);
    });

    it('rejects a sensor whose only status is a critical operationalStatus', async () => {
      const { db } = makeDb({ equipment: { status: 'Active' }, sensors: [{ operationalStatus: 'offline' }] });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 'FRZ-1' })).resolves.toBe(false);
    });

    it('treats a sensor with no status at all as operational', async () => {
      const { db } = makeDb({ equipment: { status: 'Active' }, sensors: [{}] });

      await expect(importLgpdService.isPlacementReady(db, { containerID: 'FRZ-1' })).resolves.toBe(true);
    });
  });

  describe('recordFailedImportBatch error message (#1337)', () => {
    function makeDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'failed-batch-1' });
      return { db: { collection: vi.fn(() => ({ insertOne })) }, insertOne };
    }

    it('stores a plain string error as it is', async () => {
      const { db, insertOne } = makeDb();

      const batchId = await importLgpdService.recordFailedImportBatch(db, { error: 'header broke' });

      expect(batchId).toBe('failed-batch-1');
      expect(insertOne.mock.calls[0][0]).toMatchObject({ status: 'FAILED', error: 'header broke' });
    });

    it('stores the default "Erro desconhecido" message when no error is given', async () => {
      const { db, insertOne } = makeDb();

      await importLgpdService.recordFailedImportBatch(db, {});

      expect(insertOne.mock.calls[0][0].error).toBe('Erro desconhecido');
    });
  });
});
