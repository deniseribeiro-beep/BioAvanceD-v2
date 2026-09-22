// backend/src/routes/intakeWizard.js
const express = require('express');
const router = express.Router();
const patientIdentityService = require('../services/PatientIdentityService');
const participantIdentityService = require('../services/participantIdentity.service');
const { generateSampleHash } = require('../services/MerkleService');
const { getCollection } = require('../utils/collectionResolver');
const auditLogger = require('../utils/auditLogger');
const qualityDomain = require('../services/quality-domain.service');
const sampleService = require('../services/sample.service');
const rcsAssessmentService = require('../services/rcs-assessment.service');
const encounterService = require('../services/encounter.service');
const conditionService = require('../services/condition.service');
const phenotypeObservationService = require('../services/phenotype-observation.service');
const medicationExposureService = require('../services/medication-exposure.service');
const allergyIntoleranceService = require('../services/allergy-intolerance.service');
const familyHistoryService = require('../services/family-history.service');
const procedureService = require('../services/procedure.service');
const clinicalObservationService = require('../services/clinical-observation.service');
const clinicalOutcomeService = require('../services/clinical-outcome.service');
const derivedScoreService = require('../services/derived-score.service');
const { computeCharlsonScore, ALGORITHM_VERSION: CCI_ALGORITHM_VERSION, SCORE_TYPE: CCI_SCORE_TYPE } = require('../services/charlsonComorbidityIndex');
const logger = require('../utils/logger');
const consentService = require('../services/consent.service');

// #693 (RF005 clinical-data slice 5/5): systemUri constants matching this
// repo's existing reference-import sources (reference-data/reference-
// imports/sources/*.js) -- reused here so conditionCoding/hpoCoding
// entries resolve against the same TerminologyConcept/ReferenceDatasetRelease
// rows RF028's importers actually populate, not a locally-invented URI.
const ORPHA_SYSTEM_URI = 'http://www.orpha.net';
const OMIM_SYSTEM_URI = 'https://www.omim.org';
// "CID" in this wizard's own field names is the Brazilian Portuguese
// abbreviation for ICD -- dict-01_FONTES.md's own SRC_ICD10/SRC_ICD11 rows
// use the English abbreviation instead (see build-loop's overlay, #255).
// Mapped to ICD-10 here since this wizard's diagnosisCidCode field has
// always meant CID-10 in this repo's existing terminology (no ICD-11
// picker exists in this wizard).
const ICD10_SYSTEM_URI = 'http://hl7.org/fhir/sid/icd-10';
const HPO_SYSTEM_URI = 'http://purl.obolibrary.org/obo/hp.owl';
const ATC_SYSTEM_URI = 'http://www.whocc.no/atc';
// #708: DCB is the only allergen coding system with a real reference
// importer in this repo (reference-data/reference-imports/sources/dcb.js)
// -- dict-02's ELM-0247 allows "DCB/SNOMED subset" but no SNOMED importer
// exists here, so the wizard's manual-entry allergen field is coded
// against DCB only, same "code what's actually importable" precedent as
// ICD-10-only for diagnosisCidCode above.
const DCB_SYSTEM_URI = 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb';
// #710: dict-02's ELM-0243 allows "SNOMED/terminologia institucional" for
// procedureCoding -- no SNOMED importer exists in this repo (same gap as
// DCB/SNOMED for AllergyIntolerance, #708), so manual-entry procedures are
// coded against a local/institutional system URI, the explicit alternative
// dict-02 itself names, rather than left uncoded.
const LOCAL_PROCEDURE_SYSTEM_URI = 'urn:biobank:local-procedure-terminology';
// #711: a real RF028 LOINC importer exists (reference-data/reference-
// imports/sources/loinc.js) -- same systemUri it uses.
const LOINC_OBSERVATION_SYSTEM_URI = 'http://loinc.org';

