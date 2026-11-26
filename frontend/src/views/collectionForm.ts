import { Collection } from '../types/models';

const COLLECTION_CODEABLE_CONCEPT_FIELDS = [
  'sampleTypes',
  'datasetTypes',
  'diseaseScope',
  'inclusionCriteriaCategories',
  'miabisUseAccessConditions',
  'storageTemperatureCategories',
] as const;

type CollectionCodeableConceptField = (typeof COLLECTION_CODEABLE_CONCEPT_FIELDS)[number];

export function parseSemicolonTags(text: string): string[] {
  return text.split(';').map((s) => s.trim()).filter(Boolean);
}

export function formatSemicolonTags(items: Array<Record<string, unknown>> | undefined, key: string): string {
  if (!Array.isArray(items)) {
    return '';
  }
  return items.map((item) => String(item?.[key] ?? '')).filter(Boolean).join('; ');
}

export interface CollectionFormState {
  collectionId: string;
  collectionName: string;
  collectionStatus: string;
  governanceRegime: string;
  exclusionCriteria: string;
  participantCount: string;
  sampleCount: string;
  relatedPublicationsText: string;
  sampleTypesText: string;
  datasetTypesText: string;
  diseaseScopeText: string;
  inclusionCriteriaCategoriesText: string;
  miabisUseAccessConditionsText: string;
  storageTemperatureCategoriesText: string;
}

export function buildCollectionFormState(collection: Collection | null): CollectionFormState {
  return {
    collectionId: collection?.collectionId || '',
    collectionName: collection?.collectionName || '',
    collectionStatus: collection?.collectionStatus || 'active',
    governanceRegime: collection?.governanceRegime || '',
    exclusionCriteria: collection?.exclusionCriteria || '',
    participantCount: collection?.participantCount != null ? String(collection.participantCount) : '',
    sampleCount: collection?.sampleCount != null ? String(collection.sampleCount) : '',
    relatedPublicationsText: formatSemicolonTags(collection?.relatedPublications, 'value'),
    sampleTypesText: formatSemicolonTags(collection?.sampleTypes, 'text'),
    datasetTypesText: formatSemicolonTags(collection?.datasetTypes, 'text'),
    diseaseScopeText: formatSemicolonTags(collection?.diseaseScope, 'text'),
    inclusionCriteriaCategoriesText: formatSemicolonTags(collection?.inclusionCriteriaCategories, 'text'),
    miabisUseAccessConditionsText: formatSemicolonTags(collection?.miabisUseAccessConditions, 'text'),
    storageTemperatureCategoriesText: formatSemicolonTags(collection?.storageTemperatureCategories, 'text'),
  };
}

const CODEABLE_CONCEPT_TEXT_KEY: Record<CollectionCodeableConceptField, keyof CollectionFormState> = {
  sampleTypes: 'sampleTypesText',
  datasetTypes: 'datasetTypesText',
  diseaseScope: 'diseaseScopeText',
  inclusionCriteriaCategories: 'inclusionCriteriaCategoriesText',
  miabisUseAccessConditions: 'miabisUseAccessConditionsText',
  storageTemperatureCategories: 'storageTemperatureCategoriesText',
};

export function buildCollectionSubmissionPayload(formData: CollectionFormState): Partial<Collection> {
  const payload: Partial<Collection> = {
    collectionId: formData.collectionId.trim(),
    collectionName: formData.collectionName.trim(),
    collectionStatus: formData.collectionStatus || 'active',
    governanceRegime: (formData.governanceRegime || null) as Collection['governanceRegime'],
    exclusionCriteria: formData.exclusionCriteria.trim() || null,
    participantCount: formData.participantCount.trim() === '' ? null : Number(formData.participantCount),
    sampleCount: formData.sampleCount.trim() === '' ? null : Number(formData.sampleCount),
    relatedPublications: parseSemicolonTags(formData.relatedPublicationsText).map((value) => ({ value })),
  };

  for (const field of COLLECTION_CODEABLE_CONCEPT_FIELDS) {
    const textValue = formData[CODEABLE_CONCEPT_TEXT_KEY[field]] as string;
    payload[field] = parseSemicolonTags(textValue).map((text) => ({ text }));
  }

  return payload;
}
