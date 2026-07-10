// backend/src/routes/intakeWizard.js
const express = require('express');
const router = express.Router();
const notificationService = require('../services/notification.service');
const patientIdentityService = require('../services/PatientIdentityService');
const { generateSampleHash } = require('../services/MerkleService');
const { getCollection } = require('../utils/collectionResolver');
const auditLogger = require('../utils/auditLogger');
const qualityDomain = require('../services/quality-domain.service');
const sampleService = require('../services/sample.service');
const StorageService = require('../services/storageService');
const { validate } = require('../contracts/canonical/v1');

const CRITICAL_SENSOR_STATUSES = ['maintenance', 'calibration', 'error', 'offline'];
const BLOCKED_EQUIPMENT_STATUSES = ['maintenance', 'inactive', 'needs calibration', 'error', 'retired'];
const BLOCKED_BOX_STATUSES = ['FULL', 'RETIRED', 'INACTIVE'];

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function collectNonCanonicalFields(payload, allowedKeys, path = '') {
  const fields = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fields;
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      fields.push(path ? `${path}.${key}` : key);
    }
  }
  return fields;
}

function collectCanonicalViolations(payload, aliasMap = {}) {
  const fields = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fields;

  for (const [canonicalKey, aliases] of Object.entries(aliasMap)) {
    const aliasList = Array.isArray(aliases) ? aliases : [];
    for (const alias of aliasList) {
      if (Object.prototype.hasOwnProperty.call(payload, alias)) {
        fields.push(alias);
      }
    }
  }

  return [...new Set(fields)];
}

function buildIdVariants(...values) {
  const variants = [];
  values.forEach((value) => {
    if (value === undefined || value === null || value === '') return;
    const stringValue = String(value).trim();
    if (!stringValue) return;
    variants.push(stringValue);
    const numericValue = Number(stringValue);
    if (Number.isFinite(numericValue)) {
      variants.push(numericValue);
    }
  });
  return [...new Set(variants)];
}

function parseBirthDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = normalizeString(value);
  if (!raw) return null;

  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]) - 1;
    const year = Number(ddmmyyyy[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
      return date;
    }
  }

  const iso = new Date(raw);
  if (Number.isNaN(iso.getTime())) return null;
  return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
}

function buildFallbackPatientID() {
  const digits = String(Date.now()).replace(/\D/g, '').slice(-8);
  return digits.padStart(8, '0');
}

function resolveRecipientAndTemplate(data = {}) {
  const demographic = data?.demographic || {};
  const representativeLegal = data?.representativeLegal || {};
  const consent = data?.consent || {};
  const sample = data?.sample || {};

  const patientName = normalizeString(demographic.patientName);
  const participantId = normalizeString(demographic.participantId || sample.participantId || data?.participantId);
  const patientEmail = normalizeString(demographic.email);
  const representativeEmail = normalizeString(representativeLegal.email);
  const recipientEmail = patientEmail || representativeEmail;
  const templateId = normalizeString(consent.tcle_template_id || sample.selected_tcle);

  return {
    patientName,
    participantId,
    recipientEmail,
    templateId
  };
}

function resolvePatientID(data = {}) {
  const demographic = normalizeObject(data?.demographic);
  const sample = normalizeObject(data?.sample);
  const participantId = normalizeString(demographic.participantId || sample.participantId || data?.participantId);

  if (/^\d{8}$/.test(participantId)) {
    return participantId;
  }

  return participantId || buildFallbackPatientID();
}

function buildClinicalData(data = {}) {
  const diagnosis = normalizeObject(data?.diagnosis);
  const clinical = normalizeObject(data?.clinical);
  const integrity = normalizeObject(data?.integrity);

  return {
    orphaCode: normalizeString(diagnosis.orphaCode),
    omimCode: normalizeString(diagnosis.omimCode),
    cid: normalizeString(diagnosis.icdCode),
    phenotypes: normalizeArray(clinical.diseasePhenotypes),
    charlsonComorbidities: normalizeArray(clinical.charlsonConditions),
    biomarkerValues: normalizeObject(clinical.biomarkersValues || integrity.biomarkers_values),
  };
}