/**
 * RF005 AC4-6 (#693, RF005 clinical-data slice 5/5): additively creates
 * real, terminology-coded Encounter/Condition/PhenotypeObservation/
 * MedicationExposure documents (#689-#692) from the same data the intake
 * wizard already collects -- proving AC4-6's structured-coding requirement
 * is satisfied by a real write path, not just schema-complete. Additive,
 * not a replacement: `sampleToPersist.clinicalData`/`pharmacologyData`
 * (the existing embedded subdocument) is untouched, per the issue's own
 * "additive path is very likely the right first move" call -- a future
 * slice may migrate consumers off the embedded copy once these entities
 * have real callers reading them.
 *
 * Every write here is best-effort (caught, logged, never fails the
 * intake response) -- same precedent #505's RcsAssessment recording
 * already established for this handler. A code that fails RF005 AC#4's
 * active-release gate (activeCodeValidator, reused by
 * condition.service.js/phenotype-observation.service.js) skips that one
 * entity rather than blocking the whole submission -- this wizard already
 * allows diagnosis codes with no matching reference-catalog entry today
 * (manual-entry mode), so making that a hard submission failure would be
 * a materially bigger behavioral change than this additive slice intends.
 *
 * Scope note: originally only the 4 entities with real source data in this
 * wizard's payload were wired here. #708/#709/#710/#711/#712/#713 (RF005
 * clinical-UI slices, tracker #707) add AllergyIntolerance/FamilyHistory/
 * Procedure/ClinicalObservation/ClinicalOutcome/DerivedScore, now that the
 * wizard has real fields (or, for DerivedScore, a real scoring algorithm)
 * for each. All 6 sibling slices are now wired.
 */
