// RF005/RNF007 (#575/#582): patientName/birthDate no longer live on Patient
// documents — the caller must resolve `identity` itself via
// participantIdentity.service.js#getIdentityByParticipantId (the sole
// authorized re-identification path, per that service's own comment) and
// pass the result in. This function stays a pure transform and never
// performs that lookup itself, so wiring it up can't bypass the
// authorization/audit boundary the re-identification flow requires.
function toFhirPatient(participant, identity) {
  return {
    resourceType: 'Patient',
    id: participant.participantId,
    identifier: participant.participantId ? [{ value: participant.participantId }] : [],
    name: identity?.patientName ? [{ use: 'official', text: identity.patientName }] : [],
    birthDate: identity?.birthDate || undefined,
    gender: participant.sex || 'unknown'
  };
}

// V2E-0544: closed has no FHIR Specimen.status code, so it is sent as
// `unavailable`. This is a lossy mapping: the dictionary asks for a governed
// mapping with a loss report, which this transform does not produce yet.
function toFhirSpecimenStatus(specimenStatus) {
  const status = String(specimenStatus || '').toLowerCase() || 'available';
  return status === 'closed' ? 'unavailable' : status;
}

function toFhirSpecimen(specimen) {
  return {
    resourceType: 'Specimen',
    id: specimen.specimenId,
    identifier: specimen.specimenId ? [{ value: specimen.specimenId }] : [],
    subject: specimen.participantId ? { reference: `Patient/${specimen.participantId}` } : undefined,
    receivedTime: specimen.registeredAt || undefined,
    status: toFhirSpecimenStatus(specimen.specimenStatus)
  };
}

function toFhirConsent(consent) {
  return {
    resourceType: 'Consent',
    id: consent.consentTemplateId,
    status: consent.consentGranted ? 'active' : 'inactive'
  };
}

function resultToFHIR(result) {
  return {
    observation: {
      resourceType: 'Observation',
      id: result.resultID || result._id || 'result'
    },
    diagnosticReport: {
      resourceType: 'DiagnosticReport',
      id: `dr-${result.resultID || result._id || 'result'}`
    }
  };
}

function temperatureToFHIR(temperature) {
  return {
    device: {
      resourceType: 'Device',
      id: `device-${temperature.sensorId || 'unknown'}`
    },
    observation: {
      resourceType: 'Observation',
      id: `temp-${temperature._id || temperature.timestamp || 'reading'}`
    }
  };
}

// RF011 AC4, MAP-V2-006..009 (#1322): the export of WorkflowRun to
// Provenance, an audit event to AuditEvent, a DataFile to DocumentReference
// and a Study to ResearchStudy. Pure transforms like the ones above: no
// lookup, no I/O (RF011 AC7, RNF024). A canonical value that is absent,
// empty or outside a closed table is left out, never replaced by a guessed
// FHIR code (RF011 AC6, "no forced equivalence"), and no coding `system` is
// invented. A canonical entity that is not a FHIR resource type is referenced
// as `{ identifier, display: <entity type> }`; only a DataFile id is a
// literal `DocumentReference/<id>` reference. What each mapping does not
// carry is EXPORT_ROUND_TRIP_LIMITATIONS below. See
// docs/decisions/2026-10-23-fhir-export-provenance-auditevent-documentreference-researchstudy.md.

// INFERENCE, not a citation: only `success` has an unforced AuditEvent
// outcome (`0`). A failure carries no severity, so 4, 8 or 12 would be a guess.
const AUDIT_OUTCOMES = Object.freeze({ success: '0' });

// INFERENCE, not a citation: ELM-0058's vocabulary is "FHIR ResearchStudy
// status", read as the R4 ResearchStudy.status value set.
const RESEARCH_STUDY_STATUSES = Object.freeze([
  'active', 'administratively-completed', 'approved', 'closed-to-accrual',
  'closed-to-accrual-and-intervention', 'completed', 'disapproved', 'in-review',
  'temporarily-closed-to-accrual', 'temporarily-closed-to-accrual-and-intervention',
  'withdrawn',
]);

// The R4 binding of Provenance.agent.type.
const PROVENANCE_PARTICIPANT_TYPE = 'http://terminology.hl7.org/CodeSystem/provenance-participant-type';

