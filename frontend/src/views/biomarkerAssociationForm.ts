import type { BiomarkerAssociation, BiomarkerEvidenceReference, BiomarkerRole, Coding } from '../types/models';

export const CONDITION_SYSTEMS = [
  { uri: 'http://www.orpha.net', label: 'ORPHA' },
  { uri: 'http://id.who.int/icd/release/11/mms', label: 'ICD-11' },
  { uri: 'http://purl.obolibrary.org/obo/mondo.owl', label: 'MONDO' },
];

export const BIOMARKER_ROLES: BiomarkerRole[] = ['diagnostic', 'prognostic', 'risk', 'safety', 'monitoring', 'response'];

export const EVIDENCE_SYSTEMS: BiomarkerEvidenceReference['system'][] = ['DOI', 'PMID'];

export type CodingRow = { systemUri: string; code: string; version: string; display: string };
export type EvidenceRow = { system: string; value: string };
export type BiomarkerAssociationFormState = {
  biomarkerId: string;
  analyte: CodingRow;
  associatedCondition: CodingRow[];
  biomarkerRole: string;
  contextOfUse: string;
  evidenceReferences: EvidenceRow[];
};

export const emptyCoding = (systemUri = ''): CodingRow => ({ systemUri, code: '', version: '', display: '' });
export const emptyEvidence = (): EvidenceRow => ({ system: 'DOI', value: '' });

export function emptyBiomarkerAssociationForm(): BiomarkerAssociationFormState {
  return {
    biomarkerId: '',
    analyte: emptyCoding(),
    associatedCondition: [emptyCoding(CONDITION_SYSTEMS[0].uri)],
    biomarkerRole: '',
    contextOfUse: '',
    evidenceReferences: [emptyEvidence()],
  };
}

function codingRow(coding: Partial<Coding> | null | undefined): CodingRow {
  return {
    systemUri: coding?.systemUri ?? '',
    code: coding?.code ?? '',
    version: coding?.version ?? '',
    display: coding?.display ?? '',
  };
}

export function biomarkerAssociationFormOf(row: BiomarkerAssociation): BiomarkerAssociationFormState {
  const conditions = Array.isArray(row.associatedCondition) ? row.associatedCondition : [];
  const evidence = Array.isArray(row.evidenceReferences) ? row.evidenceReferences : [];
  return {
    biomarkerId: row.biomarkerId,
    analyte: codingRow(row.analyte),
    associatedCondition: conditions.length > 0 ? conditions.map(codingRow) : [emptyCoding(CONDITION_SYSTEMS[0].uri)],
    biomarkerRole: row.biomarkerRole ?? '',
    contextOfUse: row.contextOfUse ?? '',
    evidenceReferences: evidence.length > 0
      ? evidence.map((item) => ({ system: item?.system ?? 'DOI', value: item?.value ?? '' }))
      : [emptyEvidence()],
  };
}

function toCoding(row: CodingRow): Coding {
  const coding: Coding = { systemUri: row.systemUri.trim(), code: row.code.trim() };
  const version = row.version.trim();
  if (version) coding.version = version;
  const display = row.display.trim();
  if (display) coding.display = display;
  return coding;
}

export function requiredBiomarkerAssociationFieldsOf(form: BiomarkerAssociationFormState) {
  return {
    analyte: toCoding(form.analyte),
    associatedCondition: form.associatedCondition.map(toCoding),
    biomarkerRole: form.biomarkerRole.trim() as BiomarkerRole,
    contextOfUse: form.contextOfUse.trim(),
    evidenceReferences: form.evidenceReferences.map((item) => ({
      system: item.system.trim() as BiomarkerEvidenceReference['system'],
      value: item.value.trim(),
    })),
  };
}

export function biomarkerAssociationErrorMessages(err: any, fallback: string): string[] {
  const data = err?.response?.data;
  const message = data?.message || data?.error || err?.message || fallback;
  const details = Array.isArray(data?.details)
    ? data.details.map((item: any) => (typeof item === 'string' ? item : item?.message)).filter(Boolean)
    : [];
  return [message, ...details];
}