async function recordClinicalEntities(db, { participantId, clinicalData, pharmacologyData, registeredAt }) {
  const outcome = { recorded: {}, failed: [] };
  const recorded = (entity) => {
    outcome.recorded[entity] = (outcome.recorded[entity] || 0) + 1;
  };
  const failed = (entity, error, reference = null) => {
    outcome.failed.push({ entity, reference, error: error?.message || String(error) });
  };

  let encounterId = null;

  try {
    const encounter = await encounterService.createEncounter(db, {
      participantId,
      encounterType: 'collection',
      encounterPeriod: { start: registeredAt },
    });
    encounterId = encounter.encounterId;
    recorded('Encounter');
  } catch (encounterError) {
    failed('Encounter', encounterError);
    logger.error('Falha ao registrar Encounter para o intake wizard:', encounterError.message || encounterError);
  }

  const conditionCoding = [];
  if (clinicalData?.orphaCode) conditionCoding.push({ systemUri: ORPHA_SYSTEM_URI, code: clinicalData.orphaCode });
  if (clinicalData?.omimCode) conditionCoding.push({ systemUri: OMIM_SYSTEM_URI, code: clinicalData.omimCode });
  if (clinicalData?.cid) conditionCoding.push({ systemUri: ICD10_SYSTEM_URI, code: clinicalData.cid });

  if (conditionCoding.length > 0) {
    try {
      await conditionService.createCondition(db, {
        participantId,
        conditionCoding,
        clinicalStatus: 'active',
        recordedDate: registeredAt,
      });
      recorded('Condition');
    } catch (conditionError) {
      failed('Condition', conditionError);
      logger.error('Falha ao registrar Condition para o intake wizard:', conditionError.message || conditionError);
    }
  }

  const phenotypes = Array.isArray(clinicalData?.phenotypes) ? clinicalData.phenotypes : [];
  for (const phenotype of phenotypes) {
    const hpoId = String(phenotype?.hpoId || '').trim();
    if (!hpoId) continue;
    try {
      await phenotypeObservationService.createPhenotypeObservation(db, {
        participantId,
        hpoCoding: { systemUri: HPO_SYSTEM_URI, code: hpoId, display: String(phenotype?.label || '').trim() || undefined },
        presenceStatus: 'present',
        effectiveDateTime: registeredAt,
        encounterId,
      });
      recorded('PhenotypeObservation');
    } catch (phenotypeError) {
      failed('PhenotypeObservation', phenotypeError, hpoId);
      logger.error(`Falha ao registrar PhenotypeObservation (${hpoId}) para o intake wizard:`, phenotypeError.message || phenotypeError);
    }
  }

  if (pharmacologyData?.medicationName && pharmacologyData?.atcCode) {
    try {
      const medicationStatus = ['TREATED', 'ON_TREATMENT'].includes(pharmacologyData.treatmentStatus)
        ? 'active'
        : pharmacologyData.treatmentStatus === 'WASHOUT'
          ? 'stopped'
          : 'unknown';
      const medicationPeriod = pharmacologyData.washoutStartDate || pharmacologyData.washoutEndDate
        ? { start: pharmacologyData.washoutStartDate || null, end: pharmacologyData.washoutEndDate || null }
        : null;

      await medicationExposureService.createMedicationExposure(db, {
        medicationCoding: [{ systemUri: ATC_SYSTEM_URI, code: pharmacologyData.atcCode, display: pharmacologyData.medicationName }],
        recordType: 'reported',
        medicationStatus,
        medicationPeriod,
      });
      recorded('MedicationExposure');
    } catch (medicationError) {
      failed('MedicationExposure', medicationError, pharmacologyData.atcCode || null);
      logger.error('Falha ao registrar MedicationExposure para o intake wizard:', medicationError.message || medicationError);
    }
  }

  const allergies = Array.isArray(clinicalData?.allergies) ? clinicalData.allergies : [];
  for (const allergy of allergies) {
    const allergenCode = String(allergy?.allergenCode || '').trim();
    if (!allergenCode) continue;
    try {
      const reactionText = String(allergy?.reaction || '').trim();
      await allergyIntoleranceService.createAllergyIntolerance(db, {
        allergenCoding: {
          systemUri: DCB_SYSTEM_URI,
          code: allergenCode,
          display: String(allergy?.allergenName || '').trim() || undefined,
        },
        reaction: reactionText ? [{ manifestation: reactionText }] : [],
      });
      recorded('AllergyIntolerance');
    } catch (allergyError) {
      failed('AllergyIntolerance', allergyError, allergenCode);
      logger.error(`Falha ao registrar AllergyIntolerance (${allergenCode}) para o intake wizard:`, allergyError.message || allergyError);
    }
  }

  const familyHistories = Array.isArray(clinicalData?.familyHistories) ? clinicalData.familyHistories : [];
  for (const entry of familyHistories) {
    const relationship = String(entry?.relationship || '').trim();
    if (!relationship) continue;
    try {
      const conditionName = String(entry?.conditionName || '').trim();
      const orphaFamilyCode = String(entry?.orphaCode || '').trim();
      const onset = String(entry?.onset || '').trim();
      const familyCondition = orphaFamilyCode || conditionName
        ? [{
          condition: orphaFamilyCode
            ? { systemUri: ORPHA_SYSTEM_URI, code: orphaFamilyCode, display: conditionName || undefined }
            : { display: conditionName },
          onset: onset || undefined,
        }]
        : [];

      await familyHistoryService.createFamilyHistory(db, { relationship, familyCondition });
      recorded('FamilyHistory');
    } catch (familyHistoryError) {
      failed('FamilyHistory', familyHistoryError, relationship);
      logger.error(`Falha ao registrar FamilyHistory (${relationship}) para o intake wizard:`, familyHistoryError.message || familyHistoryError);
    }
  }

  const procedures = Array.isArray(clinicalData?.procedures) ? clinicalData.procedures : [];
  for (const entry of procedures) {
    const procedureCode = String(entry?.procedureCode || '').trim();
    const performed = String(entry?.performed || '').trim();
    if (!procedureCode || !performed) continue;
    try {
      const bodySiteText = String(entry?.bodySite || '').trim();
      await procedureService.createProcedure(db, {
        procedureCoding: [{
          systemUri: LOCAL_PROCEDURE_SYSTEM_URI,
          code: procedureCode,
          display: String(entry?.procedureName || '').trim() || undefined,
        }],
        performed,
        bodySite: bodySiteText ? [{ text: bodySiteText }] : [],
      });
      recorded('Procedure');
    } catch (procedureError) {
      failed('Procedure', procedureError, procedureCode);
      logger.error(`Falha ao registrar Procedure (${procedureCode}) para o intake wizard:`, procedureError.message || procedureError);
    }
  }

  const observationRecords = Array.isArray(clinicalData?.observationRecords) ? clinicalData.observationRecords : [];
  for (const entry of observationRecords) {
    const loincCode = String(entry?.loincCode || '').trim();
    const effectiveDate = String(entry?.effectiveDate || '').trim();
    if (!loincCode || !effectiveDate) continue;
    try {
      const value = String(entry?.value || '').trim();
      const unit = String(entry?.unit || '').trim();
      await clinicalObservationService.createClinicalObservation(db, {
        participantId,
        observationCoding: {
          systemUri: LOINC_OBSERVATION_SYSTEM_URI,
          code: loincCode,
          display: String(entry?.testName || '').trim() || undefined,
        },
        value: value || null,
        unit: unit ? { text: unit } : null,
        effectiveDateTime: effectiveDate,
        observationStatus: 'final',
      });
      recorded('ClinicalObservation');
    } catch (observationError) {
      failed('ClinicalObservation', observationError, loincCode);
      logger.error(`Falha ao registrar ClinicalObservation (${loincCode}) para o intake wizard:`, observationError.message || observationError);
    }
  }

  const clinicalOutcomes = Array.isArray(clinicalData?.clinicalOutcomes) ? clinicalData.clinicalOutcomes : [];
  for (const entry of clinicalOutcomes) {
    const outcomeTypeCode = String(entry?.outcomeType || '').trim();
    const outcomeDate = String(entry?.outcomeDate || '').trim();
    if (!outcomeTypeCode || !outcomeDate) continue;
    try {
      await clinicalOutcomeService.createClinicalOutcome(db, {
        outcomeType: { code: outcomeTypeCode },
        outcomeDate,
      });
      recorded('ClinicalOutcome');
    } catch (outcomeError) {
      failed('ClinicalOutcome', outcomeError, outcomeTypeCode);
      logger.error(`Falha ao registrar ClinicalOutcome (${outcomeTypeCode}) para o intake wizard:`, outcomeError.message || outcomeError);
    }
  }

  const { scoreValue, scoreComponents } = computeCharlsonScore(clinicalData?.charlsonComorbidities);
  if (scoreComponents.length > 0) {
    try {
      await derivedScoreService.createDerivedScore(db, {
        scoreType: CCI_SCORE_TYPE,
        scoreValue,
        algorithmVersion: CCI_ALGORITHM_VERSION,
        scoreComponents,
      });
      recorded('DerivedScore');
    } catch (scoreError) {
      failed('DerivedScore', scoreError, CCI_SCORE_TYPE);
      logger.error('Falha ao registrar DerivedScore (CCI) para o intake wizard:', scoreError.message || scoreError);
    }
  }

  return outcome;
}

