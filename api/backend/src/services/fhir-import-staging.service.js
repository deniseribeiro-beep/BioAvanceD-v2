const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const notificationService = require('./NotificationService');
const qualityDomain = require('./quality-domain.service');
const logger = require('../utils/logger');
const { SampleModel } = require('../models/Sample');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const PatientModel = require('../models/Patient');
const StudyModel = require('../models/Study');
const participantIdentityService = require('./participantIdentity.service');
const quarantineActionService = require('./quarantine-action.service');
const operationalStateDecisionService = require('./operationalStateDecision.service');
const { withMongoTransaction, isTransactionCapable } = require('../utils/mongoTransaction');
const rcsAssessmentService = require('./rcs-assessment.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const { isRecordInOrganizationScope } = require('./rbac-assignment.service');
const { buildRecordRoundTripLoss, buildBundleRoundTripLoss } = require('../resources/fhir/round-trip-loss');
const { stageMappedResources } = require('../resources/fhir/import-mappings');
const fhirValidator = require('./fhir-validator.service');
const { loadConformanceRegistry } = require('./identifierNamespaceRegistry.service');
const { RELEASE_COLLECTION } = require('./interoperabilityMappingRelease.service');

// RF011 AC5, RNF024 AC2 (#1479): the mapping releases an import is read with.
// A resource's meta.profile entry that an eligible FHIRProfileRegistry row
// matches (the validator's own rule: approved or active, `url|version` or a
// bare url) names that row's mappingReleaseId; the release row gives its
// mappingVersion. A profile that no eligible row matches, or whose release
// row is not stored, names nothing: no release is guessed.
async function createMappingReleaseResolver(db) {
  const { profiles } = fhirValidator.buildConformanceSets(await loadConformanceRegistry(db));
  const releases = new Map();
  async function releaseVersion(mappingReleaseId) {
    if (!releases.has(mappingReleaseId)) {
      let row = null;
      try {
        row = await collection(db, RELEASE_COLLECTION).findOne({ interoperabilityMappingReleaseId: mappingReleaseId });
      } catch (error) {
        logger.warn('InteroperabilityMappingRelease indisponível; o staging FHIR não registra a release:', error.message);
      }
      releases.set(mappingReleaseId, typeof row?.mappingVersion === 'string' && row.mappingVersion.trim() ? row.mappingVersion : null);
    }
    return releases.get(mappingReleaseId);
  }
  return async function resolve(resources) {
    const ids = new Set();
    resources.forEach((resource) => {
      const declared = resource?.meta?.profile;
      if (!Array.isArray(declared)) return;
      declared.forEach((entry) => {
        profiles.forEach((row) => {
          if (fhirValidator.profileRegistered(entry, [row])) ids.add(row.mappingReleaseId);
        });
      });
    });
    const out = [];
    for (const mappingReleaseId of [...ids].sort()) {
      const mappingVersion = await releaseVersion(mappingReleaseId);
      if (mappingVersion) out.push({ mappingReleaseId, mappingVersion });
    }
    return out;
  };
}

const STATUS = Object.freeze({
  VALID: 'VALID',
  WARNING: 'WARNING',
  NEEDS_EMAIL: 'NEEDS_EMAIL',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  CONSENT_SEND_FAILED: 'CONSENT_SEND_FAILED',
  ERROR: 'ERROR',
  PENDING_CONSENT: 'PENDING_CONSENT',
  READY_TO_COMMIT: 'READY_TO_COMMIT',
  COMMITTED: 'COMMITTED',
});

/**
 * The discriminator this service owns inside `import_batches` (#799).
 *
 * `import_batches` / `import_staging_records` are shared with the LGPD sample
 * import, which writes `type: 'LGPD_SAMPLE_CSV'` since #787. The two paths are
 * gated on different permissions -- these routes on `uploadFiles`, every LGPD
 * route on `createPatient`/`createSample` -- so every query here has to carry
 * the discriminator, or it serves (and mutates) the other path's data for a
 * principal that holds neither of its permissions. `import-lgpd.service.js#
 * getQuarantineBatch` carries the mirror-image filter for the same reason.
 */
const { sealedStagingCollection } = require('../utils/stagedRowCrypto');
const FHIR_BATCH_TYPE = 'FHIR_BUNDLE';

function collection(db, name) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Banco de dados não disponível');
  }
  return db.collection(name);
}

/**
 * #1191: every staged record carries civil identity -- normalized.patientName,
 * patientDocument, patientBirthDate and patientEmail, the whole FHIR Patient
 * resource under `fhir`, and a copy of the email in `consentTracking` -- so
 * the handle seals those fields on write and reveals them on read
 * (stagedRowCrypto), the way the LGPD and async quarantine rows are stored
 * since #807. Every read and write of the collection in this file goes
 * through it.
 */
const FHIR_STAGING_SEALED_FIELDS = ['row', 'normalized', 'fhir', 'consentTracking'];

function stagingRecords(db) {
  return sealedStagingCollection(collection(db, 'import_staging_records'), {
    fields: FHIR_STAGING_SEALED_FIELDS,
  });
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (ObjectId.isValid(String(id || ''))) return new ObjectId(String(id));
  return String(id || '').trim();
}

function createBadRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeEntries(payload) {
  if (!payload || typeof payload !== 'object' || payload.resourceType !== 'Bundle') {
    throw createBadRequest('A importação em lote exige um FHIR R4 Bundle JSON.');
  }
  if (!Array.isArray(payload.entry)) {
    throw createBadRequest('A importação em lote exige um FHIR R4 Bundle JSON com entry em array.');
  }
  return payload.entry.map((entry) => entry?.resource).filter(Boolean);
}

function extractIdentifier(resource = {}, preferredSystem = '') {
  const identifiers = Array.isArray(resource.identifier) ? resource.identifier : [];
  const preferred = identifiers.find((identifier) => String(identifier?.system || '').toLowerCase().includes(preferredSystem));
  const anyIdentifier = preferred || identifiers.find((identifier) => String(identifier?.value || '').trim());
  return String(anyIdentifier?.value || '').trim();
}

function extractPatientName(patient = {}) {
  const name = Array.isArray(patient.name) ? patient.name[0] : null;
  return String(
    name?.text
    || [name?.given?.join(' '), name?.family].filter(Boolean).join(' ')
    || ''
  ).trim();
}

function extractTelecom(resource = {}, system) {
  const telecom = Array.isArray(resource.telecom) ? resource.telecom : [];
  return String(telecom.find((item) => item?.system === system)?.value || '').trim();
}

