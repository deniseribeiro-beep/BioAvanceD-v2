// RF011 AC6, RNF024 C6 (#1322): the round-trip loss of FHIR Bundle staging.
// stageBundle maps Patient, Specimen, Consent, Condition and Observation onto
// the staged record's `normalized` fields; this module names, as paths only,
// the FHIR elements no such field carries and the resources no record
// attaches, and declares the losses a path list cannot show. It mirrors the
// reads of fhir-import-staging.service.js (normalizeSpecimen and its helpers)
// and must change with them. It carries no value, id or extension url from a
// resource: the staged record's `fhir` and `normalized` are sealed at rest,
// this report is not (see
// docs/decisions/2026-10-23-fhir-round-trip-loss-record.md).

const ROUND_TRIP_LIMITATIONS = Object.freeze([
  'Specimen.type: apenas o primeiro valor não vazio entre text, coding[0].display e coding[0].code é mantido.',
  'Data de coleta: apenas o primeiro valor não vazio entre collection.collectedDateTime, collection.collectedDate e receivedTime é mantido.',
  'Código de barras: apenas o primeiro valor não vazio entre container[0].identifier[0].value e accessionIdentifier.value é mantido.',
  'Extensões do Specimen: apenas o primeiro valor[x] presente (valueString, valueCode, valueBoolean, valueInteger, valueDecimal) é mantido.',
  'Patient.name[0]: text, quando presente, substitui given e family.',
  'Apenas o primeiro Patient.name é lido.',
  'Observation de biomarcador: apenas o primeiro tipo não vazio (code.text, coding[0].display, coding[0].code) e o primeiro valor presente (valueQuantity.value, valueString, valueCodeableConcept.text) são mantidos.',
  'Uma extensão repetida após a primeira que corresponde à mesma URL é ignorada.',
  'Uma Observation ligada ao paciente e ao espécime é listada duas vezes.',
  'O system do identificador do Patient não é mantido.',
  'Condition: diseaseName mantém apenas o primeiro valor não vazio entre code.text e os display de CID, Orpha e OMIM.',
  'Nenhum system de coding (Condition, Observation) é mantido.',
  'A lista de campos não mapeados de cada registro guarda no máximo os primeiros 50 caminhos; unmappedCount conta todos e truncated indica o corte.',
  'Os elementos do próprio Bundle (meta, type, entry[].fullUrl, entry[].request e qualquer outra chave de nível superior) não são mantidos.',
]);

const SPECIMEN_EXTENSION_PARTS = ['matrix', 'storage-temperature', 'sprecs', 'rcs-gov-required', 'processing-unknown'];
const EXTENSION_VALUE_KEYS = ['valueString', 'valueCode', 'valueBoolean', 'valueInteger', 'valueDecimal'];
const CONDITION_TERM_GROUPS = [['icd', 'cid'], ['orpha'], ['omim']];
// A record stores at most this many paths; unmappedCount counts them all.
const MAX_UNMAPPED_PATHS = 50;
const IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const collator = new Intl.Collator(undefined, { numeric: true });

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlank(value) {
  return !String(value || '').trim();
}