const { CRITICAL_SENSOR_STATUSES, isEquipmentBlocked } = require('../models/equipmentStatus');
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

  for (const aliases of Object.values(aliasMap)) {
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
    if (Number.isFinite(numericValue)) variants.push(numericValue);
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
  const participantId = normalizeString(participant.participantId);
  if (/^\d{8}$/.test(participantId)) return participantId;
  return buildFallbackPatientID();
}

function buildClinicalData(data = {}) {
  const diagnosis = normalizeObject(data?.diagnosis);
  const clinical = normalizeObject(data?.clinical);
  return {
    orphaCode: normalizeString(diagnosis.orphaCode),
    omimCode: normalizeString(diagnosis.omimCode).replace(/^OMIM:/i, ''),
    cid: normalizeString(diagnosis.icdCode),
    phenotypes: normalizeArray(clinical.diseasePhenotypes),
    charlsonComorbidities: normalizeArray(clinical.charlsonConditions),
    biomarkerValues: normalizeObject(clinical.biomarkersValues),
    allergies: normalizeArray(clinical.allergies),
    familyHistories: normalizeArray(clinical.familyHistories),
    procedures: normalizeArray(clinical.procedures),
    observationRecords: normalizeArray(clinical.observationRecords),
    clinicalOutcomes: normalizeArray(clinical.clinicalOutcomes),
  };
}

