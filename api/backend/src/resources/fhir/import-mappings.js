// RF011 AC4, RF011 AC6, RF011 AC7, MAP-V2-006..009 (#1322): the import of
// Provenance, AuditEvent, DocumentReference and ResearchStudy, the inverse of
// the export transforms in fhir.service.js. Each is mapped by a pure
// transform into a canonical candidate; staging records, on the batch, which
// canonical fields each resource fills and which of its paths no field
// carries. The batch document is not sealed at rest (the staged records'
// `fhir` and `normalized` are, #1191), so the report holds field names and
// paths only, never a value, id, URI, pseudonym or title. A value outside a
// closed table is left unmapped, never replaced by a guessed field (RF011
// AC6, "no forced equivalence"). commitBatch writes no record of Provenance,
// AuditEvent or DocumentReference. A ResearchStudy whose candidate is a valid
// Study is the exception: the batch keeps, in studyCandidates, the four
// fields Study.create stores, which the studies collection holds in
// plaintext too, and commitBatch creates the Study when none has its
// studyId. See
// docs/decisions/2026-10-24-fhir-import-provenance-auditevent-documentreference-researchstudy.md
// and docs/decisions/2026-10-25-fhir-import-research-study-commit.md.

const {
  EXPORT_MAPPINGS,
  RESEARCH_STUDY_STATUSES,
  PROVENANCE_PARTICIPANT_TYPE,
} = require('../../services/fhir.service');
const { leafPaths, MAX_UNMAPPED_PATHS } = require('./round-trip-loss');
const StudyModel = require('../../models/Study');

// A batch stores at most this many mapped resources; mappedResourceCount
// counts them all. A 20 MB Bundle of AuditEvents must not grow one batch
// document toward MongoDB's 16 MB limit.
const MAX_MAPPED_RESOURCES = 50;
const DOCUMENT_REFERENCE = /^DocumentReference\/(.+)$/;
const AUDIT_OUTCOME_DESCRIPTIONS = Object.freeze(['failure', 'attempted', 'resolved']);
const collator = new Intl.Collator(undefined, { numeric: true });

