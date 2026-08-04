const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const notificationService = require('./NotificationService');
const qualityDomain = require('./quality-domain.service');
const logger = require('../utils/logger');
const { SampleModel } = require('../models/Sample');
const quarantineActionService = require('./quarantine-action.service');

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

function collection(db, name) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Banco de dados não disponível');
  }
  return db.collection(name);
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

  if (parts.length >= 7 && matrixType === 'solid') {
    return {
      matrixType,
      sampleType: parts[0],
      collectionType: parts[1],
      warmIschemia: parts[2],
      coldIschemia: parts[3],
      fixationType: parts[4],
      fixationTime: parts[5],
      longTermStorage: parts[6],
    };
  }

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
      collectionType: sprec.collectionType || 'X',
      warmIschemia: 'X',
      coldIschemia: 'X',
      fixationType: 'X',
      fixationTime: 'X',
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
  return qualityDomain.resolveMethodologicalQuality(payload);
}

function consentIsSigned(consent = {}) {
  const status = String(consent.status || '').trim().toUpperCase();
  return ['ACTIVE', 'COMPLETED', 'SIGNED', 'ACCEPTED'].includes(status);
}

function isValidEmail(email = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

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
  const records = await collection(db, 'import_staging_records').find({ batchId }).toArray();
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
    { _id: batchId },
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
  const records = bundleIndex.specimens.map((specimen, index) => normalizeSpecimen(specimen, index, bundleIndex));
  if (records.length === 0) {
    throw createBadRequest('Bundle FHIR não contém Specimen para staging.');
  }

  const now = new Date();
  const batchDoc = {
    type: 'FHIR_BUNDLE',
    status: 'STAGED',
    fileName: String(metadata.fileName || 'fhir-bundle.json'),
    source: 'FHIR',
    counts: summarize(records),
    createdBy: metadata.userID || null,
    createdAt: now,
    updatedAt: now,
  };
  const batchResult = await collection(db, 'import_batches').insertOne(batchDoc);
  const batchId = batchResult.insertedId;

  const docs = records.map((record) => ({
    ...record,
    batchId,
    createdAt: now,
    updatedAt: now,
  }));
  await collection(db, 'import_staging_records').insertMany(docs);
  const refreshed = await refreshBatchCounts(db, batchId);

  return {
    batch: { _id: batchId, ...batchDoc, status: refreshed.status, counts: refreshed.counts },
    records: refreshed.records,
  };
}

