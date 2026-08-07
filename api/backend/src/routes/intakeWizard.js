// backend/src/routes/intakeWizard.js
const express = require('express');
const router = express.Router();
const patientIdentityService = require('../services/PatientIdentityService');
const { generateSampleHash } = require('../services/MerkleService');
const { getCollection } = require('../utils/collectionResolver');
const auditLogger = require('../utils/auditLogger');
const qualityDomain = require('../services/quality-domain.service');
const sampleService = require('../services/sample.service');
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

function resolvePatientID(data = {}) {
  const participant = normalizeObject(data?.participant);
  const patientID = normalizeString(participant.participantId);

  if (/^\d{8}$/.test(patientID)) {
    return patientID;
  }

  return buildFallbackPatientID();
}

function buildClinicalData(data = {}) {
  const diagnosis = normalizeObject(data?.diagnosis);
  const clinical = normalizeObject(data?.clinical);

  return {
    orphaCode: normalizeString(diagnosis.orphaCode),
    omimCode: normalizeString(diagnosis.omimCode),
    cid: normalizeString(diagnosis.icdCode),
    phenotypes: normalizeArray(clinical.diseasePhenotypes),
    charlsonComorbidities: normalizeArray(clinical.charlsonConditions),
    biomarkerValues: normalizeObject(clinical.biomarkersValues),
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
  const specimen = normalizeObject(data?.specimen);
  const consent = normalizeObject(data?.consent);
  const requestedStatusRaw = normalizeString(specimen.specimenStatus).toLowerCase();
  const specimenStatus = requestedStatusRaw === 'available' ? 'available' : 'quarantined';
  const registrationDate = specimen.registeredAt || new Date().toISOString();
  const confirmedPatientID = normalizeString(matchedPatient?.participantId) || resolvePatientID(data);
  const confirmedPatientName = normalizeString(matchedPatient?.patientName || data?.participant?.patientName);

  return {
    participantId: confirmedPatientID,
    participantName: confirmedPatientName || null,
    patientObjectId: matchedPatient?._id || null,
    sampleType: normalizeString(specimen.sampleType || specimen.sprec?.sampleType || 'UNKNOWN'),
    sampleOrigin: normalizeString(specimen.sampleOrigin || specimen.sampleType || 'UNKNOWN'),
    extractionProtocol: normalizeString(specimen.extractionProtocol || 'UNKNOWN'),
    barcode: normalizeString(specimen.barcode) || null,
    registeredAt: new Date(registrationDate),
    quantity: normalizeNumber(specimen.quantity, 0),
    unit: normalizeString(specimen.unit) || null,
    specimenStatus,
    linkedProject: normalizeString(specimen.linkedProject) || 'INTAKE_WIZARD',
    sprec: normalizeObject(specimen.sprec),
    consentTemplateId: normalizeString(consent.consentTemplateId) || null,
    clinicalData: buildClinicalData(data),
    pharmacologyData: buildPharmacologyData(data),
    merkleRoot: null,
    // #502: no RcsAssessment/SpecimenPreanalytics snapshot is recorded for
    // intake-wizard samples, so pin explicitly to "none" rather than leaving
    // the property absent — MerkleService.generateSampleHashFromSample reads
    // an absent property as "pre-#502 sample, resolve newest" instead of
    // "sealed with no snapshot," which would defeat the pin.
    sealedRcsAssessmentId: null,
    sealedSpecimenPreanalyticsId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function resolveMatchedPatient(db, data = {}) {
  const participant = normalizeObject(data?.participant);

  const result = await patientIdentityService.matchOrUpsertParticipant(db, {
    participantId: participant.participantId,
    patientName: participant.patientName,
    birthDate: parseBirthDate(participant.birthDate),
    identityDocument: normalizeString(participant.identityDocument) || null,
  });

  return result;
}

async function resolveConsentDecision(db, patient) {
  const patientIDs = buildIdVariants(patient?.participantId, patient?._id?.toString()).map(String);
  if (patientIDs.length === 0) {
    const error = new Error('Paciente sem identificador para validar consentimento ativo.');
    error.statusCode = 400;
    throw error;
  }

  const consentsCollection = await getCollection(db, 'consents');
  const activeConsent = await consentsCollection.findOne(
    {
      participantId: { $in: patientIDs },
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
      patientId: activeConsent.participantId || null,
      status: 'SIGNED',
      quarantineReason: null,
      governanceReason: null,
    };
  }

  const revokedConsent = await consentsCollection.findOne(
    {
      participantId: { $in: patientIDs },
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
      patientId: revokedConsent.participantId || null,
      status: 'REVOKED',
      quarantineReason: 'CONSENT_REVOKED',
      governanceReason: 'Consentimento revogado.',
    };
  }

  return {
    active: false,
    consentId: null,
    patientId: null,
    status: 'PENDING',
    quarantineReason: 'CONSENT_PENDING',
    governanceReason: 'Consentimento ainda não ativo/assinado.',
  };
}

function isOperationalSensor(sensor) {
  const status = normalizeString(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus).toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

/**
 * #463: Sensor has no dict-02 canonical placement of its own (#465), so the
 * operational-sensor safety gate (RF004) matches at the resolved FREEZER
 * StorageContainer's `containerID` — same equipment-level granularity #462
 * established for sample.service.js's createSample gate.
 */
async function hasOperationalSensorForContainer(db, freezer) {
  const sensorsCollection = db.collection('sensors');
  const variants = buildIdVariants(freezer?.containerID);
  const sensors = await sensorsCollection.find({
    $or: [
      { locationId: { $in: variants } },
      { locationID: { $in: variants } },
    ],
  }).limit(20).toArray();

  return sensors.some(isOperationalSensor);
}

async function isEquipmentReadyForContainer(db, freezer) {
  if (freezer?.containerID === undefined || freezer?.containerID === null || freezer?.containerID === '') {
    return false;
  }

  const equipmentCollection = db.collection('equipment');
  const equipment = await equipmentCollection.findOne({
    equipmentID: { $in: buildIdVariants(freezer.containerID) },
  });

  if (!equipment) return false;
  const status = normalizeString(equipment.status || equipment.maintenanceStatus || equipment.operationalStatus).toLowerCase();
  return !status || !BLOCKED_EQUIPMENT_STATUSES.includes(status);
}

/**
 * #462/#463: walks the StorageContainer chain up from a StorageBox's
 * `parent_id` (RACK, optionally through a DRAWER) to SHELF then FREEZER —
 * same hierarchy the #461 backfill script materializes. Best-effort: a box
 * with a broken/incomplete chain returns whichever levels resolved, `null`
 * above that.
 */
async function resolveStorageHierarchyForBox(db, box) {
  const storageContainersCollection = db.collection('storageContainers');

  let rack = box.parent_id ? await storageContainersCollection.findOne({ _id: box.parent_id }) : null;
  if (rack && rack.containerType === 'DRAWER') {
    rack = rack.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
  }

  const shelf = rack?.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
  const freezer = shelf?.parent_id ? await storageContainersCollection.findOne({ _id: shelf.parent_id }) : null;

  return { rack, shelf, freezer };
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

function findAvailableStorageBoxCandidates(boxes) {
  return boxes.filter((box) => {
    const status = normalizeString(box?.status).toUpperCase();
    if (status && BLOCKED_BOX_STATUSES.includes(status)) return false;
    const capacity = Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0);
    if (capacity < 1) return false;
    if (Number(box?.currentOccupancy || 0) >= capacity) return false;
    return Boolean(findFirstAvailablePosition(box));
  });
}

/**
 * #463: replaces the legacy `locations`-collection scan. A box now carries
 * its own equipment/sensor linkage via the StorageContainer chain it sits
 * in (RACK[/DRAWER]/SHELF/FREEZER), so candidate boxes (available capacity
 * + free position) are gated directly on their resolved FREEZER's readiness
 * instead of an independent `locations` lookup — same convention #462
 * established for sample.service.js's createSample.
 */
async function resolveAutomaticLocation(db) {
  const boxesCollection = db.collection('storageBoxes');
  const boxes = await boxesCollection.find({}).sort({ name: 1, boxID: 1, _id: 1 }).limit(100).toArray();
  const candidates = findAvailableStorageBoxCandidates(boxes);

  if (candidates.length === 0) {
    const error = new Error('Não há localização física disponível com sensor operacional associado para esta amostra.');
    error.statusCode = 409;
    throw error;
  }

  for (const box of candidates) {
    const { rack, shelf, freezer } = await resolveStorageHierarchyForBox(db, box);
    if (!freezer) continue;
    if (!(await isEquipmentReadyForContainer(db, freezer))) continue;
    if (!(await hasOperationalSensorForContainer(db, freezer))) continue;

    return {
      box,
      rack,
      shelf,
      freezer,
      previewPosition: findFirstAvailablePosition(box),
    };
  }

  const error = new Error('Não há localização física disponível com sensor operacional associado para esta amostra.');
  error.statusCode = 422;
  throw error;
}

function buildReadableStorageLocation(automaticLocation, allocation) {
  const storageLocation = allocation?.sampleLocation || {};
  const box = automaticLocation?.box;
  const freezer = automaticLocation?.freezer;
  return [
    freezer?.containerID ? `equipamento ${freezer.containerID}` : null,
    box?.name || box?.boxID ? `box ${box.name || box.boxID}` : null,
    storageLocation.position ? `posição ${storageLocation.position}` : null,
  ].filter(Boolean).join(' / ');
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

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Dados inválidos para intake wizard.' });
  }

  try {
    const canonicalViolations = [
      ...collectCanonicalViolations(data?.participant, {
        participantId: ['patientID', 'patientId', 'pseudoId', 'mongoPatientId'],
      }),
      ...collectCanonicalViolations(data?.specimen, {
        specimenId: ['sampleID', 'sampleId', 'specimenID', 'mongoSampleId'],
        parentSpecimenId: ['parentSampleId'],
        registeredAt: ['registerDate', 'registrationDate'],
        withdrawnAt: ['withdrawalDate'],
        receivedAt: ['receivedTime'],
        specimenStatus: ['currentStatus', 'lifecycleStatus'],
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
    const qualidade = resolverQualidadeMetodologica(data?.specimen || {});

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      resourceType: 'Patient',
      resourceId: matchOutcome?.patient?.participantId || null,
      status: 'success',
      severity: 'info',
      message: matchOutcome?.created
        ? 'Novo paciente criado durante intake wizard.'
        : 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: {
        created: Boolean(matchOutcome?.created),
        matched: !Boolean(matchOutcome?.created),
        matchType: matchOutcome?.matchType || null,
        patientID: matchOutcome?.patient?.participantId || null,
      },
      req,
      module: 'Cadastro'
    });

    const sampleToPersist = buildSampleDocumentFromIntake(data, matchOutcome.patient);
    sampleToPersist.boxId = automaticLocation.box._id;
    sampleToPersist.positionCode = automaticLocation.previewPosition;
    const qualityAllowsRelease = qualidade.governance_status === 1 && qualidade.final_grade !== 'E';
    const isReleased = consentDecision.active && qualityAllowsRelease;
    const specimenStatus = isReleased ? 'available' : 'quarantined';
    Object.assign(sampleToPersist, {
      qualityAssessment: qualidade,
      consentStatus: consentDecision.active ? 'SIGNED' : consentDecision.status,
      specimenStatus,
      quarantineReason: isReleased
        ? null
        : consentDecision.quarantineReason || (qualityAllowsRelease ? 'GOVERNANCE_BLOCKED' : 'QUALITY_GOVERNANCE_FAILURE'),
    });
    if (qualidade.sprec && Object.keys(qualidade.sprec).length > 0) {
      sampleToPersist.sprec = qualidade.sprec;
    }
    sampleToPersist.merkleRoot = generateSampleHash(sampleToPersist);
    // #474: sampleService.createSample now allocates boxId/positionCode
    // atomically via AllocateSampleUseCase as part of the create call
    // itself (occupancyGrid write, StorageAssignment, audit/lineage trail)
    // instead of writing storageLocation directly — the wizard's own
    // separate assignSampleToBox step this used to run afterward is gone,
    // since the position is already committed by the time createSample
    // returns (and re-running it here would now fail as ALREADY_ALLOCATED).
    const createdSample = await sampleService.createSample(db, sampleToPersist, {
      auditInfo: {
        userId: req.user?.id || req.user?._id || null,
        userName: req.user?.name || req.user?.email || 'INTAKE_WIZARD',
        userRole: req.user?.role || null,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        notes: 'Cadastro integrado via Intake Wizard',
      },
      neo4jDriver: req.app.locals.neo4jDriver || null,
    });

    const allocation = { sampleLocation: createdSample.storageLocation || null };

    const samplesCollection = await getCollection(db, 'samples');
    const allocatedSample = await samplesCollection.findOne({ _id: createdSample._id }) || createdSample;

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { _id: matchOutcome.patient._id },
      {
        $set: {
          lastClinicalData: sampleToPersist.clinicalData || {},
          updatedAt: new Date(),
        },
        $addToSet: {
          linkedSampleIds: String(createdSample._id),
        },
      }
    );

    const storageLocation = {
      equipmentID: automaticLocation.freezer?.containerID || null,
      boxId: allocation.sampleLocation?.boxId || automaticLocation.box._id,
      boxName: automaticLocation.box.name || automaticLocation.box.boxID || null,
      position: allocation.sampleLocation?.position || automaticLocation.previewPosition || null,
      readable: buildReadableStorageLocation(automaticLocation, allocation),
    };

    const responseMessage = isReleased
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
        patientID: matchOutcome.patient?.participantId || null,
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
      resourceType: 'Patient',
      resourceId: patient?.patientID || patientID || null,
      status: 'success',
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
  resolvePatientID,
  buildClinicalData,
  buildPharmacologyData,
  buildSampleDocumentFromIntake,
  resolveMatchedPatient,
  calcularQualidade,
  resolverQualidadeMetodologica,
};

module.exports = router;
