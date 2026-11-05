import * as XLSX from 'xlsx';

export const FHIR_EXCEL_COLUMNS = [
  'patient_external_id',
  'patient_name',
  'patient_document',
  'patient_email',
  'patient_birth_date',
  'patient_sex',
  'disease_name',
  'cid10',
  'orpha_code',
  'omim_code',
  'sample_external_id',
  'sample_type',
  'matrix',
  'collection_datetime',
  'storage_temperature',
  'sprecs_raw',
  'processing_unknown',
  'biomarker_type',
  'biomarker_value',
  'biomarker_unit',
  'hpo_code',
  'hpo_label',
];

const REQUIRED_COLUMNS = FHIR_EXCEL_COLUMNS;

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function makeCoding(system, code, display) {
  const nextCode = clean(code);
  if (!nextCode) return null;
  return {
    system,
    code: nextCode,
    ...(clean(display) ? { display: clean(display) } : {}),
  };
}

function splitName(name) {
  const text = clean(name);
  const parts = text.split(/\s+/).filter(Boolean);
  return {
    text,
    family: parts.length > 1 ? parts.at(-1) : text,
    given: parts.length > 1 ? parts.slice(0, -1) : [],
  };
}

function rowToBundleEntries(row, index) {
  const patientId = clean(row.patient_external_id) || `patient-${index + 1}`;
  const sampleId = clean(row.sample_external_id) || `specimen-${index + 1}`;
  const patientName = splitName(row.patient_name);
  const diseaseCodings = [
    makeCoding('http://hl7.org/fhir/sid/icd-10', row.cid10, row.disease_name),
    makeCoding('http://www.orpha.net', row.orpha_code, row.disease_name),
    makeCoding('https://omim.org/entry', row.omim_code, row.disease_name),
  ].filter(Boolean);

  const entries = [
    {
      fullUrl: `urn:uuid:${patientId}`,
      resource: {
        resourceType: 'Patient',
        id: patientId,
        identifier: clean(row.patient_document)
          ? [{ system: 'urn:bioavanced:patient-document', value: clean(row.patient_document) }]
          : [],
        name: patientName.text ? [patientName] : [],
        ...(clean(row.patient_birth_date) ? { birthDate: clean(row.patient_birth_date) } : {}),
        ...(clean(row.patient_sex) ? { gender: clean(row.patient_sex).toLowerCase() } : {}),
        telecom: [
          clean(row.patient_email) ? { system: 'email', value: clean(row.patient_email) } : null,
        ].filter(Boolean),
      },
    },
    {
      fullUrl: `urn:uuid:${sampleId}`,
      resource: {
        resourceType: 'Specimen',
        id: sampleId,
        subject: { reference: `Patient/${patientId}` },
        type: {
          text: clean(row.sample_type),
        },
        ...(clean(row.collection_datetime)
          ? { collection: { collectedDateTime: clean(row.collection_datetime) } }
          : {}),
        container: [
          {
            identifier: clean(row.sample_external_id)
              ? [{ system: 'urn:bioavanced:sample-external-id', value: clean(row.sample_external_id) }]
              : [],
          },
        ],
        extension: [
          clean(row.matrix)
            ? { url: 'urn:bioavanced:matrix', valueString: clean(row.matrix) }
            : null,
          clean(row.storage_temperature)
            ? { url: 'urn:bioavanced:storage-temperature', valueString: clean(row.storage_temperature) }
            : null,
          clean(row.sprecs_raw)
            ? { url: 'urn:bioavanced:sprecs-raw', valueString: clean(row.sprecs_raw) }
            : null,
          clean(row.processing_unknown)
            ? { url: 'urn:bioavanced:processing-unknown', valueBoolean: /^(true|sim|1)$/i.test(clean(row.processing_unknown)) }
            : null,
        ].filter(Boolean),
      },
    },
  ];

  if (clean(row.disease_name) || diseaseCodings.length) {
    entries.push({
      fullUrl: `urn:uuid:condition-${patientId}-${index + 1}`,
      resource: {
        resourceType: 'Condition',
        subject: { reference: `Patient/${patientId}` },
        code: {
          coding: diseaseCodings,
          text: clean(row.disease_name),
        },
      },
    });
  }

  if (clean(row.biomarker_type)) {
    entries.push({
      fullUrl: `urn:uuid:biomarker-${sampleId}-${index + 1}`,
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: { text: clean(row.biomarker_type) },
        subject: { reference: `Patient/${patientId}` },
        specimen: { reference: `Specimen/${sampleId}` },
        ...(clean(row.biomarker_value)
          ? {
              valueQuantity: {
                value: Number.isNaN(Number(clean(row.biomarker_value))) ? clean(row.biomarker_value) : Number(clean(row.biomarker_value)),
                ...(clean(row.biomarker_unit) ? { unit: clean(row.biomarker_unit) } : {}),
              },
            }
          : {}),
      },
    });
  }

  if (clean(row.hpo_code)) {
    entries.push({
      fullUrl: `urn:uuid:hpo-${patientId}-${index + 1}`,
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://purl.obolibrary.org/obo/hp.owl',
              code: clean(row.hpo_code),
              ...(clean(row.hpo_label) ? { display: clean(row.hpo_label) } : {}),
            },
          ],
          text: clean(row.hpo_label) || clean(row.hpo_code),
        },
        subject: { reference: `Patient/${patientId}` },
      },
    });
  }

  return entries;
}

export function downloadFhirExcelTemplate() {
  const sample = Object.fromEntries(FHIR_EXCEL_COLUMNS.map((column) => [column, '']));
  const worksheet = XLSX.utils.json_to_sheet([sample], { header: FHIR_EXCEL_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'FHIR Import');
  XLSX.writeFile(workbook, 'modelo-importacao-fhir.xlsx');
}

export async function convertExcelFileToFhirBundle(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error('A planilha enviada não possui abas para conversão.');
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  const [headerRow = []] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const headers = headerRow.map(String);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`Colunas obrigatórias ausentes: ${missingColumns.join(', ')}`);
  }

  if (rows.length === 0) {
    throw new Error('A planilha não possui linhas para conversão.');
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: rows.flatMap(rowToBundleEntries),
  };
}