function buildPharmacologyData(data = {}) {
  const clinical = normalizeObject(data?.clinical);
  const pharmacology = normalizeObject(clinical.pharmacologyData);
  const treatmentStatusRaw = normalizeString(pharmacology.treatmentStatus).toUpperCase();
  const treatmentStatus = ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'].includes(treatmentStatusRaw) ? treatmentStatusRaw : '';
  const atcCode = normalizeString(pharmacology.atcCode).replace(/^ATC:/i, '').toUpperCase();
  const atcLevel1 = normalizeString(pharmacology.atcClass).toUpperCase() || (atcCode ? atcCode.charAt(0) : '');
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
  return {
    participantId: confirmedPatientID,
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
    sealedRcsAssessmentId: null,
    sealedSpecimenPreanalyticsId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function resolveMatchedPatient(db, data = {}) {
  const participant = normalizeObject(data?.participant);
  return patientIdentityService.matchOrUpsertParticipant(db, {
    participantId: participant.participantId,
    patientName: participant.patientName,
    birthDate: parseBirthDate(participant.birthDate),
    identityDocument: normalizeString(participant.identityDocument) || null,
  });
}

async function resolveConsentDecision(db, patient) {
  const participantId = normalizeString(patient?.participantId);
  if (!participantId) {
    const error = new Error('Paciente sem identificador para validar consentimento ativo.');
    error.statusCode = 400;
    throw error;
  }
  const consent = await consentService.getPatientConsent(db, participantId);
  if (consent?.status === 'ACTIVE') {
    return { active: true, consentId: consent.consentId || consent._id || null, participantId, status: 'SIGNED', quarantineReason: null, governanceReason: null };
  }
  if (consent?.status === 'REVOKED') {
    return { active: false, consentId: consent.consentId || consent._id || null, participantId, status: 'REVOKED', quarantineReason: 'CONSENT_REVOKED', governanceReason: 'Consentimento revogado.' };
  }
  return { active: false, consentId: null, participantId, status: 'PENDING', quarantineReason: 'CONSENT_PENDING', governanceReason: 'Consentimento ainda não ativo/assinado.' };
}

function isOperationalSensor(sensor) {
  const status = normalizeString(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus).toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

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
  if (freezer?.containerID === undefined || freezer?.containerID === null || freezer?.containerID === '') return false;
  const equipmentCollection = db.collection('equipment');
  const equipment = await equipmentCollection.findOne({ equipmentID: { $in: buildIdVariants(freezer.containerID) } });
  if (!equipment) return false;
  const status = normalizeString(equipment.status || equipment.maintenanceStatus || equipment.operationalStatus).toLowerCase();
  return !isEquipmentBlocked(status);
}

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
    return { box, rack, shelf, freezer, previewPosition: findFirstAvailablePosition(box) };
  }
  const error = new Error('Não há localização física disponível com sensor operacional associado para esta amostra.');
  error.statusCode = 422;
  throw error;
}

function buildReadableStoragePlacement(automaticLocation, placement) {
  const box = automaticLocation?.box;
  const freezer = automaticLocation?.freezer;
  return [
    freezer?.containerID ? `equipamento ${freezer.containerID}` : null,
    box?.name || box?.boxID ? `box ${box.name || box.boxID}` : null,
    placement?.positionCode ? `posição ${placement.positionCode}` : null,
  ].filter(Boolean).join(' / ');
}

function buildLabelLinks(sample) {
  const specimenId = normalizeString(sample?.specimenId);
  const encodedValue = normalizeString(sample?.barcode);
  return {
    specimenId,
    symbologyAssetsUrl: encodedValue
      ? `/api/samples/by-barcode/${encodeURIComponent(encodedValue)}/symbology-assets`
      : null,
    printJobUrl: specimenId
      ? `/api/samples/${encodeURIComponent(specimenId)}/label/print-job`
      : null,
  };
}