function buildPharmacologyData(data = {}) {
  const clinical = normalizeObject(data?.clinical);
  const pharmacology = normalizeObject(clinical.pharmacologyData);

  const treatmentStatusRaw = normalizeString(pharmacology.treatmentStatus).toUpperCase();
  const treatmentStatus = ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'].includes(treatmentStatusRaw) ? treatmentStatusRaw : '';
  const atcCode = normalizeString(pharmacology.atcCode)
    .replace(/^ATC:/i, '')
    .toUpperCase();
  const atcLevel1 = normalizeString(pharmacology.atcClass)
    .toUpperCase() || (atcCode ? atcCode.charAt(0) : '');
  const drugName = normalizeString(pharmacology.medicationName);

  return {
    treatmentStatus,
    medicationName: drugName || null,
    atcCode: atcCode || null,
    atcClass: atcLevel1 || null,
    lastDoseDate: normalizeString(pharmacology.lastDoseDate) || null,
    washoutStartDate: normalizeString(pharmacology.washoutStartDate) || null,
    washoutEndDate: normalizeString(pharmacology.washoutEndDate) || null,
  };
}

function buildSampleDocumentFromIntake(data = {}, matchedPatient = null) {
  const sample = normalizeObject(data?.sample);
  const consent = normalizeObject(data?.consent);
  const integrity = normalizeObject(data?.integrity);
  const releaseStatusRaw = normalizeString(sample.lifecycleStatus).toUpperCase();
  const releaseStatus = ['QUARANTINE', 'AVAILABLE', 'BLOCKED'].includes(releaseStatusRaw) ? releaseStatusRaw : 'QUARANTINE';
  const registrationDate = sample.registeredAt || new Date().toISOString();
  const confirmedPatientID = normalizeString(matchedPatient?.participantId) || resolvePatientID(data);
  const confirmedPatientName = normalizeString(matchedPatient?.patientName || data?.demographic?.patientName);

  return {
    participantId: confirmedPatientID,
    participantName: confirmedPatientName || null,
    patientObjectId: matchedPatient?._id || null,
    sampleType: normalizeString(sample.sampleType || sample.sprec?.sampleType || 'UNKNOWN'),
    sampleOrigin: normalizeString(sample.sampleOrigin || sample.sampleType || 'UNKNOWN'),
    extractionProtocol: normalizeString(sample.extractionProtocol || sample.protocolApplied || 'UNKNOWN'),
    barcode: normalizeString(sample.barcode) || null,
    registeredAt: new Date(registrationDate),
    quantity: normalizeNumber(sample.quantity, 0),
    unit: normalizeString(sample.unit) || null,
    lifecycleStatus: releaseStatus,
    linkedProject: normalizeString(sample.linkedProject || sample.linked_project) || 'INTAKE_WIZARD',
    sprec: normalizeObject(sample.sprec),
    consentTemplateId: normalizeString(consent.tcle_template_id || sample.selected_tcle || integrity.selected_tcle) || null,
    clinicalData: buildClinicalData(data),
    pharmacologyData: buildPharmacologyData(data),
    merkleRoot: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function resolveMatchedPatient(db, data = {}) {
  const demographic = normalizeObject(data?.demographic);
  const representative = normalizeObject(data?.representativeLegal);
  const sample = normalizeObject(data?.sample);

  const result = await patientIdentityService.matchOrUpsertParticipant(db, {
    participantId: demographic.participantId || sample.participantId || data?.participantId,
    patientName: demographic.patientName,
    birthDate: parseBirthDate(demographic.birthDate),
    email: normalizeString(demographic.email || representative.email).toLowerCase() || null,
    sex: normalizeString(demographic.gender || demographic.sex).toUpperCase() || null,
    cpf: normalizeString(demographic.cpf || demographic.documento) || null,
    isDeceased: Boolean(demographic.isDeceased),
    representativeName: normalizeString(representative.name || demographic.representativeName) || null,
    representativeEmail: normalizeString(representative.email || demographic.representativeEmail).toLowerCase() || null,
    representativeCpf: normalizeString(representative.cpf || demographic.representativeCpf) || null,
  });

  return result;
}

async function ensureConsentEmailSent(payload) {
  const { patientName, participantId, recipientEmail, templateId } = resolveRecipientAndTemplate(payload);

  if (!patientName) {
    return { ok: false, status: 400, message: 'Nome do paciente é obrigatório para envio do TCLE.' };
  }

  if (!templateId) {
    return { ok: false, status: 400, message: 'Selecione um TCLE antes de finalizar o cadastro.' };
  }

  if (!recipientEmail) {
    return { ok: false, status: 400, message: 'E-mail do paciente ou representante é obrigatório para envio do TCLE.' };
  }

  const patientData = {
    participantId: participantId || `INTAKE-${Date.now()}`,
    patientName,
    email: recipientEmail,
  };

  const consentMetadata = notificationService.buildConsentMetadata();
  const consentLink = notificationService.buildConsentLink(patientData, consentMetadata.token);
  const emailResult = await notificationService.sendConsentEmail(patientData, consentLink);

  if (!emailResult?.success) {
    return { ok: false, status: 502, message: 'Não foi possível enviar o TCLE por e-mail. O cadastro não foi finalizado.', details: emailResult || null };
  }

  return {
    ok: true,
    consentEmail: {
      success: true,
      channel: emailResult.channel || 'email',
      provider: emailResult.provider || null,
      messageId: emailResult.messageId || null,
      to: emailResult.originalTo || emailResult.to || recipientEmail,
      consentLink,
      sentAt: new Date().toISOString(),
    }
  };
}

async function resolveConsentDecision(db, patient) {
  const patientIDs = buildIdVariants(patient?.patientID, patient?._id?.toString()).map(String);
  if (patientIDs.length === 0) {
    const error = new Error('Paciente sem identificador para validar consentimento ativo.');
    error.statusCode = 400;
    throw error;
  }

  const consentsCollection = await getCollection(db, 'consents');
  const activeConsent = await consentsCollection.findOne(
    {
      patientId: { $in: patientIDs },
      status: 'ACTIVE',
    },
    {
      sort: { signedAt: -1, updatedAt: -1, createdAt: -1 },
    }
  );

  if (activeConsent) {
    return {
      active: true,
      consentId: activeConsent._id || null,
      patientId: activeConsent.patientId || null,
      status: 'SIGNED',
      releaseStatus: 'AVAILABLE',
      quarantineStatus: 'RELEASED',
      availabilityStatus: 'AVAILABLE',
      quarantineReason: null,
      governanceReason: null,
    };
  }

  const revokedConsent = await consentsCollection.findOne(
    {
      patientId: { $in: patientIDs },
      status: 'REVOKED',
    },
    {
      sort: { revokedAt: -1, updatedAt: -1, createdAt: -1 },
    }
  );

  if (revokedConsent) {
    return {
      active: false,
      consentId: revokedConsent._id || null,
      patientId: revokedConsent.patientId || null,
      status: 'REVOKED',
      releaseStatus: 'BLOCKED',
      quarantineStatus: 'QUARANTINED',
      availabilityStatus: 'BLOCKED',
      quarantineReason: 'CONSENT_REVOKED',
      governanceReason: 'Consentimento revogado.',
    };
  }

  return {
    active: false,
    consentId: null,
    patientId: null,
    status: 'PENDING',
    releaseStatus: 'BLOCKED',
    quarantineStatus: 'QUARANTINED',
    availabilityStatus: 'BLOCKED',
    quarantineReason: 'CONSENT_PENDING',
    governanceReason: 'Consentimento ainda não ativo/assinado.',
  };
}

function isOperationalSensor(sensor) {
  const status = normalizeString(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus).toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

async function hasOperationalSensorForLocation(db, location) {
  const sensorsCollection = db.collection('sensors');
  const variants = buildIdVariants(location?.locationID, location?._id?.toString());
  const sensors = await sensorsCollection.find({
    $or: [
      { locationId: { $in: variants } },
      { locationID: { $in: variants } },
    ],
  }).limit(20).toArray();

  return sensors.some(isOperationalSensor);
}

async function isEquipmentReadyForLocation(db, location) {
  if (location?.equipmentID === undefined || location?.equipmentID === null || location?.equipmentID === '') {
    return true;
  }

  const equipmentCollection = db.collection('equipment');
  const equipment = await equipmentCollection.findOne({
    equipmentID: { $in: buildIdVariants(location.equipmentID) },
  });

  if (!equipment) return false;
  const status = normalizeString(equipment.status || equipment.maintenanceStatus || equipment.operationalStatus).toLowerCase();
  return !status || !BLOCKED_EQUIPMENT_STATUSES.includes(status);
}

function findFirstAvailablePosition(box) {
  const rows = Number(box?.dimension?.rows || 0);
  const cols = Number(box?.dimension?.cols || 0);
  if (rows < 1 || cols < 1) return null;

  const occupancyGrid = box?.occupancyGrid || {};
  for (let row = 0; row < rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const position = `${String.fromCharCode(65 + row)}${col}`;
      const occupied = typeof occupancyGrid.has === 'function'
        ? occupancyGrid.has(position) && occupancyGrid.get(position)
        : occupancyGrid[position];
      if (!occupied) return position;
    }
  }

  return null;
}

async function findAvailableStorageBox(db) {
  const boxesCollection = db.collection('storageBoxes');
  const boxes = await boxesCollection.find({}).sort({ name: 1, boxID: 1, _id: 1 }).limit(100).toArray();

  return boxes.find((box) => {
    const status = normalizeString(box?.status).toUpperCase();
    if (status && BLOCKED_BOX_STATUSES.includes(status)) return false;
    const capacity = Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0);
    if (capacity < 1) return false;
    if (Number(box?.currentOccupancy || 0) >= capacity) return false;
    return Boolean(findFirstAvailablePosition(box));
  }) || null;
}

async function resolveAutomaticLocation(db) {
  const locationsCollection = db.collection('locations');
  const locations = await locationsCollection.find({}).sort({ locationID: 1, _id: 1 }).limit(200).toArray();

  for (const location of locations) {
    if (!Number.isFinite(Number(location?.locationID))) continue;
    if (!(await isEquipmentReadyForLocation(db, location))) continue;
    if (!(await hasOperationalSensorForLocation(db, location))) continue;

    const box = await findAvailableStorageBox(db);
    if (!box) {
      const error = new Error('Não há localização física disponível com sensor operacional associado para esta amostra.');
      error.statusCode = 409;
      throw error;
    }

    return {
      location,
      box,
      previewPosition: findFirstAvailablePosition(box),
    };
  }

  const error = new Error('Não há localização física disponível com sensor operacional associado para esta amostra.');
  error.statusCode = 422;
  throw error;
}

function buildReadableStorageLocation(location, allocation, box) {
  const storageLocation = allocation?.sampleLocation || {};
  return [
    location?.equipmentID ? `equipamento ${location.equipmentID}` : null,
    location?.locationID ? `localização ${location.locationID}` : null,
    box?.name || box?.boxID ? `box ${box.name || box.boxID}` : null,
    storageLocation.position ? `posição ${storageLocation.position}` : null,
  ].filter(Boolean).join(' / ');
}

async function assignSampleToBox(db, sampleId, boxId, neo4jDriver = null) {
  const storageService = new StorageService(db, neo4jDriver);
  return storageService.autoAssignSampleToBox(sampleId, boxId);
}

function buildLabelLinks(sample) {
  const sampleId = normalizeString(sample?._id?.toString?.() || sample?._id || sample?.sampleID || sample?.barcode);
  return {
    sampleId,
    jsonUrl: `/api/labels/samples/${encodeURIComponent(sampleId)}`,
    zplUrl: `/api/labels/samples/${encodeURIComponent(sampleId)}?format=zpl`,
    svgUrl: `/api/labels/samples/${encodeURIComponent(sampleId)}?format=svg`,
    htmlUrl: `/api/labels/samples/${encodeURIComponent(sampleId)}?format=html`,
    printJobUrl: `/api/labels/samples/${encodeURIComponent(sampleId)}/print-job`,
  };
}

const resolverQualidadeMetodologica = qualityDomain.resolveMethodologicalQuality;
function calcularQualidade(samplePayloadOrTempo, temperatura) {
  if (typeof samplePayloadOrTempo === 'number') {
    return resolverQualidadeMetodologica({
      matrixType: 'fluid',
      sprec: {
        matrixType: 'fluid',
        preCentrifugation: '',
      },
      documentation_insufficient: true,
      legacy_numeric_quality_input: { tempo: samplePayloadOrTempo, temperatura },
    });
  }

  return resolverQualidadeMetodologica(samplePayloadOrTempo);
}

async function handleIntakeWizard(req, res) {
  const data = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Dados inválidos para intake wizard.' });
  }

  try {
    const canonicalViolations = [
      ...collectCanonicalViolations(data?.demographic, {
        participantId: ['patientID', 'patientId', 'pseudoId', 'mongoPatientId'],
      }),
      ...collectCanonicalViolations(data?.sample, {
        specimenId: ['sampleID', 'sampleId', 'specimenID', 'mongoSampleId'],
        parentSpecimenId: ['parentSampleId'],
        registeredAt: ['registerDate', 'registrationDate'],
        withdrawnAt: ['withdrawalDate'],
        receivedAt: ['receivedTime'],
        lifecycleStatus: ['currentStatus'],
        consentTemplateId: ['tcle_id', 'tcle_template_id', 'selected_tcle'],
        merkleRoot: ['merkle_root'],
        legacyCompat: ['legacy_compat'],
      }),
      ...collectCanonicalViolations(data?.consent, {
        consentTemplateId: ['tcle_id', 'tcle_template_id', 'selected_tcle'],
      }),
      ...collectCanonicalViolations(data?.clinical, {
        clinicalData: ['clinical_data'],
        pharmacologyData: ['pharmacology_data'],
        biomarkerValues: ['biomarkers_values'],
      }),
      ...collectCanonicalViolations(data?.integrity, {
        clinicalData: ['clinical_data'],
        pharmacologyData: ['pharmacology_data'],
        merkleRoot: ['merkle_root'],
        consentTemplateId: ['selected_tcle'],
      }),
    ];

    if (canonicalViolations.length > 0) {
      return res.status(422).json({ error: 'NON_CANONICAL_FIELD', fields: canonicalViolations });
    }

    const validation = validate('canonical.v1.intake', data);
    if (!validation.valid) {
      const fields = [];
      for (const issue of validation.errors || []) {
        const field = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.') || issue.params?.missingProperty || null;
        if (field) fields.push(field);
      }
      return res.status(422).json({ error: 'NON_CANONICAL_FIELD', fields: [...new Set(fields)] });
    }

    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível para persistir o intake wizard.',
      });
    }

    const matchOutcome = await resolveMatchedPatient(db, data);
    const consentDecision = await resolveConsentDecision(db, matchOutcome.patient);
    const automaticLocation = await resolveAutomaticLocation(db);
    const qualidade = resolverQualidadeMetodologica(data?.sample || {});

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: matchOutcome?.patient?.patientID || null,
      resourceType: 'Patient',
      resourceId: matchOutcome?.patient?.patientID || null,
      status: 'success',
      result: 'success',
      severity: 'info',
      message: matchOutcome?.created
        ? 'Novo paciente criado durante intake wizard.'
        : 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: {
        created: Boolean(matchOutcome?.created),
        matched: !Boolean(matchOutcome?.created),
        matchType: matchOutcome?.matchType || null,
        patientID: matchOutcome?.patient?.patientID || null,
      },
      req,
      module: 'Cadastro'
    });

    const sampleToPersist = buildSampleDocumentFromIntake(data, matchOutcome.patient);
    sampleToPersist.locationID = Number(automaticLocation.location.locationID);
    const qualityAllowsRelease = qualidade.governance_status === 1 && qualidade.final_grade !== 'E';
    const releaseStatus = consentDecision.active
      ? (qualityAllowsRelease ? 'AVAILABLE' : 'QUARANTINE')
      : consentDecision.releaseStatus;
    const isReleased = releaseStatus === 'AVAILABLE';
    Object.assign(sampleToPersist, {
      qualityAssessment: qualidade,
      consentStatus: consentDecision.active ? 'SIGNED' : consentDecision.status,
      quarantineStatus: isReleased ? 'RELEASED' : 'QUARANTINED',
      quarantineReason: isReleased
        ? null
        : consentDecision.quarantineReason || (qualityAllowsRelease ? 'GOVERNANCE_BLOCKED' : 'QUALITY_GOVERNANCE_FAILURE'),
      availabilityStatus: isReleased ? 'AVAILABLE' : 'BLOCKED',
      lifecycleStatus: releaseStatus,
    });
    if (qualidade.sprec && Object.keys(qualidade.sprec).length > 0) {
      sampleToPersist.sprec = qualidade.sprec;
    }
    sampleToPersist.merkleRoot = generateSampleHash(sampleToPersist);
    const createdSample = await sampleService.createSample(db, sampleToPersist, {
      auditInfo: {
        userId: req.user?.id || req.user?._id || null,
        userName: req.user?.name || req.user?.email || 'INTAKE_WIZARD',
        userRole: req.user?.role || null,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        notes: 'Cadastro integrado via Intake Wizard',
      },
    });

    const allocation = await assignSampleToBox(
      db,
      createdSample._id,
      automaticLocation.box._id,
      req.app.locals.neo4jDriver || null
    );

    if (!allocation?.success) {
      await sampleService.deleteSample(db, createdSample._id);
      const error = new Error(allocation?.message || 'Falha ao alocar automaticamente a amostra em posição livre.');
      error.statusCode = 409;
      throw error;
    }

    const samplesCollection = await getCollection(db, 'samples');
    const allocatedSample = await samplesCollection.findOne({ _id: createdSample._id }) || createdSample;

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { _id: matchOutcome.patient._id },
      {
        $set: {
          lastClinicalData: sampleToPersist.clinical_data || {},
          updatedAt: new Date(),
        },
        $addToSet: {
          linkedSampleIds: String(createdSample._id),
        },
      }
    );

    const storageLocation = {
      locationID: automaticLocation.location.locationID,
      equipmentID: automaticLocation.location.equipmentID || null,
      boxId: allocation.sampleLocation?.boxId || automaticLocation.box._id,
      boxName: automaticLocation.box.name || automaticLocation.box.boxID || null,
      position: allocation.sampleLocation?.position || automaticLocation.previewPosition || null,
      readable: buildReadableStorageLocation(automaticLocation.location, allocation, automaticLocation.box),
    };

    const responseMessage = releaseStatus === 'AVAILABLE'
      ? 'Cadastro integrado concluído com sucesso, amostra validada e localização automática atribuída.'
      : `Cadastro integrado concluído com sucesso, mas a amostra permanece bloqueada: ${consentDecision.governanceReason || 'decisão de governança do backend'}`;

    return res.json({
      success: true,
      message: responseMessage,
      qualidade: qualidade.final_grade ? `Grade ${qualidade.final_grade}` : 'Indeterminada',
      qualityAssessment: qualidade,
      patientMatch: {
        matched: !matchOutcome.created,
        created: matchOutcome.created,
        matchType: matchOutcome.matchType,
        patientID: matchOutcome.patient?.patientID || null,
      },
      consent: {
        active: consentDecision.active,
        status: consentDecision.status,
        consentId: consentDecision.consentId || null,
        patientId: consentDecision.patientId || null,
        reason: consentDecision.governanceReason || null,
      },
      storageLocation,
      label: buildLabelLinks(allocatedSample),
      data,
      sample: allocatedSample,
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({
      success: false,
      error: error?.message || 'Erro desconhecido ao finalizar o Intake Wizard.',
    });
  }
}