function normalizePatientRef(reference = '') {
  return String(reference || '').replace(/^Patient\//i, '').replace(/^urn:uuid:/i, '').trim();
}

function codingMatches(coding, terms) {
  const item = coding || {};
  const system = String(item.system || '').toLowerCase();
  const code = String(item.code || '').toLowerCase();
  const display = String(item.display || '').toLowerCase();
  return terms.some((term) => system.includes(term) || code.includes(term) || display.includes(term));
}

// Every leaf path of a resource, `resourceType` excluded: a leaf is a value
// that is neither a plain object nor an array; an empty one yields none. A
// key that is not an identifier is quoted, `["name[0]"]`, so no leaf under
// it can match a mapped path.
function leafPaths(resource) {
  const prefix = String(resource.resourceType || '');
  const found = [];
  const stack = [{ value: resource, path: prefix, root: true }];
  while (stack.length) {
    const { value, path, root } = stack.pop();
    if (Array.isArray(value)) {
      value.forEach((child, i) => stack.push({ value: child, path: `${path}[${i}]` }));
    } else if (isPlainObject(value)) {
      Object.keys(value).forEach((key) => {
        if (root && key === 'resourceType') return;
        const step = IDENTIFIER_KEY.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
        stack.push({ value: value[key], path: `${path}${step}` });
      });
    } else if (value !== undefined) {
      found.push(path);
    }
  }
  return found;
}

// The index extractIdentifier(resource, preferredSystem) reads, or -1: the
// first identifier whose system includes preferredSystem, unless that element
// is falsy, else the first with a non-blank value.
function identifierIndex(identifiers, preferredSystem = '') {
  const preferred = identifiers.findIndex((identifier) => String(identifier?.system || '').toLowerCase().includes(preferredSystem));
  if (preferred >= 0 && identifiers[preferred]) return preferred;
  return identifiers.findIndex((identifier) => !isBlank(identifier?.value));
}

// extractIdentifier(patient, 'cpf') || extractIdentifier(patient): the index
// whose value becomes patientDocument, or -1.
function patientDocumentIndex(identifiers) {
  const cpf = identifierIndex(identifiers, 'cpf');
  if (cpf >= 0 && !isBlank(identifiers[cpf]?.value)) return cpf;
  return identifierIndex(identifiers);
}

function patientMapped(patient, specimen) {
  const mapped = ['Patient.id', 'Patient.name[0].text', 'Patient.name[0].family', 'Patient.birthDate', 'Patient.gender'];
  const name = asArray(patient.name)[0];
  asArray(name?.given).forEach((_, i) => mapped.push(`Patient.name[0].given[${i}]`));

  const identifiers = asArray(patient.identifier);
  const document = patientDocumentIndex(identifiers);
  if (document >= 0) mapped.push(`Patient.identifier[${document}].value`);
  if (!patient.id && !normalizePatientRef(specimen?.subject?.reference)) {
    const participant = identifierIndex(identifiers);
    if (participant >= 0) mapped.push(`Patient.identifier[${participant}].value`);
  }

  const telecom = asArray(patient.telecom);
  ['email', 'phone'].forEach((system) => {
    const k = telecom.findIndex((item) => item?.system === system);
    if (k >= 0) mapped.push(`Patient.telecom[${k}].value`, `Patient.telecom[${k}].system`);
  });
  return mapped;
}

function specimenMapped(specimen) {
  const mapped = [
    'Specimen.id',
    'Specimen.subject.reference',
    'Specimen.type.text',
    'Specimen.type.coding[0].display',
    'Specimen.type.coding[0].code',
    'Specimen.collection.collectedDateTime',
    'Specimen.collection.collectedDate',
    'Specimen.receivedTime',
    'Specimen.container[0].identifier[0].value',
    'Specimen.accessionIdentifier.value',
  ];
  if (!specimen.id) {
    const k = identifierIndex(asArray(specimen.identifier));
    if (k >= 0) mapped.push(`Specimen.identifier[${k}].value`);
  }

  const extensions = asArray(specimen.extension);
  SPECIMEN_EXTENSION_PARTS.forEach((part) => {
    const k = extensions.findIndex((item) => String(item?.url || '').toLowerCase().includes(part));
    if (k < 0) return;
    mapped.push(`Specimen.extension[${k}].url`);
    EXTENSION_VALUE_KEYS.forEach((key) => mapped.push(`Specimen.extension[${k}].${key}`));
  });
  return mapped;
}

function consentMapped() {
  return ['Consent.status', 'Consent.patient.reference', 'Consent.subject.reference'];
}

// A matched coding's code and display; its system is kept nowhere.
function codingPaths(prefix, k) {
  return ['code', 'display'].map((key) => `${prefix}.code.coding[${k}].${key}`);
}

function conditionMapped(condition) {
  const mapped = ['Condition.code.text', 'Condition.subject.reference', 'Condition.patient.reference'];
  const codings = asArray(condition.code?.coding);
  CONDITION_TERM_GROUPS.forEach((terms) => {
    const k = codings.findIndex((coding) => codingMatches(coding, terms));
    if (k >= 0) mapped.push(...codingPaths('Condition', k));
  });
  return mapped;
}

function observationMapped(observation) {
  const mapped = [
    'Observation.code.text',
    'Observation.subject.reference',
    'Observation.patient.reference',
    'Observation.specimen.reference',
  ];
  const codings = asArray(observation.code?.coding);
  const hpo = codings.findIndex((coding) => codingMatches(coding, ['hpo', 'hp:']));
  if (hpo >= 0) return [...mapped, ...codingPaths('Observation', hpo)];
  return [
    ...mapped,
    'Observation.code.coding[0].display',
    'Observation.code.coding[0].code',
    'Observation.valueQuantity.value',
    'Observation.valueQuantity.unit',
    'Observation.valueQuantity.code',
    'Observation.valueString',
    'Observation.valueCodeableConcept.text',
  ];
}

// One resource's unmapped paths, sorted.
function unmappedPaths(resource, mapped) {
  const carried = new Set(mapped());
  return leafPaths(resource).filter((path) => !carried.has(path)).sort(collator.compare);
}

// One staged record's loss: every leaf of its FHIR resources that no
// `normalized` field carries, counted in unmappedCount and listed as
// { source, path }, sorted by source then path, up to MAX_UNMAPPED_PATHS.
// `cache` (a WeakMap a caller shares across one Bundle's records) keeps the
// paths of a Consent, Condition or Observation several records attach, whose
// mapping depends on the resource alone.
function buildRecordRoundTripLoss(fhir = {}, cache = null) {
  const { patient, specimen } = fhir || {};
  const sources = [
    { source: 'patient', resource: patient, paths: () => unmappedPaths(patient, () => patientMapped(patient, specimen)) },
    { source: 'specimen', resource: specimen, paths: () => unmappedPaths(specimen, () => specimenMapped(specimen)) },
  ];
  [
    ['consents', consentMapped],
    ['conditions', conditionMapped],
    ['observations', observationMapped],
  ].forEach(([group, mapper]) => {
    asArray(fhir?.[group]).forEach((resource, i) => {
      const paths = () => {
        if (cache && cache.has(resource)) return cache.get(resource);
        const found = unmappedPaths(resource, () => mapper(resource));
        if (cache) cache.set(resource, found);
        return found;
      };
      sources.push({ source: `${group}[${i}]`, resource, paths });
    });
  });
  sources.sort((a, b) => collator.compare(a.source, b.source));

  let unmappedCount = 0;
  const unmapped = [];
  sources.forEach(({ source, resource, paths }) => {
    if (!isPlainObject(resource)) return;
    const found = paths();
    unmappedCount += found.length;
    for (let i = 0; i < found.length && unmapped.length < MAX_UNMAPPED_PATHS; i += 1) {
      unmapped.push({ source, path: found[i] });
    }
  });

  return {
    unmappedCount,
    unmapped,
    truncated: unmappedCount > unmapped.length,
    limitations: ROUND_TRIP_LIMITATIONS,
  };
}

// The batch's loss: each Bundle resource (its index among the entries'
// resources) that no staged record attaches.
function buildBundleRoundTripLoss(resources = [], records = []) {
  const attached = new Set();
  asArray(records).forEach((record) => {
    const fhir = record?.fhir || {};
    [fhir.patient, fhir.specimen, ...asArray(fhir.consents), ...asArray(fhir.conditions), ...asArray(fhir.observations)]
      .forEach((resource) => { if (resource) attached.add(resource); });
  });

  const unattached = [];
  asArray(resources).forEach((resource, resourceIndex) => {
    if (attached.has(resource)) return;
    const resourceType = isPlainObject(resource) && resource.resourceType != null ? String(resource.resourceType) : null;
    unattached.push({ resourceIndex, resourceType });
  });

  return { unattachedResourceCount: unattached.length, unattached };
}

module.exports = {
  MAX_UNMAPPED_PATHS,
  ROUND_TRIP_LIMITATIONS,
  buildRecordRoundTripLoss,
  buildBundleRoundTripLoss,
};