const resolverQualidadeMetodologica = qualityDomain.resolveMethodologicalQuality;
function calcularQualidade(samplePayloadOrTempo, temperatura) {
  if (typeof samplePayloadOrTempo === 'number') {
    return resolverQualidadeMetodologica({
      matrixType: 'fluid',
      sprec: { matrixType: 'fluid', preCentrifugation: '' },
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
    // Canonical v2 API boundary: malformed core sections are client-contract
    // violations, not runtime failures. Reject them before identity, consent,
    // storage or clinical services are invoked so invalid payloads never fall
    // through as 500 responses.
    const canonicalShapeViolations = [];
    const participantSection = data?.participant;
    const specimenSection = data?.specimen;

    const participantIsObject = Boolean(
      participantSection && typeof participantSection === 'object' && !Array.isArray(participantSection)
    );
    const specimenIsObject = Boolean(
      specimenSection && typeof specimenSection === 'object' && !Array.isArray(specimenSection)
    );

    if (!participantIsObject) canonicalShapeViolations.push('participant');
    if (!specimenIsObject || !normalizeString(specimenSection?.participantId)) {
      canonicalShapeViolations.push('specimen');
    }

    if (canonicalShapeViolations.length > 0) {
      return res.status(422).json({
        error: 'NON_CANONICAL_FIELD',
        fields: [...new Set(canonicalShapeViolations)]
      });
    }

    const canonicalViolations = [
      ...collectCanonicalViolations(data?.participant, { participantId: ['patientID', 'patientId', 'pseudoId', 'mongoPatientId'] }),
      ...collectCanonicalViolations(data?.specimen, {
        specimenId: ['sampleID', 'sampleId', 'specimenID', 'mongoSampleId'],
        parentSpecimenIds: ['parentSpecimenId'],
        registeredAt: ['registerDate', 'registrationDate'],
        withdrawnAt: ['withdrawalDate'],
        receivedAt: ['receivedTime'],
        specimenStatus: ['currentStatus', 'lifecycleStatus'],
        consentTemplateId: ['tcle_id', 'tcle_template_id', 'selected_tcle'],
        merkleRoot: ['merkle_root'],
        legacyCompat: ['legacy_compat'],
      }),
      ...collectCanonicalViolations(data?.consent, { consentTemplateId: ['tcle_id', 'tcle_template_id', 'selected_tcle'] }),
      ...collectCanonicalViolations(data?.clinical, {
        clinicalData: ['clinical_data'],
        pharmacologyData: ['pharmacology_data'],
        biomarkerValues: ['biomarkers_values'],
      }),
    ];

    if (canonicalViolations.length > 0) {
      return res.status(422).json({ error: 'NON_CANONICAL_FIELD', fields: canonicalViolations });
    }

    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível para persistir o intake wizard.' });
    }

    const matchOutcome = await resolveMatchedPatient(db, data);
    const consentDecision = await resolveConsentDecision(db, matchOutcome.patient);
    const automaticLocation = await resolveAutomaticLocation(db);
    const qualidade = resolverQualidadeMetodologica(data?.specimen || {});

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT', resourceType: 'Patient', resourceId: matchOutcome?.patient?.participantId || null,
      status: 'success', severity: 'info',
      message: matchOutcome?.created ? 'Novo paciente criado durante intake wizard.' : 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: { created: Boolean(matchOutcome?.created), matched: !Boolean(matchOutcome?.created), matchType: matchOutcome?.matchType || null, participantId: matchOutcome?.patient?.participantId || null },
      req, module: 'Cadastro'
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
      quarantineReason: isReleased ? null : consentDecision.quarantineReason || (qualityAllowsRelease ? 'GOVERNANCE_BLOCKED' : 'QUALITY_GOVERNANCE_FAILURE'),
    });
    if (qualidade.sprec && Object.keys(qualidade.sprec).length > 0) sampleToPersist.sprec = qualidade.sprec;
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

    const currentStoragePlacement = createdSample.currentStoragePlacement || null;
    const samplesCollection = await getCollection(db, 'samples');
    const allocatedSample = await samplesCollection.findOne({ _id: createdSample._id }) || createdSample;

    try {
      const assessment = await rcsAssessmentService.recordAssessment(db, allocatedSample.specimenId, qualidade);
      await samplesCollection.updateOne({ _id: createdSample._id }, { $set: { sealedRcsAssessmentId: assessment._id } });
      allocatedSample.sealedRcsAssessmentId = assessment._id;
    } catch (assessmentError) {
      logger.error('Falha ao registrar RcsAssessment para a amostra do intake wizard:', assessmentError.message || assessmentError);
    }

    const clinicalEntitiesOutcome = await recordClinicalEntities(db, {
      participantId: allocatedSample.participantId,
      clinicalData: sampleToPersist.clinicalData,
      pharmacologyData: sampleToPersist.pharmacologyData,
      registeredAt: sampleToPersist.registeredAt,
    });

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { _id: matchOutcome.patient._id },
      { $set: { lastClinicalData: sampleToPersist.clinicalData || {}, updatedAt: new Date() }, $addToSet: { linkedSampleIds: String(createdSample._id) } }
    );

    const physicalPlacement = currentStoragePlacement ? {
      ...currentStoragePlacement,
      equipmentID: automaticLocation.freezer?.containerID || null,
      boxName: automaticLocation.box.name || automaticLocation.box.boxID || null,
      readable: buildReadableStoragePlacement(automaticLocation, currentStoragePlacement),
    } : null;

    const responseMessage = isReleased
      ? 'Cadastro integrado concluído com sucesso, amostra validada e localização automática atribuída.'
      : `Cadastro integrado concluído com sucesso, mas a amostra permanece bloqueada: ${consentDecision.governanceReason || 'decisão de governança do backend'}`;

    return res.json({
      success: true,
      message: responseMessage,
      qualidade: qualidade.final_grade ? `Grade ${qualidade.final_grade}` : 'Indeterminada',
      qualityAssessment: qualidade,
      patientMatch: { matched: !matchOutcome.created, created: matchOutcome.created, matchType: matchOutcome.matchType, participantId: matchOutcome.patient?.participantId || null },
      consent: { active: consentDecision.active, status: consentDecision.status, consentId: consentDecision.consentId || null, participantId: consentDecision.participantId || null, reason: consentDecision.governanceReason || null },
      currentStoragePlacement: physicalPlacement,
      label: buildLabelLinks(allocatedSample),
      clinicalEntities: clinicalEntitiesOutcome,
      data,
      sample: { ...allocatedSample, currentStoragePlacement: physicalPlacement },
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({ success: false, error: error?.message || 'Erro desconhecido ao finalizar o Intake Wizard.' });
  }
}