const EXPORT_ROUND_TRIP_LIMITATIONS = Object.freeze({
  Provenance: Object.freeze([
    'O ambiente computacional completo permanece canônico.',
    'workflowId e workflowVersion não são exportados (corresponderiam a um PlanDefinition, não exportado).',
    'containerImageDigest, softwareDependencies, parameters, hardwareProfile, randomSeed, datasetSnapshotId e environmentManifestUri não são exportados.',
    'runStatus não é exportado: corresponde a Task.status, não a Provenance.',
  ]),
  AuditEvent: Object.freeze([
    'A cadeia de hash e o contexto interno de política permanecem canônicos.',
    'logId, sequenceNumber, eventHash, canonicalEventHash, previousEventHash, payloadDigest, treeSize, canonicalLeaf, canonical, schemaVersion e hashAlgorithm não são exportados.',
    'policyVersion, canonicalModelReleaseId e correlationId não são exportados.',
    'Apenas result success tem outcome (0); qualquer outro result vai apenas em outcomeDesc, sem severidade.',
    'O agente é apenas o pseudônimo do ator, nunca o identificador do usuário.',
  ]),
  DocumentReference: Object.freeze([
    'O binário permanece no Object Storage; storagePath nunca é exportado.',
    'checksum e checksumAlgorithm não são exportados: Attachment.hash do R4 é SHA-1 em base64 e o checksum canônico é SHA-256 hexadecimal.',
    'Os campos de cifra (encryptionAlgorithm, encryptionKeyId, encryptionIv, encryptionTag) não são exportados.',
    'accessPolicy, malwareScan, storageObjectVersion, ownerId, retentionPolicyId e fileName não são exportados.',
    'Os metadados HL7 do arquivo não são exportados.',
    'Uma exclusão lógica (deletedAt) não tem status: não equivale a superseded nem a entered-in-error.',
  ]),
  ResearchStudy: Object.freeze([
    'Usado quando aplicável; exige perfil versionado.',
    'studyAcronym e studyDesign não são exportados: ResearchStudy.acronym e studyDesign existem no R5, não no R4.',
    'protocolVersion, studyArms, studyFactors, participatingCenters e datasetIds não são exportados.',
    'Um studyStatus fora dos códigos de status do ResearchStudy R4 não é exportado.',
  ]),
});

function requireRecord(record, kind) {
  if (record === null || record === undefined) {
    throw new Error(`${kind} ausente`);
  }
  return record;
}

function toFhirDateTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function nonEmpty(list) {
  return list.length ? list : undefined;
}

function presentIds(value) {
  return (Array.isArray(value) ? value : []).filter(hasValue);
}

function periodOf(start, end) {
  const period = { start: toFhirDateTime(start), end: toFhirDateTime(end) };
  return period.start || period.end ? period : undefined;
}

function toFhirProvenance(workflowRun) {
  const run = requireRecord(workflowRun, 'WorkflowRun');
  return {
    resourceType: 'Provenance',
    id: run.workflowRunId,
    target: nonEmpty(presentIds(run.outputFileIds).map((id) => ({ reference: `DocumentReference/${id}` }))),
    occurredPeriod: periodOf(run.startedAt, run.completedAt),
    recorded: toFhirDateTime(run.createdAt),
    agent: hasValue(run.createdBy)
      ? [{
        type: { coding: [{ system: PROVENANCE_PARTICIPANT_TYPE, code: 'author' }] },
        who: { identifier: { value: run.createdBy } },
      }]
      : undefined,
    entity: nonEmpty(presentIds(run.inputFileIds).map((id) => ({
      role: 'source',
      what: { reference: `DocumentReference/${id}` },
    }))),
  };
}

function auditEntity(event) {
  if (hasValue(event.entityId)) {
    return [{ what: { identifier: { value: event.entityId }, display: event.entityType || undefined } }];
  }
  return hasValue(event.entityType) ? [{ what: { display: event.entityType } }] : undefined;
}

function toFhirAuditEvent(auditEvent) {
  const event = requireRecord(auditEvent, 'AuditEvent');
  const outcome = Object.hasOwn(AUDIT_OUTCOMES, event.result) ? AUDIT_OUTCOMES[event.result] : undefined;
  const start = toFhirDateTime(event.occurredAt);
  return {
    resourceType: 'AuditEvent',
    id: event.eventId,
    type: hasValue(event.action) ? { code: event.action } : undefined,
    period: start ? { start } : undefined,
    recorded: toFhirDateTime(event.recordedAt),
    outcome,
    outcomeDesc: outcome === undefined && hasValue(event.result) ? String(event.result) : undefined,
    purposeOfEvent: hasValue(event.purpose) ? [{ text: event.purpose }] : undefined,
    agent: hasValue(event.actorPseudonym)
      ? [{ who: { identifier: { value: event.actorPseudonym } }, requestor: true }]
      : undefined,
    source: hasValue(event.source) ? { observer: { display: event.source } } : undefined,
    entity: auditEntity(event),
  };
}

function documentAttachment(file) {
  const attachment = {
    url: hasValue(file.storageUri) ? file.storageUri : undefined,
    contentType: file.mimeType || file.fileFormat || undefined,
    size: Number.isFinite(file.fileSize) ? file.fileSize : undefined,
  };
  return Object.values(attachment).some((value) => value !== undefined) ? attachment : undefined;
}

function documentRelated(file) {
  const related = [];
  const add = (value, display) => {
    if (!hasValue(value)) return;
    if (related.some((item) => item.identifier.value === value && item.display === display)) return;
    related.push({ identifier: { value }, display: display || undefined });
  };
  add(file.specimenId, 'Specimen');
  (Array.isArray(file.linkedEntityRefs) ? file.linkedEntityRefs : [])
    .forEach((ref) => add(ref?.entityId, ref?.entityType));
  return nonEmpty(related);
}