router.get('/patient-match', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) {
    return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
  }

  const patientName = normalizeString(req.query?.patientName || req.query?.name);
  const birthDate = parseBirthDate(req.query?.birthDate);
  const patientID = normalizeString(req.query?.patientID || req.query?.patientId);

  if (!patientID && (!patientName || !birthDate)) {
    return res.status(400).json({ success: false, error: 'Informe patientID ou (patientName + birthDate).' });
  }

  try {
    const patientsCollection = await getCollection(db, 'patients');
    const patientNameNormalized = patientName
      ? patientName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
      : '';

    const birthDateKey = birthDate
      ? `${birthDate.getFullYear()}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      : '';

    const patient = await patientsCollection.findOne(
      patientID
        ? {
          $or: [
            { patientID },
            ...(patientNameNormalized && birthDateKey ? [{ patientNameNormalized, birthDateKey }] : []),
          ],
        }
        : { patientNameNormalized, birthDateKey },
      {
        projection: {
          patientID: 1,
          patientName: 1,
          birthDate: 1,
          status: 1,
        },
      }
    );

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: patient?.patientID || patientID || null,
      resourceType: 'Patient',
      resourceId: patient?.patientID || patientID || null,
      status: 'success',
      result: 'success',
      severity: 'info',
      message: patient
        ? 'Heurística de intake encontrou paciente existente para upsert.'
        : 'Heurística de intake não encontrou paciente correspondente.',
      payload: {
        endpoint: '/patient-match',
        matched: Boolean(patient),
        query: {
          patientID: patientID || null,
          patientName: patientName || null,
          birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        },
      },
      req,
      module: 'Cadastro'
    });

    return res.json({
      success: true,
      matched: Boolean(patient),
      patient: patient
        ? {
          patientID: normalizeString(patient.patientID),
          patientName: normalizeString(patient.patientName),
          birthDate: patient.birthDate || null,
          status: normalizeString(patient.status || 'ACTIVE'),
        }
        : null,
      message: patient
        ? 'Paciente identificado. Novos dados serão vinculados ao perfil histórico.'
        : '',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || 'Falha ao consultar paciente.' });
  }
});

router.post('/', handleIntakeWizard);
router.post('/intake-wizard', handleIntakeWizard);

router._test = {
  normalizeString,
  normalizeNumber,
  normalizeArray,
  normalizeObject,
  parseBirthDate,
  buildFallbackPatientID,
  resolveRecipientAndTemplate,
  resolvePatientID,
  buildClinicalData,
  buildPharmacologyData,
  buildSampleDocumentFromIntake,
  resolveMatchedPatient,
  ensureConsentEmailSent,
  calcularQualidade,
  resolverQualidadeMetodologica,
};

module.exports = router;
