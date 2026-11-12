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
const governanceEvidenceResolver = require('../services/governance-evidence-resolver.service');
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
const { parseBirthDateDay, birthDateDayRange } = require('../utils/birthDate');
const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');
const { resolveCallerCreateOrganization } = require('../services/callerCreateOrganization.service');
const { validate } = require('../contracts/canonical/v1');

// #693 (RF005 clinical-data slice 5/5): systemUri constants matching this
// repo's existing reference-import sources (reference-data/reference-
// imports/sources/*.js) -- reused here so conditionCoding/hpoCoding
// entries resolve against the same TerminologyConcept/ReferenceDatasetRelease
// rows RF028's importers actually populate, not a locally-invented URI.
const ORPHA_SYSTEM_URI = 'http://www.orpha.net';
const OMIM_SYSTEM_URI = 'https://www.omim.org';
// "CID" in this wizard's own field names is the Brazilian Portuguese
// abbreviation for ICD -- dict-01_FONTES.md's own SRC_ICD10/SRC_ICD11 rows
// use the English abbreviation instead (search the dictionary for ICD).
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
  // #782: every write below is best-effort by design (see the doc comment
  // above) and that is not in dispute -- a phenotype that fails to record
  // should not fail an entire specimen intake. What was missing was any
  // signal to the caller. The only trace of a failure was a server-side
  // logger.error line, so the wizard returned an unqualified 200 whether all
  // ten entity types recorded or none did: the operator saw success and moved
  // on, while the clinical annotations for a specimen already in a freezer
  // were quietly absent.
  //
  // This collects per-entity outcomes and returns them. It deliberately
  // changes nothing about what is attempted, what fails, or what persists.
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

  // #712: ELM-0252..0254 ClinicalOutcome -- manual-entry longitudinal-
  // outcome list (progressão/remissão/recidiva/resposta/toxicidade/
  // hospitalização/óbito). Like AllergyIntolerance/FamilyHistory/
  // Procedure above, dict-02's own row set for this entity has no
  // participantId field -- not invented here, matches #691's model.
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

  // #713: ELM-0255..0259 DerivedScore -- real original-1987 Charlson
  // Comorbidity Index, computed from the wizard's already-collected
  // charlsonConditions checklist (charlsonComorbidityIndex.js's own file
  // comment documents which checklist items actually map to a real
  // Charlson category and which don't). Skipped entirely (not created
  // with a zero score) when none of the reported conditions map to a real
  // category -- dict-02 ELM-0259 requires scoreComponents non-empty
  // ("nunca armazenar somente o escore final"), so there is nothing valid
  // to persist in that case.
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
    // #698: the wizard's own OMIM field is always "OMIM:<digits>"
    // (normalizeOmimCode, ClinicalIntakeWizard.jsx), but RF028's real OMIM
    // importer stores bare digits with no prefix -- strip it here so
    // conditionCoding matches the TerminologyConcept activeCodeValidator
    // actually looks up, same as atcCode's "^ATC:/i" strip below.
    omimCode: normalizeString(diagnosis.omimCode).replace(/^OMIM:/i, ''),
    cid: normalizeString(diagnosis.icdCode),
    phenotypes: normalizeArray(clinical.diseasePhenotypes),
    charlsonComorbidities: normalizeArray(clinical.charlsonConditions),
    biomarkerValues: normalizeObject(clinical.biomarkersValues),
    // #708: ELM-0246..0248 AllergyIntolerance -- manual-entry allergen list.
    allergies: normalizeArray(clinical.allergies),
    // #709: ELM-0249..0251 FamilyHistory -- manual-entry family list.
    familyHistories: normalizeArray(clinical.familyHistories),
    // #710: ELM-0242..0245 Procedure -- manual-entry procedure list.
    procedures: normalizeArray(clinical.procedures),
    // #711: ELM-0219..0232 ClinicalObservation -- manual-entry lab-result
    // list. Named observationRecords, not clinicalObservations -- see
    // clinicalDataSchema's own note on the naming collision with the
    // existing free-text clinical-notes field below.
    observationRecords: normalizeArray(clinical.observationRecords),
    // #712: ELM-0252..0254 ClinicalOutcome -- manual-entry longitudinal-
    // outcome list.
    clinicalOutcomes: normalizeArray(clinical.clinicalOutcomes),
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
    // RF004 AC2 (#1497): the collection the wizard picked (ELM-0118);
    // createSample checks a given one as it does for POST /api/samples.
    collectionId: normalizeString(specimen.collectionId) || null,
    specimenStatus,
    linkedProject: normalizeString(specimen.linkedProject) || 'INTAKE_WIZARD',
    parentSpecimenIds: normalizeArray(specimen.parentSpecimenIds).map((parentId) => normalizeString(parentId)).filter(Boolean),
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