async function getBatch(db, batchIdRaw) {
  const batchId = toObjectId(batchIdRaw);
  const batch = await collection(db, 'import_batches').findOne({ _id: batchId });
  if (!batch) {
    const error = new Error('Lote de importação FHIR não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const records = await collection(db, 'import_staging_records').find({ batchId }).sort({ rowNumber: 1 }).toArray();
  return { batch, records };
}

async function validateBatch(db, batchIdRaw) {
  const batchId = toObjectId(batchIdRaw);
  const { records } = await getBatch(db, batchId);
  const staging = collection(db, 'import_staging_records');

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
  const { records } = await getBatch(db, batchId);
  const staging = collection(db, 'import_staging_records');
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
  const batch = await collection(db, 'import_batches').findOne({ _id: toObjectId(batchId) });
  const record = await collection(db, 'import_staging_records').findOne({ _id: toObjectId(recordId), batchId: toObjectId(batchId) });

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
  const staging = collection(db, 'import_staging_records');
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

async function getConsentStatus(db, batchIdRaw) {
  const batchId = toObjectId(batchIdRaw);
  const { batch, records } = await getBatch(db, batchId);
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

async function commitBatch(db, batchIdRaw) {
  const batchId = toObjectId(batchIdRaw);
  const { records } = await validateBatch(db, batchId);
  const patients = collection(db, 'patients');
  const samples = collection(db, 'samples');
  const staging = collection(db, 'import_staging_records');
  const batchInfo = await collection(db, 'import_batches').findOne({ _id: batchId });

  let committed = 0;
  for (const record of records) {
    if (record.status !== STATUS.READY_TO_COMMIT) {
      continue;
    }

    const normalized = record.normalized || {};
    const workflow = buildWorkflowSnapshot(record);
    const importedAt = new Date();
    const importedBy = String(batchInfo?.createdBy || record.createdBy || record.importedBy || '').trim() || null;
    await patients.updateOne(
      { participantId: normalized.participantId },
      {
        $setOnInsert: {
          participantId: normalized.participantId,
          patientName: normalized.patientName,
          cpf: normalized.patientDocument,
          createdAt: new Date(),
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const specimenStatus = workflow.quarantineStatus === 'RELEASED' ? 'available' : 'quarantined';
    const { lifecycleStatus, availabilityStatus: derivedAvailabilityStatus } = SampleModel.deriveLegacyStatuses(specimenStatus);
    const existingSample = await samples.findOne({ specimenId: normalized.specimenId });
    const wasQuarantined = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) === 'quarantined' : false;

    await samples.updateOne(
      { specimenId: normalized.specimenId },
      {
        $setOnInsert: {
          specimenId: normalized.specimenId,
          participantId: normalized.participantId,
          sampleType: normalized.sampleType,
          collectionDate: normalized.collectionDate,
          sprec: normalized.rcsPreview?.calculation_trace?.sprec || {},
          rcs_score: normalized.rcsPreview?.rcs_score ?? null,
          final_grade: normalized.rcsPreview?.final_grade || '',
          p_bio: normalized.rcsPreview?.p_bio ?? null,
          grade_route: normalized.rcsPreview?.grade_route || '',
          governance_status: normalized.rcsPreview?.governance_status ?? null,
          governance_failure_reasons: normalized.rcsPreview?.governance_failure_reasons || [],
          axis_penalties: normalized.rcsPreview?.axis_penalties || [],
          calculation_trace: normalized.rcsPreview?.calculation_trace || {},
          fhir: record.fhir?.specimen || null,
          createdAt: new Date(),
        },
        $set: {
          consentStatus: workflow.consentStatus,
          quarantineStatus: workflow.quarantineStatus,
          quarantineReason: workflow.quarantineReason,
          availabilityStatus: derivedAvailabilityStatus,
          specimenStatus,
          lifecycleStatus,
          importBatchId: String(batchId),
          importedAt,
          importedBy,
          releaseStatus: workflow.quarantineStatus === 'RELEASED' ? 'AVAILABLE' : 'QUARANTINE',
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const committedSample = await samples.findOne({ specimenId: normalized.specimenId });
    if (committedSample) {
      if (specimenStatus === 'quarantined' && !wasQuarantined) {
        await quarantineActionService.recordAction(db, {
          specimenIds: [String(committedSample._id)],
          reasonCodes: [workflow.quarantineReason || 'FHIR_IMPORT_REVIEW_REQUIRED'],
          authorizedBy: importedBy || 'SYSTEM',
        });
      } else if (specimenStatus === 'available' && wasQuarantined) {
        await quarantineActionService.releaseActiveAction(db, String(committedSample._id), importedBy || 'SYSTEM');
      }
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
    await audit(db, 'FHIR_IMPORT_RECORD_COMMITTED', { batchId, recordId: record._id, participantId: normalized.participantId, specimenId: normalized.specimenId });
    committed += 1;
  }

  const refreshed = await refreshBatchCounts(db, batchId);
  return { ...refreshed, committed };
}

async function attachExternalDocument(db, batchIdRaw, recordIdRaw, options = {}) {
  const batchId = toObjectId(batchIdRaw);
  const recordId = toObjectId(recordIdRaw);
  const staging = collection(db, 'import_staging_records');
  const samples = collection(db, 'samples');

  const record = await staging.findOne({ _id: recordId, batchId });
  if (!record) {
    const error = new Error('Registro FHIR não encontrado para anexar documentação externa.');
    error.statusCode = 404;
    throw error;
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

  await staging.updateOne({ _id: recordId, batchId }, { $set: updatedRecord });

  const existingSample = await samples.findOne({ specimenId: normalized.specimenId });
  const wasQuarantined = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) === 'quarantined' : false;
  const { lifecycleStatus, availabilityStatus } = SampleModel.deriveLegacyStatuses('available');

  await samples.updateOne(
    { specimenId: normalized.specimenId },
    {
      $set: {
        consentStatus: 'EXTERNAL_ATTACHED',
        quarantineStatus: 'RELEASED',
        quarantineReason: null,
        availabilityStatus,
        specimenStatus: 'available',
        lifecycleStatus,
        releaseStatus: 'AVAILABLE',
        updatedAt: now,
      },
    }
  );

  if (existingSample && wasQuarantined) {
    await quarantineActionService.releaseActiveAction(db, String(existingSample._id), options.userID || 'SYSTEM');
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