function normalizePatientRef(reference = '') {
  return String(reference || '').replace(/^Patient\//i, '').replace(/^urn:uuid:/i, '').trim();
}

function normalizeSpecimenRef(reference = '') {
  return String(reference || '').replace(/^Specimen\//i, '').replace(/^urn:uuid:/i, '').trim();
}

function extensionValue(resource = {}, urlPart = '') {
  const extensions = Array.isArray(resource.extension) ? resource.extension : [];
  const extension = extensions.find((item) => String(item?.url || '').toLowerCase().includes(urlPart.toLowerCase()));
  if (!extension) return '';
  return String(
    extension.valueString
    ?? extension.valueCode
    ?? extension.valueBoolean
    ?? extension.valueInteger
    ?? extension.valueDecimal
    ?? ''
  ).trim();
}

function codingMatches(coding = {}, terms = []) {
  const system = String(coding.system || '').toLowerCase();
  const code = String(coding.code || '').toLowerCase();
  const display = String(coding.display || '').toLowerCase();
  return terms.some((term) => system.includes(term) || code.includes(term) || display.includes(term));
}

function normalizeConditions(conditions = []) {
  return conditions.map((condition) => {
    const codings = Array.isArray(condition.code?.coding) ? condition.code.coding : [];
    const cid = codings.find((coding) => codingMatches(coding, ['icd', 'cid']));
    const orpha = codings.find((coding) => codingMatches(coding, ['orpha']));
    const omim = codings.find((coding) => codingMatches(coding, ['omim']));
    return {
      diseaseName: String(condition.code?.text || cid?.display || orpha?.display || omim?.display || '').trim(),
      cid10: String(cid?.code || '').trim(),
      orphaCode: String(orpha?.code || '').trim(),
      omimCode: String(omim?.code || '').trim(),
      fhir: condition,
    };
  });
}

function normalizeObservations(observations = []) {
  const biomarkers = [];
  const phenotypes = [];

  observations.forEach((observation) => {
    const codings = Array.isArray(observation.code?.coding) ? observation.code.coding : [];
    const hpoCoding = codings.find((coding) => codingMatches(coding, ['hpo', 'hp:']));
    if (hpoCoding) {
      phenotypes.push({
        hpoCode: String(hpoCoding.code || '').trim(),
        hpoLabel: String(hpoCoding.display || observation.code?.text || '').trim(),
        fhir: observation,
      });
      return;
    }

    biomarkers.push({
      biomarkerType: String(observation.code?.text || codings[0]?.display || codings[0]?.code || '').trim(),
      value: observation.valueQuantity?.value ?? observation.valueString ?? observation.valueCodeableConcept?.text ?? null,
      unit: String(observation.valueQuantity?.unit || observation.valueQuantity?.code || '').trim(),
      fhir: observation,
    });
  });

  return { biomarkers, phenotypes };
}

function parseSprecRaw(sprecsRaw = '', matrix = '') {
  const raw = String(sprecsRaw || '').trim();
  const parts = raw.split('-').map((part) => part.trim().toUpperCase()).filter(Boolean);
  const matrixText = String(matrix || '').toLowerCase();
  const matrixType = matrixText.includes('tissue') || matrixText.includes('solid') || matrixText.includes('tecido')
    ? 'solid'
    : 'fluid';

  // #527: axis 2-6 use the same generic axis-position field names
  // (primaryContainer/preCentrifugation/centrifugation/secondCentrifugation/
  // postCentrifugationDelay) for both matrix types — matching
  // SPREC_SOLID_DICTIONARY's own axis 2-6 slots (frontend/src/constants/
  // sprecDictionary.js, which relabels those same slots per matrixType
  // rather than naming them differently) and import.service.js's CSV-driven
  // parsing (also matrix-type-agnostic). SpecimenPreanalyticsModel.fieldsOf
  // reads these generic names to derive its solid-specific dict-02 fields
  // (sprecCollectionType/warmIschemiaTime/coldIschemiaTime/
  // fixationStabilizationType/fixationTime); a solid-only field-name branch
  // here left every one of those null.
  if (parts.length >= 7) {
    return {
      matrixType,
      sampleType: parts[0],
      primaryContainer: parts[1],
      preCentrifugation: parts[2],
      centrifugation: parts[3],
      secondCentrifugation: parts[4],
      postCentrifugationDelay: parts[5],
      longTermStorage: parts[6],
    };
  }

  return {
    matrixType,
    sampleType: parts[0] || '',
    primaryContainer: parts[1] || '',
    preCentrifugation: parts[2] || '',
    centrifugation: parts[3] || '',
    secondCentrifugation: parts[4] || '',
    postCentrifugationDelay: parts[5] || '',
    longTermStorage: parts[6] || '',
  };
}

function buildRcsPayload({ sampleType, matrix, sprecsRaw, processingUnknown }) {
  const sprec = parseSprecRaw(sprecsRaw, matrix || sampleType);

  if (processingUnknown) {
    const unknownFluid = {
      matrixType: sprec.matrixType || 'fluid',
      sampleType: sprec.sampleType || 'X',
      primaryContainer: sprec.primaryContainer || 'X',
      preCentrifugation: 'X',
      centrifugation: 'X',
      secondCentrifugation: 'X',
      postCentrifugationDelay: 'X',
      longTermStorage: 'X',
    };
    const unknownSolid = {
      matrixType: 'solid',
      sampleType: sprec.sampleType || 'X',
      // #527: generic axis-position names, same reasoning as parseSprecRaw's
      // solid branch above — rcs-certification.service.js's AXES.solid still
      // resolves these via its preCentrifugation/centrifugation/
      // secondCentrifugation/postCentrifugationDelay aliases.
      primaryContainer: sprec.primaryContainer || 'X',
      preCentrifugation: 'X',
      centrifugation: 'X',
      secondCentrifugation: 'X',
      postCentrifugationDelay: 'X',
      longTermStorage: 'X',
    };
    return { matrixType: sprec.matrixType === 'solid' ? 'solid' : 'fluid', sprec: sprec.matrixType === 'solid' ? unknownSolid : unknownFluid };
  }

  return {
    matrixType: sprec.matrixType || undefined,
    sampleType,
    sampleOrigin: matrix,
    sprec,
  };
}

function calculateRcsPreview({ sampleType, matrix, sprecsRaw, processingUnknown }) {
  const payload = buildRcsPayload({ sampleType, matrix, sprecsRaw, processingUnknown });
  const result = qualityDomain.resolveMethodologicalQuality(payload);
  // #526: the per-axis sprec object computed above is the input the RCS
  // certification ran against, but rcs-certification.service.js's own
  // calculation_trace never echoes it back — pass it through separately so
  // callers (the embedded sample.sprec copy, and the SpecimenPreanalytics
  // snapshot recorded on commit) have real data instead of always `{}`.
  return { ...result, sprec: payload.sprec };
}

function consentIsSigned(consent = {}) {
  const status = String(consent.status || '').trim().toUpperCase();
  return ['ACTIVE', 'COMPLETED', 'SIGNED', 'ACCEPTED'].includes(status);
}

function isValidEmail(email = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// quarantineStatus/quarantineReason/availabilityStatus on import_staging_records
// (this fn, and every staging.updateOne site below) are a pre-commit workflow
// snapshot on the FHIR import record itself, not Sample governance state —
// intentionally left off the specimenStatus/QuarantineAction migration (#409).
// Only commitBatch's and attachExternalDocument's `samples` collection writes
// are real Sample write sites; those two are migrated.
function buildWorkflowSnapshot(record = {}) {
  const normalized = record.normalized || {};
  const patientEmail = String(normalized.patientEmail || '').trim();
  const hasEmail = isValidEmail(patientEmail);
  const consentSigned = Boolean(normalized.consentSigned || record.consentStatus === 'SIGNED');
  const externalAttached = Boolean(record.externalDocument?.validatedAt || record.consentStatus === 'EXTERNAL_ATTACHED' || record.consentStatus === 'WAIVED_TRANSFER');
  const consentSent = Boolean(record.consentTracking?.sentAt);
  const committed = record.status === STATUS.COMMITTED;

  let consentStatus = 'NOT_REQUIRED';
  let quarantineStatus = 'QUARANTINED';
  let quarantineReason = 'TRANSFER_REVIEW_REQUIRED';
  let availabilityStatus = 'BLOCKED';
  let displayStatus = 'NEEDS_REVIEW';

  if (consentSigned) {
    consentStatus = 'SIGNED';
    quarantineStatus = 'RELEASED';
    quarantineReason = null;
    availabilityStatus = 'AVAILABLE';
    displayStatus = 'SIGNED';
  } else if (externalAttached) {
    consentStatus = 'EXTERNAL_ATTACHED';
    quarantineStatus = 'RELEASED';
    quarantineReason = null;
    availabilityStatus = 'AVAILABLE';
    displayStatus = 'EXTERNAL_ATTACHED';
  } else if (hasEmail) {
    consentStatus = 'PENDING';
    quarantineReason = 'CONSENT_PENDING';
    displayStatus = consentSent ? 'TCLE_SENT' : 'PENDING_CONSENT';
  } else {
    consentStatus = 'NOT_REQUIRED';
    quarantineReason = 'TRANSFER_REVIEW_REQUIRED';
    displayStatus = 'NEEDS_REVIEW';
  }

  if (committed && quarantineStatus === 'RELEASED' && !consentSigned && !externalAttached) {
    displayStatus = 'RELEASED';
  }

  return {
    consentStatus,
    quarantineStatus,
    quarantineReason,
    availabilityStatus,
    displayStatus,
  };
}

function createConsentToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getConsentSecret() {
  const secret = String(process.env.CONSENT_SECRET || '').trim();
  if (!secret) {
    throw new Error('CONSENT_SECRET é obrigatório para fluxos de consentimento.');
  }
  return secret;
}

function buildImportConsentToken(record, batchId) {
  return jwt.sign(
    {
      scope: 'fhir-import-consent',
      batchId: String(batchId || ''),
      recordId: String(record._id || ''),
      participantId: String(record.normalized?.participantId || ''),
    },
    getConsentSecret(),
    { expiresIn: '2h' }
  );
}

function buildImportConsentLink(record, batchId, token) {
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${baseUrl}/patient/e-consent/import/${encodeURIComponent(token)}`;
}

function parseConsentToken(token) {
  try {
    return jwt.verify(token, getConsentSecret());
  } catch (error) {
    const err = new Error('Token inválido ou expirado');
    err.statusCode = 401;
    throw err;
  }
}

function ensureImportConsentPayload(payload = {}) {
  if (payload.scope !== 'fhir-import-consent') {
    const error = new Error('Token inválido para consentimento de importação.');
    error.statusCode = 401;
    throw error;
  }
  return {
    batchId: String(payload.batchId || '').trim(),
    recordId: String(payload.recordId || '').trim(),
    participantId: String(payload.participantId || '').trim(),
  };
}

async function audit(db, action, payload = {}) {
  try {
    await collection(db, 'audit_logs').insertOne({
      action,
      module: 'FHIR_IMPORT',
      ...payload,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.warn('[FHIR_IMPORT][AUDIT] Falha ao registrar auditoria', error.message || error);
  }
}

function buildBundleIndex(resources) {
  const patients = new Map();
  const consentsByPatient = new Map();
  const specimens = [];
  const conditionsByPatient = new Map();
  const observationsByPatient = new Map();
  const observationsBySpecimen = new Map();

  resources.forEach((resource) => {
    if (!resource || typeof resource !== 'object') return;

    if (resource.resourceType === 'Patient') {
      patients.set(String(resource.id || '').trim(), resource);
      const identifier = extractIdentifier(resource);
      if (identifier) patients.set(identifier, resource);
      return;
    }

    if (resource.resourceType === 'Consent') {
      const patientRef = normalizePatientRef(resource.patient?.reference || resource.subject?.reference);
      if (!patientRef) return;
      const existing = consentsByPatient.get(patientRef) || [];
      existing.push(resource);
      consentsByPatient.set(patientRef, existing);
      return;
    }

    if (resource.resourceType === 'Condition') {
      const patientRef = normalizePatientRef(resource.subject?.reference || resource.patient?.reference);
      if (!patientRef) return;
      const existing = conditionsByPatient.get(patientRef) || [];
      existing.push(resource);
      conditionsByPatient.set(patientRef, existing);
      return;
    }

    if (resource.resourceType === 'Observation') {
      const patientRef = normalizePatientRef(resource.subject?.reference || resource.patient?.reference);
      const specimenRef = normalizeSpecimenRef(resource.specimen?.reference);
      if (patientRef) {
        const existingByPatient = observationsByPatient.get(patientRef) || [];
        existingByPatient.push(resource);
        observationsByPatient.set(patientRef, existingByPatient);
      }
      if (specimenRef) {
        const existingBySpecimen = observationsBySpecimen.get(specimenRef) || [];
        existingBySpecimen.push(resource);
        observationsBySpecimen.set(specimenRef, existingBySpecimen);
      }
      return;
    }

    if (resource.resourceType === 'Specimen') {
      specimens.push(resource);
    }
  });

  return { patients, consentsByPatient, specimens, conditionsByPatient, observationsByPatient, observationsBySpecimen };
}

function normalizeSpecimen(specimen, index, bundleIndex) {
  const patientRef = normalizePatientRef(specimen.subject?.reference);
  const patient = bundleIndex.patients.get(patientRef) || null;
  const specimenId = String(specimen.id || extractIdentifier(specimen) || '').trim();
  const participantId = String(patient?.id || patientRef || extractIdentifier(patient || {}) || '').trim();
  const sampleType = String(specimen.type?.text || specimen.type?.coding?.[0]?.display || specimen.type?.coding?.[0]?.code || '').trim();
  const collectionDate = specimen.collection?.collectedDateTime || specimen.collection?.collectedDate || specimen.receivedTime || null;
  const matrix = extensionValue(specimen, 'matrix');
  const storageTemperature = extensionValue(specimen, 'storage-temperature');
  const sprecsRaw = extensionValue(specimen, 'sprecs');
  const rcsGovRequired = /^true$/i.test(extensionValue(specimen, 'rcs-gov-required'));
  const processingUnknown = /^true$/i.test(extensionValue(specimen, 'processing-unknown'));
  const rcsPreview = calculateRcsPreview({ sampleType, matrix, sprecsRaw, processingUnknown });
  const barcode = String(specimen.container?.[0]?.identifier?.[0]?.value || specimen.accessionIdentifier?.value || '').trim();
  const patientName = extractPatientName(patient || {});
  const patientDocument = extractIdentifier(patient || {}, 'cpf') || extractIdentifier(patient || {});
  const patientEmail = extractTelecom(patient || {}, 'email');
  const patientPhone = extractTelecom(patient || {}, 'phone');
  const consentSigned = (bundleIndex.consentsByPatient.get(patientRef) || []).some(consentIsSigned);
  const hasEmail = isValidEmail(patientEmail);
  const conditions = normalizeConditions(bundleIndex.conditionsByPatient.get(patientRef) || []);
  const observations = [
    ...(bundleIndex.observationsByPatient.get(patientRef) || []),
    ...(bundleIndex.observationsBySpecimen.get(specimenId) || []),
  ];
  const { biomarkers, phenotypes } = normalizeObservations(observations);

  const errors = [];
  if (!specimenId) errors.push({ field: 'specimenId', message: 'specimenId é obrigatório no Specimen.id ou identifier.value.' });
  if (!participantId) errors.push({ field: 'participantId', message: 'participantId é obrigatório em Specimen.subject.reference.' });
  if (!patient) errors.push({ field: 'patient', message: 'Specimen.subject.reference deve apontar para um recurso Patient no Bundle.' });
  if (!patientName) errors.push({ field: 'patientName', message: 'Nome do paciente é obrigatório no recurso Patient.' });
  if (!patientDocument) errors.push({ field: 'document', message: 'Documento/identificador do paciente é obrigatório.' });
  if (!patientEmail && !consentSigned) errors.push({ field: 'patientEmail', code: 'NEEDS_EMAIL', message: 'E-mail do paciente é obrigatório quando TCLE precisa ser enviado.' });
  if (patientEmail && !isValidEmail(patientEmail)) errors.push({ field: 'patientEmail', code: 'INVALID_EMAIL', message: 'E-mail do paciente possui formato inválido.' });
  if (!sampleType) errors.push({ field: 'sampleType', message: 'Tipo de amostra é obrigatório em Specimen.type.' });
  if (rcsGovRequired && !collectionDate) errors.push({ field: 'collectionDate', message: 'Data/hora de coleta é obrigatória para RCS-GOV.' });
  if (rcsGovRequired && !matrix) errors.push({ field: 'matrix', message: 'Matriz da amostra é obrigatória para RCS-GOV.' });
  if (rcsGovRequired && !processingUnknown && !sprecsRaw) errors.push({ field: 'sprecsRaw', message: 'SPREC é obrigatório para RCS-GOV quando o processamento não é desconhecido.' });

  const missingEmailOnly = errors.length > 0 && errors.every((error) => error.code === 'NEEDS_EMAIL');
  const status = missingEmailOnly
    ? STATUS.NEEDS_REVIEW
    : errors.length > 0
      ? STATUS.ERROR
      : consentSigned
        ? STATUS.READY_TO_COMMIT
        : STATUS.VALID;

  return {
    rowNumber: index + 1,
    status,
    errors,
    validationErrors: errors,
    warnings: consentSigned || errors.length > 0 ? [] : [{ field: 'consent', message: hasEmail ? 'TCLE ainda não enviado para assinatura.' : 'Registro sem e-mail fica em revisão.' }],
    normalized: {
      participantId,
      patientName,
      patientDocument,
      patientBirthDate: patient?.birthDate || null,
      patientSex: patient?.gender || null,
      patientEmail,
      patientPhone,
      specimenId,
      sampleType,
      collectionDate,
      matrix,
      storageTemperature,
      sprecsRaw,
      processingUnknown,
      barcode,
      diseases: conditions,
      biomarkers,
      phenotypes,
      rcsGovRequired,
      rcsPreview: {
        model_version: rcsPreview.model_version,
        governance_status: rcsPreview.governance_status,
        governance_failure_reasons: rcsPreview.governance_failure_reasons || [],
        rcs_score: rcsPreview.rcs_score,
        p_bio: rcsPreview.p_bio,
        final_grade: rcsPreview.final_grade,
        grade_route: rcsPreview.grade_route,
        axis_penalties: rcsPreview.axis_penalties || [],
        calculation_trace: rcsPreview.calculation_trace || {},
        sprec: rcsPreview.sprec || {},
        matrix_type: rcsPreview.matrix_type,
        rcs_input: rcsPreview.rcs_input ?? null,
      },
      consentSigned,
    },
    fhir: {
      patient,
      specimen,
      consents: bundleIndex.consentsByPatient.get(patientRef) || [],
      conditions: bundleIndex.conditionsByPatient.get(patientRef) || [],
      observations,
    },
  };
}

function summarize(records) {
  const counts = {
    total: records.length,
    valid: 0,
    warnings: 0,
    errors: 0,
    pendingConsent: 0,
    needsReview: 0,
    readyToCommit: 0,
    committed: 0,
  };

  records.forEach((record) => {
    if (record.status === STATUS.VALID) counts.valid += 1;
    if (record.status === STATUS.WARNING) counts.warnings += 1;
    if (record.status === STATUS.NEEDS_EMAIL) counts.errors += 1;
    if (record.status === STATUS.NEEDS_REVIEW) counts.needsReview += 1;
    if (record.status === STATUS.CONSENT_SEND_FAILED) counts.errors += 1;
    if (record.status === STATUS.ERROR) counts.errors += 1;
    if (record.status === STATUS.PENDING_CONSENT) counts.pendingConsent += 1;
    if (record.status === STATUS.READY_TO_COMMIT) counts.readyToCommit += 1;
    if (record.status === STATUS.COMMITTED) counts.committed += 1;
  });

  return counts;
}

async function refreshBatchCounts(db, batchId) {
  const records = await stagingRecords(db).find({ batchId }).toArray();
  const counts = summarize(records);
  const status = counts.errors > 0
    ? 'VALIDATED_WITH_ERRORS'
    : counts.pendingConsent > 0
      ? 'PENDING_CONSENT'
      : counts.readyToCommit > 0
        ? 'READY_TO_COMMIT'
        : counts.committed === counts.total && counts.total > 0
          ? 'COMMITTED'
          : 'VALIDATED';

  await collection(db, 'import_batches').updateOne(
    { _id: batchId, type: FHIR_BATCH_TYPE },
    { $set: { status, counts, updatedAt: new Date() } }
  );

  return { status, counts, records };
}

async function stageBundle(db, payload, metadata = {}) {
  let resources;
  try {
    resources = normalizeEntries(payload);
  } catch (error) {
    if (error.statusCode) throw error;
    throw createBadRequest('Bundle FHIR JSON inválido.');
  }
  if (resources.length === 0) {
    throw createBadRequest('Bundle FHIR JSON inválido ou sem entradas.');
  }

  const bundleIndex = buildBundleIndex(resources);
  const { report: mappedResources, mapped, studyCandidates } = stageMappedResources(resources);
  const records = bundleIndex.specimens.map((specimen, index) => normalizeSpecimen(specimen, index, bundleIndex));
  if (records.length === 0) {
    throw createBadRequest('Bundle FHIR não contém Specimen para staging.');
  }

  // RF011 AC5, RNF024 AC2 (#1479): the releases the Bundle and each record are read with.
  const resolveMappingReleases = await createMappingReleaseResolver(db);
  const bundleMappingReleases = await resolveMappingReleases([payload, ...resources]);
  const recordMappingReleases = [];
  for (const record of records) {
    const { patient, specimen, consents, conditions, observations } = record.fhir;
    recordMappingReleases.push(await resolveMappingReleases([patient, specimen, ...consents, ...conditions, ...observations]));
  }

  const now = new Date();
  // #1385: the organization the controller resolved from the caller's scope
  // (#1376); null for a global caller who named none.
  const organizationId = metadata.organizationId == null ? null : String(metadata.organizationId);
  const batchDoc = {
    type: FHIR_BATCH_TYPE,
    status: 'STAGED',
    fileName: String(metadata.fileName || 'fhir-bundle.json'),
    source: 'FHIR',
    counts: summarize(records),
    createdBy: metadata.userID || null,
    organizationId,
    // RF011 AC4 (#1322): the Provenance, AuditEvent, DocumentReference and
    // ResearchStudy resources mapped, as field names and paths only.
    mappedResources,
    // RF011 AC6, RNF024 C6 (#1322): the Bundle resources no record attaches
    // and no mapping reads.
    roundTripLoss: buildBundleRoundTripLoss(resources, records, mapped),
    // RF011 AC4 (#1322): each valid ResearchStudy's studyId, studyTitle,
    // studyStatus and ethicsApprovalId, the plaintext a Study stores, kept
    // for commitStudyCandidates.
    studyCandidates,
    mappingReleases: bundleMappingReleases,
    createdAt: now,
    updatedAt: now,
  };
  const batchResult = await collection(db, 'import_batches').insertOne(batchDoc);
  const batchId = batchResult.insertedId;

  // #1322: an Observation several records attach is walked once.
  const roundTripLossCache = new WeakMap();
  const docs = records.map((record, index) => ({
    ...record,
    batchId,
    organizationId,
    mappingReleases: recordMappingReleases[index],
    // RF011 AC6, RNF024 C6 (#1322): paths only, kept outside the sealed fields.
    roundTripLoss: buildRecordRoundTripLoss(record.fhir, roundTripLossCache),
    createdAt: now,
    updatedAt: now,
  }));
  await stagingRecords(db).insertMany(docs);
  const refreshed = await refreshBatchCounts(db, batchId);

  return {
    batch: { _id: batchId, ...batchDoc, status: refreshed.status, counts: refreshed.counts },
    records: refreshed.records,
  };
}

/**
 * Resolve a batch this service owns, or 404 (#799).
 *
 * 404 rather than 403 deliberately: a FHIR endpoint should not confirm the
 * existence of a batch belonging to the LGPD import path.
 */
async function findFhirBatch(db, batchId, organizationScope) {
  const batch = await collection(db, 'import_batches').findOne({ _id: batchId, type: FHIR_BATCH_TYPE });
  if (!batch) {
    const error = new Error('Lote de importação FHIR não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  // #1385: a caller with organization scope reaches only a batch stamped with
  // one of its organizations; an unstamped batch (legacy, or staged by a
  // global caller who named none) only global scope reaches. No scope passed
  // means an internal caller, which is unfiltered.
  if (organizationScope && !isRecordInOrganizationScope(batch, organizationScope, 'organizationId')) {
    const error = new Error('Lote de importação FHIR fora do escopo organizacional do usuário.');
    error.statusCode = 403;
    throw error;
  }
  return batch;
}

async function getBatch(db, batchIdRaw, { organizationScope } = {}) {
  const batchId = toObjectId(batchIdRaw);
  const batch = await findFhirBatch(db, batchId, organizationScope);
  const records = await stagingRecords(db).find({ batchId }).sort({ rowNumber: 1 }).toArray();
  return { batch, records };
}

async function validateBatch(db, batchIdRaw, { organizationScope } = {}) {
  const batchId = toObjectId(batchIdRaw);
  const { records } = await getBatch(db, batchId, { organizationScope });
  const staging = stagingRecords(db);

  for (const record of records) {
    if (record.status === STATUS.COMMITTED) continue;
    if (record.status === STATUS.CONSENT_SEND_FAILED) continue;
    const errors = Array.isArray(record.errors) ? record.errors : [];
    const consentSigned = Boolean(record.normalized?.consentSigned);
    const missingEmailOnly = errors.length > 0 && errors.every((error) => error.code === 'NEEDS_EMAIL');
    const consentSent = Boolean(record.consentTracking?.sentAt);
    const nextStatus = missingEmailOnly
      ? STATUS.NEEDS_REVIEW
      : errors.length > 0
        ? STATUS.ERROR
        : consentSigned
          ? STATUS.READY_TO_COMMIT
          : consentSent
            ? STATUS.PENDING_CONSENT
            : STATUS.VALID;
    const warnings = nextStatus === STATUS.PENDING_CONSENT
      ? [{ field: 'consent', message: 'TCLE assinado não encontrado para este paciente.' }]
      : nextStatus === STATUS.NEEDS_REVIEW
        ? [{ field: 'consent', message: 'Registro sem e-mail permanece em revisão.' }]
      : nextStatus === STATUS.VALID
        ? [{ field: 'consent', message: 'TCLE ainda não enviado para assinatura.' }]
      : [];
    await staging.updateOne(
      { _id: record._id },
      { $set: { status: nextStatus, warnings, updatedAt: new Date() } }
    );
  }

  return refreshBatchCounts(db, batchId);
}

async function sendConsents(db, batchIdRaw, options = {}) {
  const batchId = toObjectId(batchIdRaw);
  const { records } = await getBatch(db, batchId, { organizationScope: options.organizationScope });
  const staging = stagingRecords(db);
  const results = [];

  for (const record of records) {
    if (record.status === STATUS.COMMITTED || record.status === STATUS.READY_TO_COMMIT) {
      results.push({ recordId: record._id, status: record.status, skipped: true });
      continue;
    }

    const errors = Array.isArray(record.errors) ? record.errors : [];
    const blockingErrors = errors.filter((error) => error.code !== 'NEEDS_EMAIL');
    const normalized = record.normalized || {};

    if (blockingErrors.length > 0) {
      results.push({ recordId: record._id, status: STATUS.ERROR, skipped: true, reason: 'validation_errors' });
      continue;
    }

    if (!isValidEmail(normalized.patientEmail)) {
      const emailErrors = [{ field: 'patientEmail', code: 'NEEDS_EMAIL', message: 'E-mail válido é obrigatório para envio do TCLE.' }];
      await staging.updateOne(
        { _id: record._id },
        {
          $set: {
            status: STATUS.NEEDS_REVIEW,
            errors: emailErrors,
            validationErrors: emailErrors,
            warnings: [{ field: 'consent', message: 'Registro sem e-mail permanece em revisão.' }],
            consentStatus: 'NOT_REQUIRED',
            quarantineStatus: 'QUARANTINED',
            quarantineReason: 'TRANSFER_REVIEW_REQUIRED',
            availabilityStatus: 'BLOCKED',
            updatedAt: new Date(),
          },
        }
      );
      results.push({ recordId: record._id, status: STATUS.NEEDS_REVIEW, sent: false });
      continue;
    }

    const token = buildImportConsentToken(record, batchId);
    const consentLink = buildImportConsentLink(record, batchId, token);

    try {
      const emailResult = await notificationService.sendConsentEmail(
        {
          participantId: normalized.participantId,
          patientName: normalized.patientName,
          email: normalized.patientEmail,
        },
        consentLink
      );

      if (!emailResult?.success) {
        throw new Error(emailResult?.reason || 'Falha ao enviar TCLE por e-mail.');
      }

      const consentTracking = {
        token,
        tokenScope: 'fhir-import-consent',
        batchId: String(batchId),
        recordId: String(record._id),
        participantId: String(normalized.participantId || ''),
        sentAt: new Date(),
        sentBy: options.userID || null,
        email: normalized.patientEmail,
        provider: emailResult.provider || 'resend',
        messageId: emailResult.messageId || null,
        signedAt: null,
      };

      await staging.updateOne(
        { _id: record._id },
        {
          $set: {
            status: STATUS.PENDING_CONSENT,
            consentStatus: 'PENDING',
            quarantineStatus: 'QUARANTINED',
            quarantineReason: 'CONSENT_PENDING',
            availabilityStatus: 'BLOCKED',
            warnings: [{ field: 'consent', message: 'TCLE enviado e aguardando assinatura.' }],
            consentTracking,
            updatedAt: new Date(),
          },
        }
      );
      await audit(db, 'FHIR_IMPORT_CONSENT_SENT', { batchId, recordId: record._id, participantId: normalized.participantId });
      results.push({ recordId: record._id, status: STATUS.PENDING_CONSENT, sent: true });
    } catch (error) {
      logger.warn('[FHIR_IMPORT] Falha ao enviar TCLE do registro staging', {
        batchId: String(batchId),
        recordId: String(record._id),
        message: error.message,
      });
      await staging.updateOne(
        { _id: record._id },
        {
          $set: {
            status: STATUS.CONSENT_SEND_FAILED,
            consentStatus: 'PENDING',
            quarantineStatus: 'QUARANTINED',
            quarantineReason: 'CONSENT_PENDING',
            availabilityStatus: 'BLOCKED',
            consentTracking: {
              failedAt: new Date(),
              email: normalized.patientEmail,
              error: error.message,
            },
            updatedAt: new Date(),
          },
        }
      );
      results.push({ recordId: record._id, status: STATUS.CONSENT_SEND_FAILED, sent: false, error: error.message });
    }
  }

  const refreshed = await refreshBatchCounts(db, batchId);
  return { ...refreshed, consentResults: results };
}

async function validateImportConsentToken(db, tokenRaw) {
  const token = String(tokenRaw || '').trim();
  const payload = parseConsentToken(token);
  const { batchId, recordId, participantId } = ensureImportConsentPayload(payload);
  const batchObjectId = toObjectId(batchId);

  // #802: route the batch lookup through findFhirBatch so the `type:
  // FHIR_BUNDLE` discriminator (#799) lives in exactly one place in this
  // file. findFhirBatch throws (rather than returning null) on a miss --
  // including a batchId that resolves to the *other* import path's
  // `LGPD_SAMPLE_CSV` document -- so its 404 is folded into the combined
  // not-found guard below instead of propagating findFhirBatch's own
  // message, keeping this function's single external failure message.
  let batch = null;
  try {
    batch = await findFhirBatch(db, batchObjectId);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    batch = null;
  }

  const record = await stagingRecords(db).findOne({ _id: toObjectId(recordId), batchId: batchObjectId });

  if (!batch || !record || String(record.normalized?.participantId || '') !== participantId) {
    const error = new Error('Registro FHIR de importação não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  return {
    batch,
    record,
    tokenPayload: payload,
  };
}

async function acceptImportConsentToken(db, tokenRaw) {
  const token = String(tokenRaw || '').trim();
  const { batch, record, tokenPayload } = await validateImportConsentToken(db, token);
  const staging = stagingRecords(db);
  const now = new Date();

  if (record.normalized?.consentSigned && record.status === STATUS.READY_TO_COMMIT) {
    return { batch, record, tokenPayload, updated: false };
  }

  const updatedRecord = {
    ...record,
    normalized: {
      ...record.normalized,
      consentSigned: true,
    },
    consentTracking: {
      ...(record.consentTracking || {}),
      signedAt: now,
    },
    consentStatus: 'SIGNED',
    quarantineStatus: 'RELEASED',
    quarantineReason: null,
    availabilityStatus: 'AVAILABLE',
    warnings: (Array.isArray(record.warnings) ? record.warnings : []).filter((warning) => String(warning?.field || '') !== 'consent'),
    status: STATUS.READY_TO_COMMIT,
    updatedAt: now,
  };

  await staging.updateOne(
    { _id: record._id, batchId: record.batchId },
    {
      $set: {
        normalized: updatedRecord.normalized,
        consentTracking: updatedRecord.consentTracking,
        consentStatus: updatedRecord.consentStatus,
        quarantineStatus: updatedRecord.quarantineStatus,
        quarantineReason: updatedRecord.quarantineReason,
        availabilityStatus: updatedRecord.availabilityStatus,
        warnings: updatedRecord.warnings,
        status: updatedRecord.status,
        updatedAt: updatedRecord.updatedAt,
      },
    }
  );
  await audit(db, 'FHIR_IMPORT_CONSENT_SIGNED', {
    batchId: record.batchId,
    recordId: record._id,
    participantId: record.normalized?.participantId || null,
  });

  const refreshedRecord = await staging.findOne({ _id: record._id, batchId: record.batchId });
  return { batch, record: refreshedRecord || updatedRecord, tokenPayload, updated: true };
}

async function getConsentStatus(db, batchIdRaw, { organizationScope } = {}) {
  const batchId = toObjectId(batchIdRaw);
  const { batch, records } = await getBatch(db, batchId, { organizationScope });
  return {
    batch,
    records: records.map((record) => ({
      recordId: record._id,
      rowNumber: record.rowNumber,
      specimenId: record.normalized?.specimenId || null,
      participantId: record.normalized?.participantId || null,
      patientEmail: record.normalized?.patientEmail || null,
      status: record.status,
      consentTracking: record.consentTracking || null,
      consentSigned: Boolean(record.normalized?.consentSigned),
      consentStatus: record.consentStatus || buildWorkflowSnapshot(record).consentStatus,
      quarantineStatus: record.quarantineStatus || buildWorkflowSnapshot(record).quarantineStatus,
      quarantineReason: record.quarantineReason || buildWorkflowSnapshot(record).quarantineReason,
      availabilityStatus: record.availabilityStatus || buildWorkflowSnapshot(record).availabilityStatus,
      workflowStatus: record.workflowStatus || buildWorkflowSnapshot(record).displayStatus,
    })),
  };
}

// RF011 AC4 (#1322): a staged ResearchStudy becomes a Study only for a
// caller the controller resolved as Coordenador or Administrador, as POST
// /api/studies requires. A Study is matched by studyId and only inserted
// when absent; an existing one is never changed.
async function commitStudyCandidates(db, batchId, batchInfo, canCreateStudy) {
  const candidates = Array.isArray(batchInfo?.studyCandidates) ? batchInfo.studyCandidates : [];
  const studies = { created: 0, existing: 0, notCreatedReason: null };
  if (candidates.length === 0) return studies;
  const allowed = canCreateStudy === true;
  if (!allowed) return { ...studies, notCreatedReason: 'ROLE' };

  for (const entry of candidates) {
    const fields = {
      studyId: entry?.studyId,
      studyTitle: entry?.studyTitle,
      studyStatus: entry?.studyStatus,
      ethicsApprovalId: entry?.ethicsApprovalId,
    };
    if (!StudyModel.validate(fields).isValid) continue;
    const result = await collection(db, 'studies').updateOne(
      { studyId: fields.studyId },
      { $setOnInsert: StudyModel.create(fields) },
      { upsert: true }
    );
    if (result?.upsertedId) {
      studies.created += 1;
      await audit(db, 'FHIR_IMPORT_STUDY_COMMITTED', { batchId, studyId: fields.studyId });
    } else {
      studies.existing += 1;
    }
  }
  return studies;
}

async function commitBatch(db, batchIdRaw, { organizationScope, canCreateStudy } = {}) {
  const batchId = toObjectId(batchIdRaw);
  const { records } = await validateBatch(db, batchId, { organizationScope });
  const patients = collection(db, 'patients');
  const samples = collection(db, 'samples');
  const staging = stagingRecords(db);
  // #838: route through findFhirBatch rather than a bare `{ _id: batchId }`
  // findOne, so this file's `type: FHIR_BATCH_TYPE` discriminator (#799) does
  // not depend on validateBatch's ordering above having already enforced it.
  // findFhirBatch throws a 404 on a miss rather than tolerating null; that
  // branch is unreachable here today (validateBatch already resolved batchId
  // through the same discriminated lookup), so this is a latent behaviour
  // change only, chosen to keep a single source for the discriminator
  // instead of duplicating a local not-found guard for no live caller.
  const batchInfo = await findFhirBatch(db, batchId, organizationScope);

  let committed = 0;
  for (const record of records) {
    if (record.status !== STATUS.READY_TO_COMMIT) {
      continue;
    }

    const normalized = record.normalized || {};
    const workflow = buildWorkflowSnapshot(record);
    const importedAt = new Date();
    const importedBy = String(batchInfo?.createdBy || record.createdBy || record.importedBy || '').trim() || null;
    // #571: patientName/cpf used to be written here directly, but
    // patientName/birthDate/identityDocument are civil identity — #575's
    // atomic removal means they never land on Patient at all (PatientModel
    // rejects them as non-canonical); the ParticipantIdentity dual-write
    // right below is their sole write target. `sex` (FHIR Patient.gender,
    // when present) is genuinely a canonical Patient field, unlike those
    // two. `consentTemplateId`/`status` stay unset — a FHIR-committed
    // Patient has no consent-template flow to draw them from (this import
    // path gates on a signed FHIR Consent resource instead).
    await patients.updateOne(
      { participantId: normalized.participantId },
      {
        $setOnInsert: {
          participantId: normalized.participantId,
          ...(normalized.patientSex ? { sex: normalized.patientSex } : {}),
          createdAt: new Date(),
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // RF005/RNF007 (#363/#563): mirror civil identity into the segregated
    // ParticipantIdentity collection, same as patient.service.js#createPatient
    // — kept as an upsert (rather than a plain insertOne) to match the
    // Patient upsert above's own idempotent-on-participantId semantics.
    const identities = collection(db, 'participantIdentities');
    // #1171: plus the contact. Since #1166 every later consent path reads it
    // from this record alone, so a participant committed without it could
    // never be invited again. The phone is left out when another participant
    // already holds it: participant_identities_phone_hash_unique_v1 would
    // refuse the upsert, and this loop has no per-record catch, so one
    // duplicate would abort every record after it. Nothing is lost against
    // the previous behaviour, which recorded no contact at all.
    const contact = {};
    if (isValidEmail(normalized.patientEmail)) contact.email = normalized.patientEmail;
    const phone = PatientModel.normalizePhone(normalized.patientPhone);
    if (phone) {
      const phoneHashes = participantIdentityService.computeBlindIndexCandidates('phone', phone);
      const holders = phoneHashes.length
        ? await identities.find({ phoneHash: { $in: phoneHashes } }).toArray()
        : [];
      if (holders.some((holder) => holder.participantId !== normalized.participantId)) {
        logger.warn('[FHIR_IMPORT] Telefone já pertence a outro participante; registro confirmado sem telefone (#1171)', {
          batchId: String(batchId),
          recordId: String(record._id),
        });
      } else {
        contact.phone = phone;
      }
    }
    const identityFields = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.fieldsOf({
        participantId: normalized.participantId,
        patientName: normalized.patientName,
        birthDate: normalized.patientBirthDate,
        identityDocument: normalized.patientDocument,
        ...contact,
      })
    );
    await identities.updateOne(
      { participantId: normalized.participantId },
      {
        // #1386: identityFields carries participantIdentityId null; the
        // inserted record's own id must win.
        $setOnInsert: { ...identityFields, ...ParticipantIdentityModel.onInsertFields(), createdAt: new Date() },
        $set: { updatedAt: new Date() },
      },
      { upsert: true }
    );

    const specimenStatus = workflow.quarantineStatus === 'RELEASED' ? 'available' : 'quarantined';
    const existingSample = await samples.findOne({ specimenId: normalized.specimenId });
    const previousStatus = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) : null;
    const wasQuarantined = previousStatus === 'quarantined';
    // RF026 AC7: closed is final; a re-commit leaves an existing closed
    // specimen's status and quarantine reason as they are, and applies,
    // releases and records nothing for it.
    const keepsTerminalStatus = Boolean(existingSample) && SampleModel.isTerminalSpecimen(existingSample);
    const statusFields = keepsTerminalStatus
      ? {}
      : { quarantineReason: workflow.quarantineReason, specimenStatus };

    const upsertResult = await samples.updateOne(
      { specimenId: normalized.specimenId },
      {
        $setOnInsert: {
          specimenId: normalized.specimenId,
          participantId: normalized.participantId,
          sampleType: normalized.sampleType,
          collectionDate: normalized.collectionDate,
          sprec: normalized.rcsPreview?.sprec || {},
          rcs_score: normalized.rcsPreview?.rcs_score ?? null,
          final_grade: normalized.rcsPreview?.final_grade || '',
          p_bio: normalized.rcsPreview?.p_bio ?? null,
          grade_route: normalized.rcsPreview?.grade_route || '',
          governance_status: normalized.rcsPreview?.governance_status ?? null,
          governance_failure_reasons: normalized.rcsPreview?.governance_failure_reasons || [],
          axis_penalties: normalized.rcsPreview?.axis_penalties || [],
          calculation_trace: normalized.rcsPreview?.calculation_trace || {},
          fhir: record.fhir?.specimen || null,
          // #1385: a new sample takes the batch's organization; an existing
          // sample's is not moved.
          organizationId: batchInfo?.organizationId ?? null,
          createdAt: new Date(),
        },
        $set: {
          consentStatus: workflow.consentStatus,
          ...statusFields,
          importBatchId: String(batchId),
          importedAt,
          importedBy,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const committedSample = await samples.findOne({ specimenId: normalized.specimenId });

    // #526: mirrors sample.service.js's #492/#524 pins — only recorded for a
    // genuine insert (the $setOnInsert branch above, signaled by
    // upsertedId), since a commit that only matches an already-existing
    // sample doesn't write fresh rcsPreview/sprec data via $setOnInsert and
    // would otherwise grow duplicate versioned snapshots on every re-commit
    // that touches the same specimenId. Best-effort, same as every other
    // creation path: a failure here doesn't roll back the commit.
    if (upsertResult?.upsertedId && committedSample) {
      if (normalized.rcsPreview) {
        try {
          const assessment = await rcsAssessmentService.recordAssessment(db, normalized.specimenId, normalized.rcsPreview);
          await samples.updateOne(
            { _id: committedSample._id },
            { $set: { sealedRcsAssessmentId: assessment._id } }
          );
          committedSample.sealedRcsAssessmentId = assessment._id;
        } catch (assessmentError) {
          logger.error('Falha ao registrar RcsAssessment para a amostra importada via FHIR:', assessmentError.message || assessmentError);
        }
      }

      const sprec = normalized.rcsPreview?.sprec;
      if (sprec) {
        try {
          const profile = await specimenPreanalyticsService.recordProfile(db, normalized.specimenId, sprec);
          await samples.updateOne(
            { _id: committedSample._id },
            { $set: { sealedSpecimenPreanalyticsId: profile._id } }
          );
          committedSample.sealedSpecimenPreanalyticsId = profile._id;
        } catch (profileError) {
          logger.error('Falha ao registrar SpecimenPreanalytics para a amostra importada via FHIR:', profileError.message || profileError);
        }
      }
    }
    if (committedSample && !keepsTerminalStatus) {
      if (specimenStatus === 'quarantined' && !wasQuarantined) {
        await quarantineActionService.recordAction(db, {
          specimenIds: [quarantineActionService.canonicalSpecimenId(committedSample)],
          reasonCodes: [workflow.quarantineReason || 'FHIR_IMPORT_REVIEW_REQUIRED'],
          authorizedBy: importedBy || 'SYSTEM',
        });
      } else if (specimenStatus === 'available' && wasQuarantined) {
        await quarantineActionService.releaseActiveAction(db, committedSample, importedBy || 'SYSTEM');
      }
    }
    // RF006 AC7: a re-commit that changes an existing specimen's status
    // records the change, append-only. A new specimen's first status is its
    // creation, not a change.
    if (existingSample && !keepsTerminalStatus) {
      await operationalStateDecisionService.recordStatusChange(db, {
        specimenId: normalized.specimenId,
        previousStatus,
        newStatus: specimenStatus,
        triggerEventId: String(record._id),
        rulesApplied: ['fhir_import_commit'],
        reasonCodes: [specimenStatus === 'quarantined' ? (workflow.quarantineReason || 'FHIR_IMPORT_REVIEW_REQUIRED') : 'FHIR_IMPORT_RELEASED'],
      });
    }

    await staging.updateOne(
      { _id: record._id },
      {
        $set: {
          status: STATUS.COMMITTED,
          consentStatus: workflow.consentStatus,
          quarantineStatus: workflow.quarantineStatus,
          quarantineReason: workflow.quarantineReason,
          availabilityStatus: workflow.availabilityStatus,
          committedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    await audit(db, 'FHIR_IMPORT_RECORD_COMMITTED', { batchId, recordId: record._id, participantId: normalized.participantId, specimenId: normalized.specimenId, mappingReleases: record.mappingReleases || [] });
    committed += 1;
  }

  const studies = await commitStudyCandidates(db, batchId, batchInfo, canCreateStudy);
  const refreshed = await refreshBatchCounts(db, batchId);
  return { ...refreshed, committed, studies };
}

async function attachExternalDocument(db, batchIdRaw, recordIdRaw, options = {}) {
  const batchId = toObjectId(batchIdRaw);
  const recordId = toObjectId(recordIdRaw);
  const staging = stagingRecords(db);
  const samples = collection(db, 'samples');

  // #799: this is the one entry point that never resolves through getBatch, so
  // it needs the discriminator itself. It is also the most damaging one to
  // leave open -- it marks the record RELEASED/AVAILABLE and then writes to
  // `samples` keyed on normalized.specimenId, which an LGPD quarantine record
  // does not carry.
  await findFhirBatch(db, batchId, options.organizationScope);

  const record = await staging.findOne({ _id: recordId, batchId });
  if (!record) {
    const error = new Error('Registro FHIR não encontrado para anexar documentação externa.');
    error.statusCode = 404;
    throw error;
  }

  // #801: this endpoint's job is bypassing the *consent* gate out of band --
  // not the validation gate. Same notion of "blocking" sendConsents already
  // uses (everything except NEEDS_EMAIL, since routing around a missing
  // e-mail is this endpoint's whole purpose): a record still carrying a
  // blocking validation error must be refused rather than driven straight to
  // COMMITTED/RELEASED/AVAILABLE. Deliberately not gated on
  // `status === READY_TO_COMMIT` (unlike commitBatch) -- a consent-blocked
  // record legitimately never reaches that status, and that's exactly the
  // case this endpoint exists to unblock.
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const blockingErrors = errors.filter((error) => error.code !== 'NEEDS_EMAIL');
  if (blockingErrors.length > 0) {
    throw createBadRequest('Registro possui erros de validação bloqueantes e não pode receber documentação externa.');
  }

  const normalized = record.normalized || {};
  const now = new Date();

  const updatedRecord = {
    consentStatus: 'EXTERNAL_ATTACHED',
    quarantineStatus: 'RELEASED',
    quarantineReason: null,
    availabilityStatus: 'AVAILABLE',
    externalDocument: {
      attachedAt: now,
      attachedBy: options.userID || null,
      validatedAt: now,
      validatedBy: options.userID || null,
      note: String(options.note || '').trim() || null,
    },
    status: STATUS.COMMITTED,
    updatedAt: now,
  };

  // #918: releasing the specimen (samples.updateOne) and marking this
  // staging record COMMITTED (staging.updateOne) used to be two independent
  // writes -- if the second failed, the specimen was already
  // available/EXTERNAL_ATTACHED with no staging or audit record explaining
  // the release. Refusing here on matchedCount === 0 (before the staging
  // write runs) only mitigates that by ordering: it is not atomicity, and on
  // a standalone deployment (no replica set / mongos -- see
  // isTransactionCapable) there is still a residual window between the two
  // writes where a crash leaves the specimen released with its staging
  // record stuck at NEEDS_REVIEW. Where the deployment supports it, both
  // writes plus the quarantine release run inside one transaction instead.
  const capable = await isTransactionCapable(db);

  const doRelease = async (session) => {
    const dbOptions = session ? { session } : undefined;

    const existingSample = await samples.findOne({ specimenId: normalized.specimenId }, dbOptions);
    const previousStatus = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) : null;
    const wasQuarantined = previousStatus === 'quarantined';

    // RF026 AC7: closed is final; attaching a document does not reopen it.
    if (existingSample && SampleModel.isTerminalSpecimen(existingSample)) {
      const error = new Error(`Amostra em ${previousStatus} não admite mudança de specimenStatus; documentação externa não anexada.`);
      error.statusCode = 422;
      throw error;
    }

    const sampleUpdateResult = await samples.updateOne(
      { specimenId: normalized.specimenId },
      {
        $set: {
          consentStatus: 'EXTERNAL_ATTACHED',
          quarantineReason: null,
          specimenStatus: 'available',
          updatedAt: now,
        },
      },
      dbOptions
    );

    if (!sampleUpdateResult || sampleUpdateResult.matchedCount === 0) {
      const error = new Error('Nenhuma amostra encontrada para o specimenId deste registro; documentação externa não anexada.');
      error.statusCode = 404;
      throw error;
    }

    await staging.updateOne({ _id: recordId, batchId }, { $set: updatedRecord }, dbOptions);

    if (existingSample && wasQuarantined) {
      await quarantineActionService.releaseActiveAction(db, existingSample, options.userID || 'SYSTEM', undefined, session);
    }
    // RF006 AC7: the status change, append-only, with the release.
    if (existingSample) {
      await operationalStateDecisionService.recordStatusChange(db, {
        specimenId: normalized.specimenId,
        previousStatus,
        newStatus: 'available',
        triggerEventId: String(recordId),
        rulesApplied: ['fhir_external_document_release'],
        reasonCodes: ['EXTERNAL_ATTACHED'],
      }, { session });
    }
  };

  if (capable) {
    await withMongoTransaction(db, (session) => doRelease(session));
  } else {
    logger.warn('[FHIR_IMPORT] attachExternalDocument: MongoDB standalone (sem replica set/mongos) -- release da amostra e commit do registro staging seguem como duas escritas sequenciais, não atômicas.', { batchId, recordId });
    await doRelease(undefined);
  }

  await audit(db, 'FHIR_IMPORT_EXTERNAL_DOCUMENT_ATTACHED', { batchId, recordId, participantId: normalized.participantId, specimenId: normalized.specimenId });

  return getConsentStatus(db, batchId);
}

module.exports = {
  STATUS,
  stageBundle,
  getBatch,
  validateBatch,
  sendConsents,
  getConsentStatus,
  validateImportConsentToken,
  acceptImportConsentToken,
  commitBatch,
  attachExternalDocument,
  normalizeEntries,
};