function toFhirDocumentReference(dataFile) {
  const file = requireRecord(dataFile, 'DataFile');
  const id = file.fileId || file._id;
  if (!hasValue(id)) {
    throw new Error('DataFile sem identificador');
  }
  const attachment = documentAttachment(file);
  const related = documentRelated(file);
  return {
    resourceType: 'DocumentReference',
    id: String(id),
    status: hasValue(file.deletedAt) ? undefined : 'current',
    type: hasValue(file.fileRole) ? { text: file.fileRole } : undefined,
    content: attachment ? [{ attachment }] : undefined,
    context: related ? { related } : undefined,
  };
}

function toFhirResearchStudy(researchStudy) {
  const study = requireRecord(researchStudy, 'Study');
  const ethicsApprovals = Array.isArray(study.ethicsApprovalId) ? study.ethicsApprovalId : [study.ethicsApprovalId];
  const recruitment = study.recruitmentPeriod || {};
  return {
    resourceType: 'ResearchStudy',
    id: study.studyId,
    identifier: hasValue(study.studyId) ? [{ value: study.studyId }] : undefined,
    title: hasValue(study.studyTitle) ? study.studyTitle : undefined,
    protocol: hasValue(study.protocolId) ? [{ identifier: { value: study.protocolId } }] : undefined,
    status: RESEARCH_STUDY_STATUSES.includes(study.studyStatus) ? study.studyStatus : undefined,
    description: hasValue(study.studyObjective) ? study.studyObjective : undefined,
    period: periodOf(recruitment.start, recruitment.end),
    principalInvestigator: typeof study.principalInvestigator === 'string' && study.principalInvestigator !== ''
      ? { identifier: { value: study.principalInvestigator } }
      : undefined,
    relatedArtifact: nonEmpty(ethicsApprovals.filter(hasValue).map((label) => ({ type: 'documentation', label }))),
  };
}

// RF011 AC4 (#1322): the envelope /api/export/fhir answers. MAP-V2-006..009
// read prepared Phase 1, and no approved InteroperabilityMappingRelease is
// stored, so no release is named and no conformance is claimed (RF011
// AC5/AC6), as in the MIABIS export. Pure like the transforms (RF011 AC7).
// See docs/decisions/2026-10-24-fhir-export-route-and-bundle.md.
const EXPORT_MAPPINGS = Object.freeze({
  Provenance: Object.freeze({ mappingId: 'MAP-V2-008', canonicalEntity: 'WorkflowRun', target: 'Provenance', relationship: 'partial', status: 'prepared Phase 1' }),
  AuditEvent: Object.freeze({ mappingId: 'MAP-V2-006', canonicalEntity: 'AuditEvent', target: 'AuditEvent', relationship: 'partial', status: 'prepared Phase 1' }),
  DocumentReference: Object.freeze({ mappingId: 'MAP-V2-007', canonicalEntity: 'DataFile', target: 'DocumentReference', relationship: 'partial', status: 'prepared Phase 1' }),
  ResearchStudy: Object.freeze({ mappingId: 'MAP-V2-009', canonicalEntity: 'Study', target: 'ResearchStudy', relationship: 'partial', status: 'prepared Phase 1' }),
});

// A `collection` Bundle: no `fullUrl` (0..1 in R4, and no base URL is
// governed yet) and no Bundle `id`.
function toFhirExportBundle(resources, { generatedAt } = {}) {
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('Bundle FHIR sem recursos');
  }
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: generatedAt,
    entry: resources.map((resource) => ({ resource })),
  };
}

function buildFhirExport(resourceType, resources, { generatedAt } = {}) {
  if (!Object.hasOwn(EXPORT_MAPPINGS, resourceType)) {
    throw new Error(`Exportação FHIR não mapeada: ${resourceType}`);
  }
  if (Array.isArray(resources) && resources.some((resource) => resource?.resourceType !== resourceType)) {
    throw new Error(`Recurso FHIR diferente de ${resourceType}`);
  }
  return {
    standard: 'HL7 FHIR',
    fhirVersion: '4.0.1',
    mapping: { ...EXPORT_MAPPINGS[resourceType] },
    mappingReleaseId: null,
    conformanceClaimed: false,
    generatedAt,
    roundTripLimitations: [...EXPORT_ROUND_TRIP_LIMITATIONS[resourceType]],
    bundle: toFhirExportBundle(resources, { generatedAt }),
  };
}

module.exports = {
  toFhirPatient,
  toFhirSpecimen,
  toFhirConsent,
  resultToFHIR,
  temperatureToFHIR,
  toFhirProvenance,
  toFhirAuditEvent,
  toFhirDocumentReference,
  toFhirResearchStudy,
  EXPORT_ROUND_TRIP_LIMITATIONS,
  EXPORT_MAPPINGS,
  toFhirExportBundle,
  buildFhirExport,
  validateFHIRResource(resource) {
    if (!resource?.resourceType || !resource?.id) {
      throw new Error('Recurso FHIR inválido');
    }
    return true;
  }
};