const IMPORT_ROUND_TRIP_LIMITATIONS = Object.freeze({
  Provenance: Object.freeze([
    'Nenhum WorkflowRun é criado: o Provenance não traz hardwareProfile nem environmentManifestUri, obrigatórios no WorkflowRun.',
    'O candidato canônico não é armazenado; o lote guarda apenas nomes de campos e caminhos, nunca valores.',
    'Apenas referências DocumentReference/<id> são mapeadas em target e entity.',
    'Apenas o primeiro agent do tipo author com identificador é mapeado.',
    'A lista de caminhos não mapeados guarda no máximo os primeiros 50; unmappedCount conta todos e truncated indica o corte.',
  ]),
  AuditEvent: Object.freeze([
    'Nenhum evento de auditoria é criado: a cadeia de hash é canônica e apenas o serviço de auditoria a escreve.',
    'O candidato canônico não é armazenado; o lote guarda apenas nomes de campos e caminhos, nunca valores.',
    'Apenas o primeiro agent requestor com identificador é mapeado.',
    'Um outcome diferente de 0 (4, 8, 12) não é mapeado.',
    'A lista de caminhos não mapeados guarda no máximo os primeiros 50; unmappedCount conta todos e truncated indica o corte.',
  ]),
  DocumentReference: Object.freeze([
    'Nenhum DataFile é criado: um DocumentReference sem o binário, que permanece no Object Storage, não é um DataFile.',
    'O candidato canônico não é armazenado; o lote guarda apenas nomes de campos e caminhos, nunca valores.',
    'Um status diferente de current não é mapeado.',
    'Um item de context.related com display Specimen é lido como specimenId, mesmo quando veio de linkedEntityRefs de um DataFile sem specimenId.',
    'A lista de caminhos não mapeados guarda no máximo os primeiros 50; unmappedCount conta todos e truncated indica o corte.',
  ]),
  ResearchStudy: Object.freeze([
    'Um Study é criado no commit do lote apenas quando studyId, studyTitle e ao menos um relatedArtifact documentation com label são lidos, e apenas quando nenhum Study tem esse studyId; um Study existente nunca é alterado.',
    'Apenas um Coordenador ou Administrador que faz o commit cria o Study.',
    'O lote guarda studyId, studyTitle, studyStatus e ethicsApprovalId até o commit, e nenhum outro valor.',
    'Um status fora dos códigos de status do ResearchStudy R4 não é mapeado.',
    'A lista de caminhos não mapeados guarda no máximo os primeiros 50; unmappedCount conta todos e truncated indica o corte.',
  ]),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireResource(resource, resourceType) {
  if (!isPlainObject(resource) || resource.resourceType !== resourceType) {
    throw new Error(`Recurso FHIR não é ${resourceType}`);
  }
  return resource;
}

// A transform's accumulator: `read` keeps a non-blank string as written,
// under `field`, and records its path.
function reader(prefix) {
  const candidate = {};
  const mappedPaths = [];
  return {
    candidate,
    mappedPaths,
    mark(path) { mappedPaths.push(`${prefix}${path}`); },
    read(field, value, path) {
      if (!isText(value)) return false;
      candidate[field] = value;
      mappedPaths.push(`${prefix}${path}`);
      return true;
    },
  };
}

function fhirDocumentId(reference) {
  const match = isText(reference) ? DOCUMENT_REFERENCE.exec(reference) : null;
  return match ? match[1] : null;
}

function fromFhirProvenance(resource) {
  const provenance = requireResource(resource, 'Provenance');
  const r = reader('Provenance');
  r.read('workflowRunId', provenance.id, '.id');

  const outputFileIds = [];
  asArray(provenance.target).forEach((target, i) => {
    const id = fhirDocumentId(asObject(target).reference);
    if (id === null) return;
    outputFileIds.push(id);
    r.mark(`.target[${i}].reference`);
  });
  if (outputFileIds.length) r.candidate.outputFileIds = outputFileIds;

  const inputFileIds = [];
  asArray(provenance.entity).forEach((entity, i) => {
    const item = asObject(entity);
    const id = item.role === 'source' ? fhirDocumentId(asObject(item.what).reference) : null;
    if (id === null) return;
    inputFileIds.push(id);
    r.mark(`.entity[${i}].role`);
    r.mark(`.entity[${i}].what.reference`);
  });
  if (inputFileIds.length) r.candidate.inputFileIds = inputFileIds;

  const period = asObject(provenance.occurredPeriod);
  r.read('startedAt', period.start, '.occurredPeriod.start');
  r.read('completedAt', period.end, '.occurredPeriod.end');
  r.read('createdAt', provenance.recorded, '.recorded');

  asArray(provenance.agent).some((agent, k) => {
    const item = asObject(agent);
    const value = asObject(asObject(item.who).identifier).value;
    if (!isText(value)) return false;
    const j = asArray(asObject(item.type).coding).findIndex((coding) => {
      const c = asObject(coding);
      return c.system === PROVENANCE_PARTICIPANT_TYPE && c.code === 'author';
    });
    if (j < 0) return false;
    r.read('createdBy', value, `.agent[${k}].who.identifier.value`);
    r.mark(`.agent[${k}].type.coding[${j}].system`);
    r.mark(`.agent[${k}].type.coding[${j}].code`);
    return true;
  });

  return { candidate: r.candidate, mappedPaths: r.mappedPaths };
}

function fromFhirAuditEvent(resource) {
  const event = requireResource(resource, 'AuditEvent');
  const r = reader('AuditEvent');
  r.read('eventId', event.id, '.id');
  r.read('action', asObject(event.type).code, '.type.code');
  r.read('occurredAt', asObject(event.period).start, '.period.start');
  r.read('recordedAt', event.recorded, '.recorded');

  if (event.outcome === '0') {
    r.candidate.result = 'success';
    r.mark('.outcome');
  } else if (event.outcome === undefined && AUDIT_OUTCOME_DESCRIPTIONS.includes(event.outcomeDesc)) {
    r.read('result', event.outcomeDesc, '.outcomeDesc');
  }

  r.read('purpose', asObject(asArray(event.purposeOfEvent)[0]).text, '.purposeOfEvent[0].text');

  asArray(event.agent).some((agent, k) => {
    const item = asObject(agent);
    if (item.requestor !== true) return false;
    if (!r.read('actorPseudonym', asObject(asObject(item.who).identifier).value, `.agent[${k}].who.identifier.value`)) return false;
    r.mark(`.agent[${k}].requestor`);
    return true;
  });

  r.read('source', asObject(asObject(event.source).observer).display, '.source.observer.display');
  const what = asObject(asObject(asArray(event.entity)[0]).what);
  r.read('entityId', asObject(what.identifier).value, '.entity[0].what.identifier.value');
  r.read('entityType', what.display, '.entity[0].what.display');

  return { candidate: r.candidate, mappedPaths: r.mappedPaths };
}

function fromFhirDocumentReference(resource) {
  const document = requireResource(resource, 'DocumentReference');
  const r = reader('DocumentReference');
  r.read('fileId', document.id, '.id');
  // `current` means no deletedAt; it sets no field.
  if (document.status === 'current') r.mark('.status');
  r.read('fileRole', asObject(document.type).text, '.type.text');

  const attachment = asObject(asObject(asArray(document.content)[0]).attachment);
  r.read('storageUri', attachment.url, '.content[0].attachment.url');
  r.read('mimeType', attachment.contentType, '.content[0].attachment.contentType');
  if (typeof attachment.size === 'number' && Number.isFinite(attachment.size)) {
    r.candidate.fileSize = attachment.size;
    r.mark('.content[0].attachment.size');
  }

  const linkedEntityRefs = [];
  let specimenRead = false;
  asArray(asObject(document.context).related).forEach((related, i) => {
    const item = asObject(related);
    const value = asObject(item.identifier).value;
    if (!isText(value)) return;
    if (!specimenRead && item.display === 'Specimen') {
      specimenRead = r.read('specimenId', value, `.context.related[${i}].identifier.value`);
      r.mark(`.context.related[${i}].display`);
      return;
    }
    const ref = { entityId: value };
    r.mark(`.context.related[${i}].identifier.value`);
    if (isText(item.display)) {
      ref.entityType = item.display;
      r.mark(`.context.related[${i}].display`);
    }
    linkedEntityRefs.push(ref);
  });
  if (linkedEntityRefs.length) r.candidate.linkedEntityRefs = linkedEntityRefs;

  return { candidate: r.candidate, mappedPaths: r.mappedPaths };
}

function fromFhirResearchStudy(resource) {
  const study = requireResource(resource, 'ResearchStudy');
  const r = reader('ResearchStudy');
  const identifiers = asArray(study.identifier);
  if (r.read('studyId', study.id, '.id')) {
    const k = identifiers.findIndex((identifier) => asObject(identifier).value === study.id);
    if (k >= 0) r.mark(`.identifier[${k}].value`);
  } else {
    identifiers.some((identifier, k) => r.read('studyId', asObject(identifier).value, `.identifier[${k}].value`));
  }

  r.read('studyTitle', study.title, '.title');
  r.read('protocolId', asObject(asObject(asArray(study.protocol)[0]).identifier).value, '.protocol[0].identifier.value');
  if (RESEARCH_STUDY_STATUSES.includes(study.status)) r.read('studyStatus', study.status, '.status');
  r.read('studyObjective', study.description, '.description');

  const period = asObject(study.period);
  const recruitmentPeriod = {};
  if (isText(period.start)) {
    recruitmentPeriod.start = period.start;
    r.mark('.period.start');
  }
  if (isText(period.end)) {
    recruitmentPeriod.end = period.end;
    r.mark('.period.end');
  }
  if (Object.keys(recruitmentPeriod).length) r.candidate.recruitmentPeriod = recruitmentPeriod;

  r.read('principalInvestigator', asObject(asObject(study.principalInvestigator).identifier).value, '.principalInvestigator.identifier.value');

  const ethicsApprovalId = [];
  asArray(study.relatedArtifact).forEach((artifact, i) => {
    const item = asObject(artifact);
    if (item.type !== 'documentation' || !isText(item.label)) return;
    ethicsApprovalId.push(item.label);
    r.mark(`.relatedArtifact[${i}].type`);
    r.mark(`.relatedArtifact[${i}].label`);
  });
  if (ethicsApprovalId.length) r.candidate.ethicsApprovalId = ethicsApprovalId;

  return { candidate: r.candidate, mappedPaths: r.mappedPaths };
}

// Only the four fields Study.create stores; Study.create defaults an absent
// studyStatus.
function toStudyCandidate(resourceIndex, candidate) {
  const entry = { resourceIndex, studyId: candidate.studyId, studyTitle: candidate.studyTitle };
  if (candidate.studyStatus !== undefined) entry.studyStatus = candidate.studyStatus;
  entry.ethicsApprovalId = candidate.ethicsApprovalId;
  return entry;
}

const IMPORT_TRANSFORMS = Object.freeze({
  Provenance: fromFhirProvenance,
  AuditEvent: fromFhirAuditEvent,
  DocumentReference: fromFhirDocumentReference,
  ResearchStudy: fromFhirResearchStudy,
});

// The batch's mapped resources: each Bundle resource (its index among the
// entries' resources) of the four types, with the canonical fields its
// candidate fills and the paths no field carries. `mapped` holds every such
// resource, a capped one included, for buildBundleRoundTripLoss.
// `studyCandidates` holds, for each ResearchStudy whose candidate is a valid
// Study, the four fields Study.create stores, for commitBatch.
function stageMappedResources(resources = []) {
  const mapped = new Set();
  const mappedResources = [];
  const studyCandidates = [];
  let mappedResourceCount = 0;
  asArray(resources).forEach((resource, resourceIndex) => {
    if (!isPlainObject(resource) || typeof resource.resourceType !== 'string') return;
    const { resourceType } = resource;
    if (!Object.hasOwn(IMPORT_TRANSFORMS, resourceType)) return;
    const { candidate, mappedPaths } = IMPORT_TRANSFORMS[resourceType](resource);
    mapped.add(resource);
    mappedResourceCount += 1;
    if (resourceType === 'ResearchStudy' && studyCandidates.length < MAX_MAPPED_RESOURCES) {
      if (StudyModel.validate(candidate).isValid) studyCandidates.push(toStudyCandidate(resourceIndex, candidate));
    }
    if (mappedResources.length >= MAX_MAPPED_RESOURCES) return;

    const carried = new Set(mappedPaths);
    const found = leafPaths(resource).filter((path) => !carried.has(path)).sort(collator.compare);
    const unmapped = found.slice(0, MAX_UNMAPPED_PATHS);
    mappedResources.push({
      resourceIndex,
      resourceType,
      mappingId: EXPORT_MAPPINGS[resourceType].mappingId,
      canonicalEntity: EXPORT_MAPPINGS[resourceType].canonicalEntity,
      canonicalFields: Object.keys(candidate).sort(),
      unmappedCount: found.length,
      unmapped,
      truncated: found.length > unmapped.length,
      limitations: IMPORT_ROUND_TRIP_LIMITATIONS[resourceType],
    });
  });

  return {
    report: { mappedResourceCount, mappedResources, truncated: mappedResourceCount > mappedResources.length },
    mapped,
    studyCandidates,
  };
}

module.exports = {
  MAX_MAPPED_RESOURCES,
  IMPORT_ROUND_TRIP_LIMITATIONS,
  fromFhirProvenance,
  fromFhirAuditEvent,
  fromFhirDocumentReference,
  fromFhirResearchStudy,
  stageMappedResources,
};
