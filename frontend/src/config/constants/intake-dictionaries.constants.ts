import { BIOMARKER_DICTIONARY as BASE_BIOMARKER_DICTIONARY } from './biomarkers.constants';
import { EXTRACTION_PROTOCOLS, MIABIS_QUALITY, SAMPLE_ORIGINS, SPECIMEN_TYPES } from './specimen.constants';

export type IntakeDictionaryCategoryKey =
  | 'sample_types'
  | 'anatomical_origins'
  | 'extraction_protocols'
  | 'clinical_comorbidities'
  | 'biomarkers'
  | 'consent_types'
  | 'pre_analytical_qualities';

export type IntakeDictionaryItem = {
  _id?: string;
  id?: string | number;
  name?: string;
  label?: string;
  slug?: string;
  value?: string;
  code?: string;
  active?: boolean;
  is_active?: boolean;
  unit?: string;
  measurementUnit?: string;
  placeholder?: string;
  step?: string;
};

export type IntakeDictionarySet = {
  sampleTypes: IntakeDictionaryItem[];
  anatomicalOrigins: IntakeDictionaryItem[];
  extractionProtocols: IntakeDictionaryItem[];
  clinicalComorbidities: IntakeDictionaryItem[];
  biomarkers: IntakeDictionaryItem[];
  consentTypes: IntakeDictionaryItem[];
  preAnalyticalQualities: IntakeDictionaryItem[];
};

export const CLINICAL_COMORBIDITIES: Array<{ id: string; label: string }> = [
  { id: 'hypertension', label: 'Hipertensão arterial' },
  { id: 'diabetesType1', label: 'Diabetes tipo 1' },
  { id: 'diabetesType2', label: 'Diabetes tipo 2' },
  { id: 'obesity', label: 'Obesidade' },
  { id: 'copd', label: 'DPOC' },
  { id: 'ckd', label: 'Doença renal crônica' },
  { id: 'asthma', label: 'Asma' },
  { id: 'smoking', label: 'Tabagismo' },
  { id: 'alcoholUse', label: 'Uso de álcool' },
  { id: 'antibioticUse', label: 'Uso de antibiótico' },
  { id: 'insulinUse', label: 'Uso de insulina' },
  { id: 'antiviralUse', label: 'Uso de antiviral' },
];

export const BIOMARKER_DICTIONARY = BASE_BIOMARKER_DICTIONARY;

export function slugifyDictionaryValue(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function isActiveItem(item: IntakeDictionaryItem) {
  if (item.active !== undefined) {
    return Boolean(item.active);
  }

  if (item.is_active !== undefined) {
    return Boolean(item.is_active);
  }

  return true;
}

export function normalizeIntakeDictionaryItem(item: IntakeDictionaryItem) {
  const name = String(item?.name || item?.label || '').trim();
  const label = String(item?.label || item?.name || '').trim();
  const slug = String(item?.slug || item?.value || item?.code || slugifyDictionaryValue(name || label)).trim();
  const unit = String(item?.unit || item?.measurementUnit || '').trim();
  const placeholder = String(item?.placeholder || '').trim();

  return {
    ...item,
    name,
    label: label || name,
    slug,
    value: slug,
    unit,
    measurementUnit: unit,
    placeholder,
    active: isActiveItem(item),
    is_active: isActiveItem(item),
  } as IntakeDictionaryItem;
}

export function createIntakeDictionaryItem(entry: { id: string; label: string; unit?: string; placeholder?: string; step?: string }) {
  return normalizeIntakeDictionaryItem({
    slug: entry.id,
    value: entry.id,
    code: entry.id,
    name: entry.label,
    label: entry.label,
    unit: entry.unit,
    measurementUnit: entry.unit,
    placeholder: entry.placeholder,
    step: entry.step,
    active: true,
    is_active: true,
  });
}

export function createIntakeDictionarySet(): IntakeDictionarySet {
  return {
    sampleTypes: SPECIMEN_TYPES.map(createIntakeDictionaryItem),
    anatomicalOrigins: SAMPLE_ORIGINS.map(createIntakeDictionaryItem),
    extractionProtocols: EXTRACTION_PROTOCOLS.map(createIntakeDictionaryItem),
    clinicalComorbidities: CLINICAL_COMORBIDITIES.map(createIntakeDictionaryItem),
    biomarkers: BIOMARKER_DICTIONARY.map(createIntakeDictionaryItem),
    consentTypes: [],
    preAnalyticalQualities: MIABIS_QUALITY.map(createIntakeDictionaryItem),
  };
}