router.get('/patient-match', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });

  const patientName = normalizeString(req.query?.patientName);
  const birthDate = parseBirthDate(req.query?.birthDate);
  const participantIdQuery = normalizeString(req.query?.participantId);
  if (!participantIdQuery && (!patientName || !birthDate)) {
    return res.status(400).json({ success: false, error: 'Informe participantId ou (patientName + birthDate).' });
  }

  try {
    const identityCollection = await getCollection(db, 'participantIdentities');
    const patientNameNormalized = patientName
      ? patientName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')
      : '';
    const rawIdentityById = participantIdQuery ? await identityCollection.findOne({ participantId: participantIdQuery }) : null;
    let identity = rawIdentityById ? participantIdentityService.decryptIdentity(rawIdentityById) : null;

    if (!identity && patientNameNormalized && birthDate) {
      const startOfDay = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      const endOfDay = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate() + 1);
      const birthDateHashes = participantIdentityService.computeBlindIndexCandidates('birthDate', birthDate);
      const dateOrConditions = birthDateHashes.length
        ? [{ birthDateHash: { $in: birthDateHashes } }]
        : [{ birthDate: { $gte: startOfDay, $lt: endOfDay } }];
      const candidates = await identityCollection.find({ $or: dateOrConditions }).toArray();
      identity = candidates.find((rawCandidate) => {
        const candidate = participantIdentityService.decryptIdentity(rawCandidate);
        const candidateNormalized = normalizeString(candidate.patientName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
        return candidateNormalized === patientNameNormalized;
      }) || null;
    }

    let patientStatus = 'ACTIVE';
    if (identity?.participantId) {
      const patientsCollection = await getCollection(db, 'patients');
      const patientRecord = await patientsCollection.findOne({ participantId: identity.participantId }, { projection: { status: 1 } });
      patientStatus = normalizeString(patientRecord?.status) || 'ACTIVE';
    }

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT', resourceType: 'Patient', resourceId: identity?.participantId || participantIdQuery || null,
      status: 'success', severity: 'info',
      message: identity ? 'Heurística de intake encontrou paciente existente para upsert.' : 'Heurística de intake não encontrou paciente correspondente.',
      payload: { endpoint: '/patient-match', matched: Boolean(identity), query: { participantId: participantIdQuery || null, patientName: patientName || null, birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null } },
      req, module: 'Cadastro'
    });

    return res.json({
      success: true,
      matched: Boolean(identity),
      patient: identity ? { participantId: normalizeString(identity.participantId), patientName: normalizeString(identity.patientName), birthDate: identity.birthDate || null, status: patientStatus } : null,
      message: identity ? 'Paciente identificado. Novos dados serão vinculados ao perfil histórico.' : '',
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