async function resolveMatchedPatient(db, data = {}, { organizationId = null, organizationScope = null } = {}) {
  const participant = normalizeObject(data?.participant);

  // #1355: a participant the intake creates carries the intake's
  // organization; a matched one outside the caller's scope is linked but
  // never written (#1356).
  const result = await patientIdentityService.matchOrUpsertParticipant(db, {
    participantId: participant.participantId,
    patientName: participant.patientName,
    birthDate: parseBirthDateDay(participant.birthDate),
    identityDocument: normalizeString(participant.identityDocument) || null,
    clinicalUnitId: organizationId,
  }, { organizationScope });

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
  return !isEquipmentBlocked(status);
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

// #655: label.routes.js (the /api/labels/samples/* family these links used
// to point at) is retired -- SampleLabelPage.tsx now calls sample.routes.js's
// symbology/print-job endpoints directly, and this function's own output was
// never read by any frontend caller either (grepped frontend/src), so this
// is a same-shape correction, not a behavior change any caller depended on.
function buildLabelLinks(sample) {
  const sampleId = normalizeString(sample?._id?.toString?.() || sample?._id || sample?.sampleID || sample?.barcode);
  const barcode = normalizeString(sample?.barcode);
  return {
    sampleId,
    symbologyAssetsUrl: barcode ? `/api/samples/by-barcode/${encodeURIComponent(barcode)}/symbology-assets` : null,
    printJobUrl: `/api/samples/${encodeURIComponent(sampleId)}/label/print-job`,
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

// RF004 AC2 (#1497): the wizard names the specimen's collection (ELM-0118) in
// specimen.collectionId. The shared canonical.v1.specimen schema stays closed
// to it, since the ingestion Specimen target reads that schema and has no
// collection gate (#1538); the intake validates the specimen without it, and
// buildSampleDocumentFromIntake hands it to createSample, which gates it.
function splitIntakeCollectionId(data) {
  const specimen = data?.specimen;
  if (!specimen || typeof specimen !== 'object' || Array.isArray(specimen)
    || !Object.prototype.hasOwnProperty.call(specimen, 'collectionId')) {
    return { contractData: data, collectionIdInvalid: false };
  }
  const { collectionId, ...specimenWithoutCollection } = specimen;
  return {
    contractData: { ...data, specimen: specimenWithoutCollection },
    collectionIdInvalid: typeof collectionId !== 'string',
  };
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
        // dict-02 ELM-0120 is the plural parentSpecimenIds (#1368).
        parentSpecimenIds: ['parentSampleId', 'parentSpecimenId'],
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
      return res.status(422).json({ error: 'NON_CANONICAL_FIELD', fields: canonicalViolations, details: canonicalViolations.map((field) => `${field}: campo não canônico`) });
    }

    const { contractData, collectionIdInvalid } = splitIntakeCollectionId(data);
    const validation = validate('canonical.v1.intake', contractData);
    if (!validation.valid || collectionIdInvalid) {
      const fields = collectionIdInvalid ? ['specimen.collectionId'] : [];
      for (const issue of validation.errors || []) {
        const field = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.') || issue.params?.missingProperty || null;
        if (field) fields.push(field);
      }
      return res.status(422).json({ error: 'NON_CANONICAL_FIELD', fields: [...new Set(fields)], details: [...new Set(fields)].map((field) => `${field}: campo não canônico`) });
    }

    // RNF018 AC1 (#1525): the backend twin of the wizard's quantity check. A
    // quantity at or below zero is refused before the participant match, the
    // audit entry or the sample is written.
    const specimenQuantity = data?.specimen?.quantity;
    if (specimenQuantity !== undefined && !(Number(specimenQuantity) > 0)) {
      const detail = 'specimen.quantity deve ser um número maior que zero';
      return res.status(422).json({ success: false, error: 'INVALID_QUANTITY', fields: ['specimen.quantity'], details: [detail] });
    }

    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível para persistir o intake wizard.',
      });
    }

    // #1355, #1376: the organization the intake stamps, by the rule POST
    // /api/samples uses (#1185): a single-organization caller's own, a
    // multi-organization caller's pick among its own, or a global caller's
    // pick of any existing organization or none. The pick is the top-level
    // organizationId only; specimen.collectionSite (ELM-0128) is data.
    // Resolved before anything is written.
    const requestedOrganizationId = typeof data.organizationId === 'string' && data.organizationId.trim() !== ''
      ? data.organizationId.trim()
      : undefined;
    let organizationId;
    try {
      ({ organizationId } = await resolveCallerCreateOrganization(db, {
        organizationScope: req.organizationScope,
        requested: requestedOrganizationId
      }));
    } catch (scopeError) {
      return res.status(scopeError.statusCode || 403).json({ success: false, error: scopeError.message });
    }

    const matchOutcome = await resolveMatchedPatient(db, data, { organizationId, organizationScope: req.organizationScope });
    const consentDecision = await resolveConsentDecision(db, matchOutcome.patient);
    const automaticLocation = await resolveAutomaticLocation(db);
    // RNF018 AC5 (#1524): the body's governanceEvidence references are
    // resolved against the stored records before certification, as POST
    // /api/samples resolves them; only the resolution reaches the assessment.
    // The specimen does not exist yet, so no specimenId is passed: a
    // custody-event or telemetry reference cannot resolve at intake (fail
    // closed), whatever specimen.specimenId the body names.
    const governanceEvidenceResolution = await governanceEvidenceResolver.resolveGovernanceEvidence(db, {
      governanceEvidence: data.governanceEvidence,
      specimenId: null,
    });
    const qualidade = resolverQualidadeMetodologica(
      data?.specimen || {},
      ...(governanceEvidenceResolution ? [{ governanceEvidenceResolution }] : [])
    );

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      resourceType: 'Patient',
      resourceId: matchOutcome?.patient?.participantId || null,
      status: 'success',
      severity: 'info',
      message: matchOutcome?.created
        ? 'Novo paciente criado durante intake wizard.'
        : matchOutcome?.outOfScope
          ? 'Paciente existente identificado fora do escopo do usuário e vinculado sem atualização durante intake wizard.'
          : 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: {
        created: Boolean(matchOutcome?.created),
        outOfScope: Boolean(matchOutcome?.outOfScope),
        matched: !Boolean(matchOutcome?.created),
        matchType: matchOutcome?.matchType || null,
        patientID: matchOutcome?.patient?.participantId || null,
      },
      req,
      module: 'Cadastro'
    });

    const sampleToPersist = buildSampleDocumentFromIntake(data, matchOutcome.patient);
    // #1192: the collection site the intake names (ELM-0128) is kept; one
    // naming none gets the stamped organization, as before. The tenancy key
    // is the organizationId option createSample stamps below.
    const namedCollectionSite = data?.specimen?.collectionSite;
    if (namedCollectionSite !== undefined && namedCollectionSite !== null && namedCollectionSite !== '') {
      sampleToPersist.collectionSite = String(namedCollectionSite);
    } else if (organizationId) {
      sampleToPersist.collectionSite = String(organizationId);
    }
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
    // RNF018 AC5 (#1524): createSample certifies the sprec again, so it gets
    // the same references to resolve; SampleModel.create does not store them.
    if (data.governanceEvidence !== undefined) {
      sampleToPersist.governanceEvidence = data.governanceEvidence;
    }
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
      organizationId: organizationId ? String(organizationId) : null,
      neo4jDriver: req.app.locals.neo4jDriver || null,
    });

    const allocation = { sampleLocation: createdSample.storageLocation || null };

    const samplesCollection = await getCollection(db, 'samples');
    const allocatedSample = await samplesCollection.findOne({ _id: createdSample._id }) || createdSample;

    // #505: intakeWizard already computes RCS via qualidade above but never
    // recorded a queryable RcsAssessment snapshot — mirrors #492's pattern
    // (sample.service.js#createSample), recorded once the sample has fully
    // landed (create + allocation both already succeeded by this point) so
    // a best-effort failure here never fails the intake itself.
    try {
      const assessment = await rcsAssessmentService.recordAssessment(db, allocatedSample.specimenId, qualidade);
      await samplesCollection.updateOne(
        { _id: createdSample._id },
        { $set: { sealedRcsAssessmentId: assessment._id } }
      );
      allocatedSample.sealedRcsAssessmentId = assessment._id;
    } catch (assessmentError) {
      logger.error('Falha ao registrar RcsAssessment para a amostra do intake wizard:', assessmentError.message || assessmentError);
    }

    // #693 (RF005 AC4-6): additive real-entity recording, best-effort --
    // see recordClinicalEntities' own doc comment for scope/rationale.
    // #782: outcomes are now returned and surfaced in the response below.
    const clinicalEntitiesOutcome = await recordClinicalEntities(db, {
      participantId: allocatedSample.participantId,
      clinicalData: sampleToPersist.clinicalData,
      pharmacologyData: sampleToPersist.pharmacologyData,
      registeredAt: sampleToPersist.registeredAt,
    });

    // #1356: a match outside the caller's scope is linked, never written.
    if (!matchOutcome?.outOfScope) {
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
    }

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
      // #511: canonical StorageAssignment additively exposed alongside the
      // legacy storageLocation shape above, same precedent #507/#510 set —
      // sample.service.js#createSample (#510) already resolves it via
      // MongoStorageRepository.findCurrentStorageAssignment().
      storageAssignment: createdSample.storageAssignment || null,
      label: buildLabelLinks(allocatedSample),
      // #782: the intake stays a 200 whatever happened to the clinical
      // entities -- that best-effort design is deliberate. What changes is
      // that the caller is now told, so a UI can say "specimen saved, 1
      // phenotype not recorded" instead of an unqualified success. `failed`
      // is empty on a clean intake, so the common case reads the same.
      clinicalEntities: clinicalEntitiesOutcome,
      data,
      sample: allocatedSample,
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({
      success: false,
      error: error?.message || 'Erro desconhecido ao finalizar o Intake Wizard.',
      details: error?.details,
    });
  }
}

