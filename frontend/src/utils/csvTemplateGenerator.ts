const IMPORT_TEMPLATE_FILENAME = 'BioAvanceD_Import_Template_v1.csv';

const IMPORT_TEMPLATE_HEADERS = [
  'patient_cpf',
  'patient_name',
  'patient_dob',
  'patient_sex',
  'consent_status',
  'sample_ext_id',
  'sample_type',
  'collection_date',
  'alpha_gal_value',
  'lyso_gb3_value',
];

const IMPORT_TEMPLATE_SAMPLE_ROW = [
  '12345678909',
  'Maria Silva',
  '1985-04-12',
  'F',
  'ACTIVE',
  'TUBE-8841',
  'DBS',
  '2026-03-18',
  '1.2',
  '14.5',
];

export function downloadImportTemplate(): void {
  const csvContent = [
    IMPORT_TEMPLATE_HEADERS.join(','),
    IMPORT_TEMPLATE_SAMPLE_ROW.join(','),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = IMPORT_TEMPLATE_FILENAME;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}