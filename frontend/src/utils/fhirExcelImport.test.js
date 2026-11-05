import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  FHIR_EXCEL_COLUMNS,
  convertExcelFileToFhirBundle,
  downloadFhirExcelTemplate,
} from './fhirExcelImport';

// The real xlsx library builds and parses every workbook here; only
// writeFile (a browser download) is replaced, and read is wrapped so one
// case can hand back a workbook without sheets.
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, read: vi.fn(actual.read), writeFile: vi.fn() };
});

// A File stand-in: convertExcelFileToFhirBundle only calls arrayBuffer().
function xlsxFile(aoa) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'Planilha');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => bytes };
}

function sheetOf(rows) {
  return xlsxFile([
    FHIR_EXCEL_COLUMNS,
    ...rows.map((row) => FHIR_EXCEL_COLUMNS.map((column) => row[column] ?? '')),
  ]);
}

async function entriesOf(rows) {
  const bundle = await convertExcelFileToFhirBundle(sheetOf(rows));
  return bundle.entry.map((entry) => entry.resource);
}

const FULL_ROW = {
  patient_external_id: 'PAC-001',
  patient_name: 'Maria  da Silva Souza',
  patient_document: ' 123.456.789-00 ',
  patient_email: 'maria@example.org',
  patient_birth_date: '1980-02-03',
  patient_sex: 'FEMALE',
  disease_name: 'Fibrose cística',
  cid10: 'E84',
  orpha_code: '586',
  omim_code: '219700',
  sample_external_id: 'AM-9',
  sample_type: 'Sangue total',
  matrix: 'EDTA',
  collection_datetime: '2026-01-02T10:00:00Z',
  storage_temperature: '-80',
  sprecs_raw: 'BLD-SST',
  processing_unknown: 'Sim',
  biomarker_type: 'Cloro no suor',
  biomarker_value: '62.5',
  biomarker_unit: 'mmol/L',
  hpo_code: 'HP:0002110',
  hpo_label: 'Bronquiectasia',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('convertExcelFileToFhirBundle: a filled row', () => {
  it('builds a collection Bundle with Patient, Specimen, Condition, biomarker and HPO entries', async () => {
    const bundle = await convertExcelFileToFhirBundle(sheetOf([FULL_ROW]));

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.entry.map((entry) => entry.fullUrl)).toEqual([
      'urn:uuid:PAC-001',
      'urn:uuid:AM-9',
      'urn:uuid:condition-PAC-001-1',
      'urn:uuid:biomarker-AM-9-1',
      'urn:uuid:hpo-PAC-001-1',
    ]);
  });

  it('maps the patient columns, trimmed, with the name split into given and family', async () => {
    const [patient] = await entriesOf([FULL_ROW]);

    expect(patient).toEqual({
      resourceType: 'Patient',
      id: 'PAC-001',
      identifier: [{ system: 'urn:bioavanced:patient-document', value: '123.456.789-00' }],
      name: [{ text: 'Maria  da Silva Souza', family: 'Souza', given: ['Maria', 'da', 'Silva'] }],
      birthDate: '1980-02-03',
      gender: 'female',
      telecom: [{ system: 'email', value: 'maria@example.org' }],
    });
  });

  it('maps the specimen columns into type, collection, container and four extensions', async () => {
    const [, specimen] = await entriesOf([FULL_ROW]);

    expect(specimen).toEqual({
      resourceType: 'Specimen',
      id: 'AM-9',
      subject: { reference: 'Patient/PAC-001' },
      type: { text: 'Sangue total' },
      collection: { collectedDateTime: '2026-01-02T10:00:00Z' },
      container: [{ identifier: [{ system: 'urn:bioavanced:sample-external-id', value: 'AM-9' }] }],
      extension: [
        { url: 'urn:bioavanced:matrix', valueString: 'EDTA' },
        { url: 'urn:bioavanced:storage-temperature', valueString: '-80' },
        { url: 'urn:bioavanced:sprecs-raw', valueString: 'BLD-SST' },
        { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
      ],
    });
  });

  it('codes the disease in ICD-10, Orphanet and OMIM, each with the disease name as display', async () => {
    const [, , condition] = await entriesOf([FULL_ROW]);

    expect(condition).toEqual({
      resourceType: 'Condition',
      subject: { reference: 'Patient/PAC-001' },
      code: {
        coding: [
          { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E84', display: 'Fibrose cística' },
          { system: 'http://www.orpha.net', code: '586', display: 'Fibrose cística' },
          { system: 'https://omim.org/entry', code: '219700', display: 'Fibrose cística' },
        ],
        text: 'Fibrose cística',
      },
    });
  });

  it('records a numeric biomarker value as a number with its unit, and the HPO term with its label', async () => {
    const [, , , biomarker, hpo] = await entriesOf([FULL_ROW]);

    expect(biomarker).toEqual({
      resourceType: 'Observation',
      status: 'final',
      code: { text: 'Cloro no suor' },
      subject: { reference: 'Patient/PAC-001' },
      specimen: { reference: 'Specimen/AM-9' },
      valueQuantity: { value: 62.5, unit: 'mmol/L' },
    });
    expect(hpo).toEqual({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0002110', display: 'Bronquiectasia' }],
        text: 'Bronquiectasia',
      },
      subject: { reference: 'Patient/PAC-001' },
    });
  });
});

describe('convertExcelFileToFhirBundle: blank and partial cells', () => {
  it('numbers the ids of rows without external ids by row and emits only Patient and Specimen', async () => {
    const bundle = await convertExcelFileToFhirBundle(sheetOf([{ sample_type: 'Soro' }, { sample_type: 'Plasma' }]));

    expect(bundle.entry.map((entry) => entry.fullUrl)).toEqual([
      'urn:uuid:patient-1',
      'urn:uuid:specimen-1',
      'urn:uuid:patient-2',
      'urn:uuid:specimen-2',
    ]);
    const [patient, specimen] = bundle.entry.map((entry) => entry.resource);
    expect(patient).toEqual({ resourceType: 'Patient', id: 'patient-1', identifier: [], name: [], telecom: [] });
    expect(specimen).toEqual({
      resourceType: 'Specimen',
      id: 'specimen-1',
      subject: { reference: 'Patient/patient-1' },
      type: { text: 'Soro' },
      container: [{ identifier: [] }],
      extension: [],
    });
  });

  it('puts a one-word name in family with no given names', async () => {
    const [patient] = await entriesOf([{ patient_name: '  Pelé ' }]);

    expect(patient.name).toEqual([{ text: 'Pelé', family: 'Pelé', given: [] }]);
  });

  it('keeps a disease name without codes as a Condition with no coding', async () => {
    const [, , condition] = await entriesOf([{ disease_name: 'Doença rara' }]);

    expect(condition.code).toEqual({ coding: [], text: 'Doença rara' });
  });

  it('keeps codes without a disease name as codings without display', async () => {
    const [, , condition] = await entriesOf([{ cid10: 'Q90', omim_code: '190685' }]);

    expect(condition.code).toEqual({
      coding: [
        { system: 'http://hl7.org/fhir/sid/icd-10', code: 'Q90' },
        { system: 'https://omim.org/entry', code: '190685' },
      ],
      text: '',
    });
  });

  it('keeps a non-numeric biomarker value as text and drops a missing unit', async () => {
    const [, , biomarker] = await entriesOf([{ biomarker_type: 'Mutação', biomarker_value: 'F508del' }]);

    expect(biomarker.valueQuantity).toEqual({ value: 'F508del' });
  });

  it('omits valueQuantity for a biomarker without a value', async () => {
    const [, , biomarker] = await entriesOf([{ biomarker_type: 'Mutação', biomarker_unit: 'mmol/L' }]);

    expect(biomarker).not.toHaveProperty('valueQuantity');
  });

  it('uses the HPO code as text when the label is blank', async () => {
    const [, , hpo] = await entriesOf([{ hpo_code: 'HP:0001250' }]);

    expect(hpo.code).toEqual({
      coding: [{ system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001250' }],
      text: 'HP:0001250',
    });
  });
});

describe('convertExcelFileToFhirBundle: processing_unknown', () => {
  it.each(['true', 'TRUE', 'sim', 'Sim', '1'])('reads %s as true', async (value) => {
    const [, specimen] = await entriesOf([{ processing_unknown: value }]);

    expect(specimen.extension).toEqual([{ url: 'urn:bioavanced:processing-unknown', valueBoolean: true }]);
  });

  it.each(['false', 'não', '0', '21', 'assim', 'Simples', 'true-ish'])('reads %s as false', async (value) => {
    const [, specimen] = await entriesOf([{ processing_unknown: value }]);

    expect(specimen.extension).toEqual([{ url: 'urn:bioavanced:processing-unknown', valueBoolean: false }]);
  });
});

describe('convertExcelFileToFhirBundle: rejected sheets', () => {
  it('names exactly the required columns the header row lacks', async () => {
    const present = FHIR_EXCEL_COLUMNS.filter((column) => column !== 'cid10' && column !== 'hpo_label');
    const file = xlsxFile([present, present.map(() => 'x')]);

    await expect(convertExcelFileToFhirBundle(file)).rejects.toThrow(
      'Colunas obrigatórias ausentes: cid10, hpo_label',
    );
  });

  it('names every column for a sheet without cells', async () => {
    await expect(convertExcelFileToFhirBundle(xlsxFile([]))).rejects.toThrow(
      `Colunas obrigatórias ausentes: ${FHIR_EXCEL_COLUMNS.join(', ')}`,
    );
  });

  it('says there are no rows for a sheet with every column and no data row', async () => {
    await expect(convertExcelFileToFhirBundle(xlsxFile([FHIR_EXCEL_COLUMNS]))).rejects.toThrow(
      'A planilha não possui linhas para conversão.',
    );
  });

  it('says the file has no sheet when the workbook has none', async () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} });

    await expect(convertExcelFileToFhirBundle(xlsxFile([FHIR_EXCEL_COLUMNS]))).rejects.toThrow(
      'A planilha enviada não possui abas para conversão.',
    );
  });
});

describe('downloadFhirExcelTemplate', () => {
  it('saves modelo-importacao-fhir.xlsx with one FHIR Import sheet whose header row is every column', () => {
    downloadFhirExcelTemplate();

    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    const [workbook, fileName] = vi.mocked(XLSX.writeFile).mock.calls[0];
    expect(fileName).toBe('modelo-importacao-fhir.xlsx');
    expect(workbook.SheetNames).toEqual(['FHIR Import']);
    const [header] = XLSX.utils.sheet_to_json(workbook.Sheets['FHIR Import'], { header: 1 });
    expect(header).toEqual(FHIR_EXCEL_COLUMNS);
  });
});