router.get('/patient-match', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) {
    return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
  }

  const patientName = normalizeString(req.query?.patientName || req.query?.name);
  const birthDate = parseBirthDateDay(req.query?.birthDate);
  const participantIdQuery = normalizeString(req.query?.patientID || req.query?.patientId);

  if (!participantIdQuery && (!patientName || !birthDate)) {
    return res.status(400).json({ success: false, error: 'Informe patientID ou (patientName + birthDate).' });
  }

  try {
    // RF005/RNF007 (#562): resolve the match via ParticipantIdentity, not
    // Patient's own (never actually populated by the main intake path)
    // patientNameNormalized/birthDateKey fields, same pattern #561 applied
    // to PatientIdentityService.js's import-time matching.
    const identityCollection = await getCollection(db, 'participantIdentities');
    const patientNameNormalized = patientName
      ? patientName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
      : '';

    // #1104: decrypt here too. The name+birthDate branch below already
    // decrypts its candidates, but this participantId branch did not -- so a
    // ciphertext-only row came back with a null patientName/birthDate while a
    // grep for decryptIdentity made this file look fully repointed.
    const rawIdentityById = participantIdQuery
      ? await identityCollection.findOne({ participantId: participantIdQuery })
      : null;
    let identity = rawIdentityById ? participantIdentityService.decryptIdentity(rawIdentityById) : null;

    if (!identity && patientNameNormalized && birthDate) {
      const { start: startOfDay, end: endOfDay } = birthDateDayRange(birthDate);
      // RF005/RNF007 (#574, done for this field in #1104): birthDate is
      // ciphertext-only, so this narrows by day of birth on the blind index
      // alone. The plaintext range condition below is NOT a fallback for old
      // records -- it is the keyless-stack branch (#1083), reached only when
      // no ENCRYPTION_KEY is configured and the plaintext is therefore the
      // only thing that was written.
      // #1099: match under EVERY registered key, so a hash written before
      // an ENCRYPTION_KEY rotation stays matchable.
      const birthDateHashes = participantIdentityService.computeBlindIndexCandidates('birthDate', birthDate);
      const dateOrConditions = birthDateHashes.length
        ? [{ birthDateHash: { $in: birthDateHashes } }]
        : [{ birthDate: { $gte: startOfDay, $lt: endOfDay } }];
      const candidates = await identityCollection.find({ $or: dateOrConditions }).toArray();
      identity = candidates.find((rawCandidate) => {
        // patientName is civil identity and ciphertext-only (#1104), so
        // decrypt before comparing.
        const candidate = participantIdentityService.decryptIdentity(rawCandidate);
        const candidateNormalized = normalizeString(candidate.patientName)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+/g, ' ');
        return candidateNormalized === patientNameNormalized;
      }) || null;
    }

    let patientStatus = 'ACTIVE';
    let patientRecord = null;
    if (identity?.participantId) {
      const patientsCollection = await getCollection(db, 'patients');
      patientRecord = await patientsCollection.findOne(
        { participantId: identity.participantId },
        { projection: { status: 1, clinicalUnitId: 1 } }
      );
      patientStatus = normalizeString(patientRecord?.status) || 'ACTIVE';
    }

    // #1377: a match outside the caller's organizations answers as a
    // non-match, by the rule matchOrUpsertParticipant applies (#1356), so the
    // lookup leaks neither its civil fields nor its existence. A missing
    // Patient record is out of scope for everyone but global scope.
    const outOfScope = Boolean(identity)
      && !isRecordInOrganizationScope(patientRecord, req.organizationScope, 'clinicalUnitId');
    const matched = Boolean(identity) && !outOfScope;

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      resourceType: 'Patient',
      resourceId: identity?.participantId || participantIdQuery || null,
      status: 'success',
      severity: 'info',
      message: matched
        ? 'Heurística de intake encontrou paciente existente para upsert.'
        : 'Heurística de intake não encontrou paciente correspondente.',
      payload: {
        endpoint: '/patient-match',
        matched,
        ...(outOfScope ? { outOfScope: true } : {}),
        query: {
          patientID: participantIdQuery || null,
          patientName: patientName || null,
          birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        },
      },
      req,
      module: 'Cadastro'
    });

    return res.json({
      success: true,
      matched,
      patient: matched
        ? {
          patientID: normalizeString(identity.participantId),
          patientName: normalizeString(identity.patientName),
          birthDate: identity.birthDate || null,
          status: patientStatus,
        }
        : null,
      message: matched
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
  parseBirthDate: parseBirthDateDay,
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
