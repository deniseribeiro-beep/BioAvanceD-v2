// RF020 AC5-AC8 (#1322): the MIABIS export of Biobank and Collection
// (MAP-V2-010/011), its national extensions and its round-trip loss report.
// Pure: the caller reads the stored records. See
// docs/decisions/2026-10-23-miabis-export.md. The two tables below are the
// one place a later approved MIABIS mapping release changes.

// [miabisElement, canonicalField]. The P1X rows (P1X-0036..0043) are MIABIS's
// own attribute names; the others name the ELM fields.
const BIOBANK_MAPPING = Object.freeze([
  ['id', 'biobankId'],
  ['acronym', 'acronym'],
  ['name', 'biobankName'],
  ['description', 'biobankDescription'],
  ['url', 'url'],
  ['juristicPerson', 'legalEntityId'],
  ['country', 'countryCode'],
  ['contactInformation', 'contactInformation'],
  ['infrastructuralCapabilities', 'infrastructuralCapabilities'],
  ['organisationalCapabilities', 'organisationalCapabilities'],
  ['bioprocessingAndAnalyticalCapabilities', 'bioprocessingAnalyticalCapabilities'],
  ['qualityManagementStandards', 'qualityManagementStandards'],
].map((pair) => Object.freeze(pair)));

const COLLECTION_MAPPING = Object.freeze([
  ['id', 'collectionId'],
  ['acronym', 'acronym'],
  ['name', 'collectionName'],
  ['description', 'collectionDescription'],
  ['url', 'url'],
  ['contactInformation', 'contactInformation'],
  ['materialTypes', 'sampleTypes'],
  ['dataCategories', 'datasetTypes'],
  ['diseases', 'diseaseScope'],
  ['inclusionCriteria', 'inclusionCriteriaCategories'],
  ['exclusionCriteria', 'exclusionCriteria'],
  ['useAndAccessConditions', 'miabisUseAccessConditions'],
  ['storageTemperatures', 'storageTemperatureCategories'],
  ['sex', 'sexCategories'],
  ['ageLow', 'ageLow'],
  ['ageHigh', 'ageHigh'],
  ['numberOfSubjects', 'participantCount'],
  ['publications', 'relatedPublications'],
  // P1X-0047, 0051-0054, 0345-0347, under their dictionary names.
  ['sampleSource', 'sampleSource'],
  ['ageLowUnit', 'ageLowUnit'],
  ['ageHighUnit', 'ageHighUnit'],
  ['sampleCollectionSettings', 'sampleCollectionSettings'],
  ['collectionDesigns', 'collectionDesigns'],
  ['inclusionCriteriaDescription', 'inclusionCriteriaDescription'],
  ['duoCodes', 'duoCodes'],
  ['accessConditionsText', 'accessConditionsText'],
].map((pair) => Object.freeze(pair)));

// Brazilian governance extensions carried beside the MIABIS record, never
// inside it (MAP-V2-010/011's round-trip limitation). The governanceContext is
// carried whole, with its CAAE, ethics approval and custodian (V2E-0428).
const NATIONAL_EXTENSIONS = Object.freeze({
  Biobank: Object.freeze([]),
  Collection: Object.freeze(['governanceRegime', 'governanceContextId', 'governanceContext']),
});

const SYSTEM_FIELDS = Object.freeze(['_id', 'createdAt', 'updatedAt']);

const MAPPINGS = Object.freeze([
  Object.freeze({ mappingId: 'MAP-V2-010', canonicalEntity: 'Biobank', target: 'Biobank', relationship: 'partial', status: 'prepared Phase 1' }),
  Object.freeze({ mappingId: 'MAP-V2-011', canonicalEntity: 'Collection', target: 'Collection', relationship: 'partial', status: 'prepared Phase 1' }),
]);

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

const byText = (a, b) => String(a).localeCompare(String(b));

// One stored record: its MIABIS element values, its national extensions, and
// the non-empty fields neither carries.
function exportRecord(entity, record, mapping) {
  const miabis = {};
  for (const [element, field] of mapping) {
    miabis[element] = isEmpty(record[field]) ? null : record[field];
  }

  const extensions = NATIONAL_EXTENSIONS[entity];
  const nationalExtensions = {};
  for (const field of extensions) {
    if (!isEmpty(record[field])) nationalExtensions[field] = record[field];
  }

  const carried = new Set([...mapping.map(([, field]) => field), ...extensions, ...SYSTEM_FIELDS]);
  const dropped = Object.keys(record)
    .filter((field) => !carried.has(field) && !isEmpty(record[field]))
    .map((field) => ({ entity, id: miabis.id, field }));

  return { exported: { miabis, nationalExtensions }, dropped };
}

function exportAll(entity, records, mapping) {
  const results = (Array.isArray(records) ? records : [])
    .map((record) => exportRecord(entity, record || {}, mapping));
  return {
    records: results.map((result) => result.exported).sort((a, b) => byText(a.miabis.id, b.miabis.id)),
    dropped: results.flatMap((result) => result.dropped),
  };
}

function buildMiabisExport({ biobanks, collections, generatedAt } = {}) {
  const biobankExport = exportAll('Biobank', biobanks, BIOBANK_MAPPING);
  const collectionExport = exportAll('Collection', collections, COLLECTION_MAPPING);
  const dropped = [...biobankExport.dropped, ...collectionExport.dropped]
    .sort((a, b) => byText(a.entity, b.entity) || byText(a.id, b.id) || byText(a.field, b.field));

  return {
    standard: 'MIABIS',
    standardVersion: '3.0',
    mappings: MAPPINGS.map((mapping) => ({ ...mapping })),
    // MAP-V2-010/011 read prepared Phase 1: no approved release is stored, and
    // no conformance is claimed (RF020 AC8).
    mappingReleaseId: null,
    conformanceClaimed: false,
    generatedAt,
    biobanks: biobankExport.records,
    collections: collectionExport.records,
    roundTripLoss: { droppedFieldCount: dropped.length, dropped },
  };
}

module.exports = {
  buildMiabisExport,
  BIOBANK_MAPPING,
  COLLECTION_MAPPING,
  NATIONAL_EXTENSIONS,
  SYSTEM_FIELDS,
};
