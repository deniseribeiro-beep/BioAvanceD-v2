const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const ReportsModel = require('../../models/Reports');
const { SampleModel } = require('../../models/Sample');
const logger = require('../../utils/logger');
const specimenPreanalyticsService = require('../../services/specimen-preanalytics.service');
const rcsAssessmentService = require('../../services/rcs-assessment.service');
const { resolveUserOrganizationScope, isOrganizationScopeUsable, applyOrganizationScopeFilter, isRecordInOrganizationScope } = require('../../services/rbac-assignment.service');

function normalizeReport(report) {
  return {
    ...report,
    reportID: Number(report.reportID || 0),
    generatedAt: report.generatedAt || report.createdAt || new Date(),
  };
}

function resolveCollection(db, candidates = []) {
  for (const name of candidates) {
    try {
      const collection = db.collection(name);
      if (collection) return collection;
    } catch (_) {}
  }
  return db.collection(candidates[0]);
}

async function nextReportId(reportsCollection) {
  const last = await reportsCollection
    .find({ reportID: { $exists: true } })
    .sort({ reportID: -1 })
    .limit(1)
    .toArray();

  const max = Number(last?.[0]?.reportID || 0);
  return max + 1;
}

// #726 (RF008 AC#6): converts an incoming `:type`/`reportType` value into a
// ReportTemplate `code` lookup key -- e.g. 'samplesByPatient' (the live
// frontend's REPORT_TYPE_DEFINITIONS `key`, report.constants.js) becomes
// 'samples_by_patient', matching report-template-seed.service.js's system
// rows. Replaces the old typeIncludes/normalizeTypeValue free-form
// Portuguese/English substring matching -- buildPreviewData now dispatches
// by exact `code` lookup, not fuzzy string matching, per #726's design call.
function toTemplateCode(rawType = '') {
  return decodeURIComponent(String(rawType || ''))
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildDateQuery(filters = {}) {
  if (!filters.startDate && !filters.endDate) {
    return null;
  }

  const range = {};
  if (filters.startDate) {
    range.$gte = new Date(filters.startDate);
  }

  if (filters.endDate) {
    const endDate = new Date(filters.endDate);
    endDate.setHours(23, 59, 59, 999);
    range.$lte = endDate;
  }

  return range;
}

function normalizeFilterText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toRegex(value) {
  return new RegExp(escapeRegex(value), 'i');
}

function isTruthyFilter(value) {
  return ['true', '1', 'yes', 'sim'].includes(String(value || '').trim().toLowerCase());
}

// #531/#532: AVAILABLE/QUARANTINE/BLOCKED is the filter's own public
// vocabulary (frontend-facing); it maps onto specimenStatus's canonical
// lowercase values below, the same AVAILABLE/QUARANTINE/BLOCKED->
// available/quarantined/unavailable collapse canonical-data-contract-v1.md
// already used for the old availabilityStatus field.
function normalizeReleaseStatus(value) {
  const normalized = normalizeFilterText(value).toUpperCase().replace(/\s+/g, '_');
  if (!normalized) return '';
  if (['ATIVA', 'AVAILABLE', 'DISPONIVEL', 'DISPONÍVEL'].includes(normalized)) return 'AVAILABLE';
  if (['QUARENTINE', 'QUARANTINE', 'EM_QUARENTENA', 'QUARENTENA'].includes(normalized)) return 'QUARANTINE';
  if (['ESGOTADA', 'DEPLETED', 'BLOCKED', 'BLOQUEADA'].includes(normalized)) return 'BLOCKED';
  return normalized;
}

function normalizeTreatmentStatus(value) {
  const normalized = normalizeFilterText(value).toUpperCase().replace(/\s+/g, '_');
  if (!normalized) return '';
  if (['NAIVE', 'INICIAL'].includes(normalized)) return 'NAIVE';
  if (['ON_TREATMENT', 'EM_TRATAMENTO', 'EMTRATAMENTO', 'TREATED'].includes(normalized)) return 'ON_TREATMENT';
  if (['WASHOUT', 'LAVAGEM'].includes(normalized)) return 'WASHOUT';
  return normalized;
}

// #531: maps the filter's public AVAILABLE/QUARANTINE/BLOCKED vocabulary
// onto specimenStatus's canonical lowercase values (dict-02 ELM-0123 +
// the documented `disposed` extension, see Sample.js). BLOCKED collapses
// into `unavailable` — the same coarsening canonical-data-contract-v1.md
// already applied when it retired the old `availabilityStatus` field. An
// unrecognized raw value case-folds through as-is (matches no real
// specimenStatus, same "filters to zero results" behavior the old
// release_status passthrough had).
function releaseStatusToSpecimenStatus(releaseStatus) {
  if (releaseStatus === 'AVAILABLE') return 'available';
  if (releaseStatus === 'QUARANTINE') return 'quarantined';
  if (releaseStatus === 'BLOCKED') return 'unavailable';
  return releaseStatus.toLowerCase();
}

function normalizeSprecCode(value) {
  return normalizeFilterText(value).toUpperCase();
}

/**
 * #525: the sprec.* fields and final_grade used to be queried directly off
 * Sample's embedded copy of those fields. Now resolves through the canonical
 * SpecimenPreanalytics (#388) / RcsAssessment (#383) entities instead —
 * finding which specimens' *current* snapshot matches, then restricting the
 * sample query to `{ specimenId: { $in: [...] } }`. See
 * specimen-preanalytics.service.js#findSpecimenIdsWithCurrentProfileMatching
 * for what "current" means here.
 *
 * #531: the release/quarantine filter now queries the canonical
 * `specimenStatus` (dict-02 ELM-0123) instead of the legacy embedded
 * `release_status` — which was never `releaseStatus`-cased SampleModel
 * writes, and was never folded into the #389/#398/#399/#405/#406/#408
 * specimenStatus/QuarantineAction consolidation despite representing the
 * same physical/consent quarantine state. See
 * docs/architecture/canonical-data-contract-v1.md's #531 entry.
 * `SampleGraphValidator.js`'s own compliance-graph `release_status` write —
 * a separate, ethics/quality/clinical/pharmacology/integrity check, not
 * this physical/consent state — is folded into specimenStatus too as of
 * #532; see the doc's #532 entry for that write's own merge rule.
 */
async function buildSampleQuery(db, filters = {}) {
  const conditions = [];

  const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
  if (orphaCode) {
    const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
    conditions.push({
      $or: [
        { 'clinicalData.orphaCode': cleanedOrpha },
        { 'clinicalData.orphaCode': toRegex(cleanedOrpha) },
        { orphaCode: toRegex(cleanedOrpha) },
      ],
    });
  }

  const drugQuery = normalizeFilterText(filters.atcCode || filters.genericName || filters.drug);
  if (drugQuery) {
    const cleanedDrug = drugQuery.replace(/^ATC:/i, '');
    const drugRegex = toRegex(cleanedDrug);
    conditions.push({
      $or: [
        { 'pharmacologyData.atcCode': drugRegex },
        { 'pharmacologyData.medicationName': drugRegex },
        { 'pharmacologyData.atcClass': drugRegex },
      ],
    });
  }

  const treatmentStatus = normalizeTreatmentStatus(filters.treatmentStatus);
  if (treatmentStatus) {
    conditions.push({ 'pharmacologyData.treatmentStatus': treatmentStatus });
  }

  const sprecMatrix = normalizeFilterText(filters.sprecMatrixType || filters.sprecMatrix || filters.matrixType).toLowerCase();
  const sprecSampleType = normalizeSprecCode(filters.sprecSampleType);
  const sprecPrimaryContainer = normalizeSprecCode(filters.sprecPrimaryContainer);
  const sprecPreCentrifugation = normalizeSprecCode(filters.sprecPreCentrifugation);
  const sprecCentrifugation = normalizeSprecCode(filters.sprecCentrifugation);
  const sprecSecondCentrifugation = normalizeSprecCode(filters.sprecSecondCentrifugation);
  const sprecPostCentrifugationDelay = normalizeSprecCode(filters.sprecPostCentrifugationDelay);
  const sprecLongTermStorage = normalizeSprecCode(filters.sprecLongTermStorage);

  const specimenPreanalyticsMatch = {
    ...(sprecMatrix ? { matrixType: sprecMatrix } : {}),
    ...(sprecSampleType ? { sampleType: sprecSampleType } : {}),
    ...(sprecPrimaryContainer ? { primaryContainer: sprecPrimaryContainer } : {}),
    ...(sprecPreCentrifugation ? { preCentrifugation: sprecPreCentrifugation } : {}),
    ...(sprecCentrifugation ? { centrifugation: sprecCentrifugation } : {}),
    ...(sprecSecondCentrifugation ? { secondCentrifugation: sprecSecondCentrifugation } : {}),
    ...(sprecPostCentrifugationDelay ? { postCentrifugationDelay: sprecPostCentrifugationDelay } : {}),
    ...(sprecLongTermStorage ? { longTermStorage: sprecLongTermStorage } : {}),
  };

  if (Object.keys(specimenPreanalyticsMatch).length > 0) {
    const matchingSpecimenIds = await specimenPreanalyticsService.findSpecimenIdsWithCurrentProfileMatching(db, specimenPreanalyticsMatch);
    conditions.push({ specimenId: { $in: matchingSpecimenIds || [] } });
  }

  const qualityCategory = normalizeFilterText(filters.sprecCategory || filters.qualityCategory).toUpperCase();
  if (qualityCategory) {
    const matchingSpecimenIds = await rcsAssessmentService.findSpecimenIdsWithCurrentAssessmentMatching(db, { finalGrade: qualityCategory });
    conditions.push({ specimenId: { $in: matchingSpecimenIds || [] } });
  }

  const releaseStatus = normalizeReleaseStatus(filters.status || filters.releaseStatus || filters.graphStatus);
  if (releaseStatus) {
    conditions.push({ specimenStatus: releaseStatusToSpecimenStatus(releaseStatus) });
  }

  // #341 (RF003 AC#3): org-scoped caller's sample-rooted report queries
  // only see samples whose collectionSite is one of their scoped
  // organizations, same field/pattern #340 wired into listSamples.
  if (filters.organizationScope && filters.organizationScope.scope === 'organization') {
    conditions.push({ collectionSite: { $in: filters.organizationScope.organizationIds } });
  }

  return conditions.length > 0 ? { $and: conditions } : {};
}

async function getMatchingPatientIds(samplesCollection, sampleQuery) {
  if (!sampleQuery || Object.keys(sampleQuery).length === 0) {
    return [];
  }

  const patientIds = await samplesCollection.distinct('participantId', sampleQuery);
  return Array.isArray(patientIds)
    ? patientIds.map((patientID) => String(patientID || '').trim()).filter(Boolean)
    : [];
}

// #341 (RF003 AC#3): only report types rooted in the samples/patients
// collections (plus, per #621, Result — scoped via a join through its
// linked Sample's collectionSite; per #634/#635/#636, Sensor/Equipment/
// Temperature — scoped directly by their own organizationId) carry an
// organization reference to scope by — confirmed with Dennis 2026-08-18.
// access-log/withdrawal-history report types, and saved Report documents
// themselves, have no organization concept anywhere yet and are
// deliberately left unscoped (see the follow-up filed alongside this
// issue, #621, and its #629/#634-#637 split). Keyed by `handlerKey` now
// (#726), not by string-matching `type` — same membership as before.
const SCOPED_HANDLER_KEYS = new Set([
  'samplesByPatient',
  'patient',
  'sample',
  'sampleAnalysis',
  'temperature',
  'sensor',
  'equipment',
  'result',
  'tissueOriginHistory',
  'extracellularNetwork',
]);

function unknownTypeResult(rawType) {
  return {
    total: 0,
    message: 'Tipo de relatório disponível, mas sem pré-visualização específica para este formato.',
    type: decodeURIComponent(rawType || '').toLowerCase(),
  };
}

// #726 (RF008 AC#6): buildPreviewData now dispatches by looking up a
// ReportTemplate via `code` (toTemplateCode's normalization of the
// incoming `:type`/`reportType`) instead of the old typeIncludes/
// normalizeTypeValue free-form string-matching chain -- one code path, per
// the design call. A `code` with no matching *active* ReportTemplate row
// (unknown type, or a retired one) falls back to the same
// no-preview-available shape the old chain returned for an unrecognized
// type, rather than a hard error.
async function buildPreviewData(db, rawType, filters = {}) {
  // #341: local copy — this function may attach organizationScope below;
  // the /generate route persists its own `filters` object verbatim onto
  // the stored Report document afterward, so mutating the caller's object
  // in place would leak resolved org IDs into that stored snapshot.
  filters = { ...filters };
  const code = toTemplateCode(rawType);
  const template = code
    ? await db.collection('reportTemplates').findOne({ code, templateStatus: 'active' })
    : null;

  if (!template) {
    return unknownTypeResult(rawType);
  }

  const handlerKey = template.handlerKey;
  const handlerOptions = template.handlerOptions && typeof template.handlerOptions === 'object' ? template.handlerOptions : {};
  const handler = REPORT_HANDLERS[handlerKey];
  if (!handler) {
    return unknownTypeResult(rawType);
  }

  if (SCOPED_HANDLER_KEYS.has(handlerKey)) {
    const organizationScope = await resolveUserOrganizationScope(db, filters.userAccountId);
    if (!isOrganizationScopeUsable(organizationScope)) {
      const scopeError = new Error('Sem organização atribuída');
      scopeError.statusCode = 403;
      throw scopeError;
    }
    filters.organizationScope = organizationScope;
  }

  return handler(db, filters, handlerOptions);
}

async function handleSamplesByPatient(db, filters) {
  const patientsCollection = resolveCollection(db, ['patients', 'pacientes']);
  const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
  const sampleQuery = await buildSampleQuery(db, filters);
  const matchingPatientIds = await getMatchingPatientIds(samplesCollection, sampleQuery);

  const patientQueryParts = [];
  // RF005/RNF007 (#574): keyword search no longer resolves against
  // ParticipantIdentity.patientName (civil identity) -- RF008's own
  // filter list doesn't include name search, RNF002 AC#2 forbids the
  // full-collection decrypt-and-scan a substring search over encrypted
  // patientName would require, and RNF007 AC#4 requires reports to
  // omit/pseudonymize direct identifiers by default. The keyword filter
  // still matches the pseudonymized participantId itself, which isn't
  // civil identity.
  if (filters.keyword) {
    patientQueryParts.push({ participantId: { $regex: String(filters.keyword), $options: 'i' } });
  }

  const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
  if (orphaCode) {
    const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
    patientQueryParts.push({
      $or: [
        { orphaCode: cleanedOrpha },
        { orphaCode: toRegex(cleanedOrpha) },
        { 'icdReference.ORPHA': toRegex(cleanedOrpha) },
        { diagnosticHypothesis: toRegex(cleanedOrpha) },
      ],
    });
  }

  if (matchingPatientIds.length > 0) {
    patientQueryParts.push({ participantId: { $in: matchingPatientIds } });
  }

  // #341: patientQueryParts is otherwise empty when no keyword/orphaCode
  // filter is given and no sample matched — filtering only through
  // matchingPatientIds (itself derived from the now-scoped sampleQuery)
  // isn't enough on its own, since an empty matchingPatientIds leaves
  // patientQuery unfiltered ({}), which would leak every organization's
  // patients. Filter the patients collection directly too.
  if (filters.organizationScope && filters.organizationScope.scope === 'organization') {
    patientQueryParts.push({ clinicalUnitId: { $in: filters.organizationScope.organizationIds } });
  }

  const patientQuery = patientQueryParts.length > 0 ? { $and: patientQueryParts } : {};
  const patients = await patientsCollection.find(patientQuery).limit(20).toArray();
  const patientIds = patients.map((patient) => patient.participantId).filter(Boolean);
  const sampleFilter = { ...(Object.keys(sampleQuery).length > 0 ? sampleQuery : {}) };
  const samples = patientIds.length
    ? await samplesCollection.find({
        $and: [
          { participantId: { $in: patientIds } },
          ...(Object.keys(sampleFilter).length > 0 ? [sampleFilter] : []),
        ],
      }).toArray()
    : [];

  const groupedSamples = samples.reduce((acc, sample) => {
    const key = String(sample.participantId || '');
    if (!key) {
      return acc;
    }
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(sample);
    return acc;
  }, {});

  const enrichedPatients = patients.map((patient) => {
    const key = String(patient.participantId || '');
    const patientSamples = groupedSamples[key] || [];
    const limitedSamples = patientSamples.slice(0, 10);
    return {
      ...patient,
      sampleCount: patientSamples.length,
      samples: limitedSamples,
      samplesLimited: patientSamples.length > limitedSamples.length,
    };
  });

  return {
    total: enrichedPatients.length,
    patients: enrichedPatients,
    previewLimited: enrichedPatients.length >= 20,
  };
}

async function handlePatient(db, filters) {
  const collection = resolveCollection(db, ['patients', 'pacientes']);
  const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
  const sampleQuery = await buildSampleQuery(db, filters);
  const matchingPatientIds = await getMatchingPatientIds(samplesCollection, sampleQuery);

  const patientQueryParts = [];
  // RF005/RNF007 (#574): keyword search no longer resolves against
  // ParticipantIdentity.patientName (civil identity) -- see
  // handleSamplesByPatient's identical comment for the full rationale. The
  // keyword filter still matches the pseudonymized participantId itself.
  if (filters.keyword) {
    patientQueryParts.push({ participantId: { $regex: String(filters.keyword), $options: 'i' } });
  }

  const orphaCode = normalizeFilterText(filters.orphaCode || filters.orpha || filters.disease);
  if (orphaCode) {
    const cleanedOrpha = orphaCode.replace(/^ORPHA:/i, '');
    patientQueryParts.push({
      $or: [
        { orphaCode: cleanedOrpha },
        { orphaCode: toRegex(cleanedOrpha) },
        { 'icdReference.ORPHA': toRegex(cleanedOrpha) },
        { diagnosticHypothesis: toRegex(cleanedOrpha) },
      ],
    });
  }

  if (matchingPatientIds.length > 0) {
    patientQueryParts.push({ participantId: { $in: matchingPatientIds } });
  }

  // #341: same direct-filter necessity as handleSamplesByPatient above —
  // matchingPatientIds alone doesn't guarantee patientQuery stays
  // restricted when it's empty.
  if (filters.organizationScope && filters.organizationScope.scope === 'organization') {
    patientQueryParts.push({ clinicalUnitId: { $in: filters.organizationScope.organizationIds } });
  }

  const query = patientQueryParts.length > 0 ? { $and: patientQueryParts } : {};
  const patients = await collection.find(query).limit(50).toArray();
  const total = await collection.countDocuments(query);
  return { total, patients, previewLimited: total > 50 };
}

async function handleSampleAnalysis(db, filters) {
  const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
  const resultsCollection = resolveCollection(db, ['results']);
  const sampleAnalysisQuery =
    filters.organizationScope && filters.organizationScope.scope === 'organization'
      ? { collectionSite: { $in: filters.organizationScope.organizationIds } }
      : {};
  const samples = await samplesCollection.find(sampleAnalysisQuery).limit(100).toArray();

  // #633: `sample.sampleID` doesn't exist on the canonical Sample
  // model (only `specimenId` does) -- this join reads specimenId, the
  // same field Result.specimenId references (Result.js, #628).
  const sampleIds = samples.map((sample) => sample.specimenId).filter((specimenId) => specimenId !== undefined && specimenId !== null);
  const results = sampleIds.length
    ? await resultsCollection.find({ specimenId: { $in: sampleIds } }).toArray()
    : [];

  const groupedResults = results.reduce((acc, result) => {
    const key = String(result.specimenId || '');
    if (!key) {
      return acc;
    }
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(result);
    return acc;
  }, {});

  const analysis = samples.map((sample) => {
    const key = String(sample.specimenId || '');
    const sampleResults = groupedResults[key] || [];
    return {
      sampleID: sample.specimenId || sample._id,
      barcode: sample.barcode || null,
      sampleType: sample.sampleType || null,
      patientID: sample.participantId || null,
      // #539: derives from the canonical specimenStatus (dict-02
      // ELM-0123) instead of the legacy currentStatus/status fields
      // canonical-data-contract-v1.md bans.
      status: SampleModel.resolveSpecimenStatus(sample),
      resultCount: sampleResults.length,
      hasResults: sampleResults.length > 0,
    };
  });

  const withResults = analysis.filter((item) => item.hasResults).length;
  const withoutResults = analysis.length - withResults;
  return {
    total: analysis.length,
    analysis,
    withResults,
    withoutResults,
    previewLimited: analysis.length >= 100,
  };
}

async function handleSample(db, filters) {
  const collection = resolveCollection(db, ['samples', 'amostras']);
  const sampleQuery = await buildSampleQuery(db, filters);
  const samples = await collection.find(sampleQuery).limit(100).toArray();
  const total = await collection.countDocuments(sampleQuery);
  return { total, samples, previewLimited: total > 100 };
}

async function handleTemperature(db, filters, handlerOptions = {}) {
  const collection = resolveCollection(db, ['temperature', 'temperatures']);
  const dateRange = buildDateQuery(filters);
  const queryParts = [];
  if (dateRange) {
    queryParts.push({ $or: [{ timestamp: dateRange }, { dateTime: dateRange }] });
  }

  if (isTruthyFilter(filters.criticalAlertsOnly)) {
    queryParts.push({
      $or: [
        { readingStatus: { $regex: 'critical|alert', $options: 'i' } },
        { severity: { $regex: 'critical|alert', $options: 'i' } },
        { alertType: { $regex: 'critical', $options: 'i' } },
        { sensorStatus: { $regex: 'faulty|maintenance', $options: 'i' } },
      ],
    });
  }

  // #636 (F3-G09): org-scoped caller sees only readings whose
  // organizationId is one of their scoped organizations.
  if (filters.organizationScope && filters.organizationScope.scope === 'organization') {
    queryParts.push({ organizationId: { $in: filters.organizationScope.organizationIds } });
  }

  const query = queryParts.length > 0 ? { $and: queryParts } : {};
  const temperatures = await collection.find(query).sort({ timestamp: -1, dateTime: -1 }).limit(100).toArray();
  const total = await collection.countDocuments(query);

  const values = temperatures
    .map((entry) => Number(entry.temperatureValue))
    .filter((value) => Number.isFinite(value));

  const statistics = values.length
    ? {
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        alerts: temperatures.filter((entry) =>
          String(entry.readingStatus || '').toLowerCase().includes('alert') ||
          String(entry.readingStatus || '').toLowerCase().includes('critical')
        ).length,
      }
    : undefined;

  return {
    total,
    temperatures,
    statistics,
    // #726: mode now comes from the matched ReportTemplate's own
    // handlerOptions (report-template-seed.service.js seeds distinct
    // 'temperature'/'temperature_control' rows against this one handler)
    // instead of re-matching the incoming type string.
    mode: handlerOptions.mode === 'control' ? 'control' : 'report',
    previewLimited: total > 100,
  };
}

async function handleSensor(db, filters) {
  const collection = resolveCollection(db, ['sensors']);
  const query =
    filters.organizationScope && filters.organizationScope.scope === 'organization'
      ? { organizationId: { $in: filters.organizationScope.organizationIds } }
      : {};
  const sensors = await collection.find(query).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, sensors, previewLimited: total > 100 };
}

async function handleEquipment(db, filters) {
  const collection = resolveCollection(db, ['equipment']);
  const query =
    filters.organizationScope && filters.organizationScope.scope === 'organization'
      ? { organizationId: { $in: filters.organizationScope.organizationIds } }
      : {};
  const equipment = await collection.find(query).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, equipment, previewLimited: total > 100 };
}

async function handleResult(db, filters) {
  const collection = resolveCollection(db, ['results']);
  let query = {};
  if (filters.organizationScope && filters.organizationScope.scope === 'organization') {
    // #621: Result has no organization reference of its own — derive
    // scope via a join through its linked Sample's collectionSite.
    // #628: Result.specimenId is now the sole canonical shape (every
    // write path writes it, and the #628 migration backfilled existing
    // documents) — a single-shape match, not the dual _id/specimenId
    // check #621 originally needed while the field was still stale.
    const samplesCollection = resolveCollection(db, ['samples', 'amostras']);
    const scopedSamples = await samplesCollection
      .find({ collectionSite: { $in: filters.organizationScope.organizationIds } })
      .toArray();
    const scopedSpecimenIds = scopedSamples
      .map((sample) => sample.specimenId)
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value));
    query = { specimenId: { $in: scopedSpecimenIds } };
  }
  const results = await collection.find(query).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, results, previewLimited: total > 100 };
}

async function handleWithdrawalHistory(db, filters) {
  // #620: 'withdrawals'/'withdrawalHistory' is never written by any write
  // path — the real withdrawal record lives in the sample movement
  // ledger (sample.service.js#withdrawSample writes type: 'withdraw'),
  // the same source GET /:id/movements already surfaces per-sample.
  const collection = resolveCollection(db, ['sample_movements', 'sampleMovements']);
  const dateRange = buildDateQuery(filters);
  const query = dateRange
    ? { type: 'withdraw', createdAt: dateRange }
    : { type: 'withdraw' };

  const withdrawals = await collection.find(query).sort({ createdAt: -1 }).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, withdrawals, previewLimited: total > 100 };
}

async function handleTissueOriginHistory(db, filters) {
  const collection = resolveCollection(db, ['samples', 'amostras']);
  const baseQuery = {
    $or: [{ sampleOrigin: { $exists: true, $ne: null } }, { linkedProject: { $exists: true, $ne: null } }],
  };
  const query =
    filters.organizationScope && filters.organizationScope.scope === 'organization'
      ? { $and: [baseQuery, { collectionSite: { $in: filters.organizationScope.organizationIds } }] }
      : baseQuery;

  const samples = await collection.find(query).sort({ registrationDate: -1, createdAt: -1 }).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, samples, previewLimited: total > 100 };
}

async function handleExtracellularNetwork(db, filters) {
  const collection = resolveCollection(db, ['samples', 'amostras']);
  const baseQuery = {
    $or: [
      { linkedProject: { $regex: 'extracel', $options: 'i' } },
      { sampleOrigin: { $regex: 'extracel', $options: 'i' } },
    ],
  };
  const query =
    filters.organizationScope && filters.organizationScope.scope === 'organization'
      ? { $and: [baseQuery, { collectionSite: { $in: filters.organizationScope.organizationIds } }] }
      : baseQuery;

  const samples = await collection.find(query).sort({ registrationDate: -1, createdAt: -1 }).limit(100).toArray();
  const total = await collection.countDocuments(query);
  return { total, samples, previewLimited: total > 100 };
}

async function handleAccessLogs(db, filters) {
  const collection = resolveCollection(db, ['logs']);
  const query = {};

  const dateQuery = buildDateQuery(filters);
  if (dateQuery) {
    query.$or = [{ dateTime: dateQuery }, { timestamp: dateQuery }];
  }

  const logs = await collection.find(query).sort({ dateTime: -1, timestamp: -1 }).limit(200).toArray();
  const total = await collection.countDocuments(query);
  return { total, logs, previewLimited: total > 200 };
}

// #726: one entry per ReportTemplate.HANDLER_KEYS value -- buildPreviewData
// dispatches here by the matched template's `handlerKey`, not by
// re-matching the incoming type string.
const REPORT_HANDLERS = {
  samplesByPatient: handleSamplesByPatient,
  patient: handlePatient,
  sample: handleSample,
  sampleAnalysis: handleSampleAnalysis,
  temperature: handleTemperature,
  sensor: handleSensor,
  equipment: handleEquipment,
  result: handleResult,
  withdrawalHistory: handleWithdrawalHistory,
  tissueOriginHistory: handleTissueOriginHistory,
  extracellularNetwork: handleExtracellularNetwork,
  accessLogs: handleAccessLogs,
};

function toCsvRows(previewData) {
  const collectionCandidates = [
    previewData?.patients,
    previewData?.samples,
    previewData?.temperatureLogs,
    previewData?.sensors,
    previewData?.equipment,
    previewData?.results,
    previewData?.logs,
  ];

  const rows = collectionCandidates.find((entry) => Array.isArray(entry)) || [];
  if (!rows.length) {
    return 'total,message\n0,"Sem dados para exportação"';
  }

  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const csvRows = rows.map((row) => headers.map((header) => escape(row?.[header])).join(','));
  return [headers.join(','), ...csvRows].join('\n');
}

router.get('/', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    // #637: mirrors the same inline hard-403/filter pattern buildPreviewData
    // already uses for scoped report types -- not requireOrganizationScope
    // middleware, since this router resolves org scope by hand throughout
    // (see buildPreviewData's own SCOPED_HANDLER_KEYS check).
    const organizationScope = await resolveUserOrganizationScope(db, req.user?.userID || req.user?._id);
    if (!isOrganizationScopeUsable(organizationScope)) {
      return res.status(403).json({ error: 'Sem organização atribuída', message: 'Seu usuário não possui organização atribuída para acessar este recurso' });
    }
    const query = applyOrganizationScopeFilter({}, organizationScope, 'organizationIds');

    const reports = await db.collection('reports').find(query).sort({ generatedAt: -1, createdAt: -1 }).toArray();
    return res.status(200).json(reports.map(normalizeReport));
  } catch (error) {
    logger.error('Erro ao listar relatórios:', error.message || error);
    return res.status(500).json({ error: 'Erro ao listar relatórios', message: error.message });
  }
});

router.get('/:id', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    // #637: see GET /'s identical inline pattern.
    const organizationScope = await resolveUserOrganizationScope(db, req.user?.userID || req.user?._id);
    if (!isOrganizationScopeUsable(organizationScope)) {
      return res.status(403).json({ error: 'Sem organização atribuída', message: 'Seu usuário não possui organização atribuída para acessar este recurso' });
    }

    const { id } = req.params;
    const reportsCollection = db.collection('reports');

    let report = null;
    if (/^\d+$/.test(id)) {
      report = await reportsCollection.findOne({ reportID: Number(id) });
    }

    if (!report && ObjectId.isValid(id)) {
      report = await reportsCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!report) {
      return res.status(404).json({ error: 'Relatório não encontrado' });
    }

    // #637 (F3-G09): mirrors sensor.controller.js's own out-of-scope 403
    // pattern -- a report with organizationIds outside the caller's scope
    // (including [] -- unstamped/legacy) is out of scope for anyone who
    // isn't 'global'.
    if (!isRecordInOrganizationScope(report, organizationScope, 'organizationIds')) {
      return res.status(403).json({ error: 'Acesso negado', message: 'Este relatório pertence a outra organização' });
    }

    return res.status(200).json(normalizeReport(report));
  } catch (error) {
    logger.error('Erro ao buscar relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao buscar relatório', message: error.message });
  }
});

router.post('/generate', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const { reportType, filters = {} } = req.body || {};
    if (!reportType) {
      return res.status(400).json({ error: 'reportType é obrigatório' });
    }

    const reportsCollection = db.collection('reports');
    const previewData = await buildPreviewData(db, reportType, { ...filters, userAccountId: req.user?.userID || req.user?._id });
    const reportID = await nextReportId(reportsCollection);

    // #637: stamp the requesting user's own resolved organization scope
    // onto the saved Report document -- [] for a global (Administrador)
    // caller (their own report may span every organization, so it isn't
    // safe to expose to any single org-scoped viewer either). A separate,
    // independent resolution from buildPreviewData's own internal one
    // (which only runs for scoped report types and doesn't return its
    // result) -- generation itself stays permissive for unscoped types,
    // same as before; buildPreviewData's own hard-403 already covers an
    // unusable scope requesting one of the scoped types.
    const organizationScope = await resolveUserOrganizationScope(db, req.user?.userID || req.user?._id);
    const organizationIds = organizationScope.scope === 'organization' ? organizationScope.organizationIds : [];

    const report = ReportsModel.create({
      reportID,
      reportType,
      filters,
      generatedBy: req.user?.userID || req.user?._id || null,
      status: 'completed',
      generatedAt: new Date(),
      reportData: JSON.stringify(previewData),
      organizationIds,
    });

    const result = await reportsCollection.insertOne(report);
    return res.status(201).json(normalizeReport({ _id: result.insertedId, ...report }));
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: 'Acesso negado', message: error.message });
    }
    logger.error('Erro ao gerar relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
  }
});

router.delete('/:id', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const reportsCollection = db.collection('reports');
    const { id } = req.params;

    let deleteResult = null;
    if (/^\d+$/.test(id)) {
      deleteResult = await reportsCollection.deleteOne({ reportID: Number(id) });
    }

    if ((!deleteResult || deleteResult.deletedCount === 0) && ObjectId.isValid(id)) {
      deleteResult = await reportsCollection.deleteOne({ _id: new ObjectId(id) });
    }

    if (!deleteResult || deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Relatório não encontrado' });
    }

    return res.status(200).json({ success: true, message: 'Relatório removido com sucesso' });
  } catch (error) {
    logger.error('Erro ao remover relatório:', error.message || error);
    return res.status(500).json({ error: 'Erro ao remover relatório', message: error.message });
  }
});

router.get('/:type/filters', authenticate, requirePermission('viewReports'), async (_req, res) => {
  try {
    const filters = [
      { name: 'startDate', label: 'Data Inicial', type: 'date' },
      { name: 'endDate', label: 'Data Final', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] },
      { name: 'keyword', label: 'Palavra-chave', type: 'text' },
    ];

    return res.status(200).json({ filters });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao obter filtros', message: error.message });
  }
});

router.post('/:type/preview', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, { ...(req.body?.filters || {}), userAccountId: req.user?.userID || req.user?._id });
    return res.status(200).json({
      success: true,
      reportType: req.params.type,
      generatedAt: new Date().toISOString(),
      data: previewData,
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Acesso negado', message: error.message });
    }
    logger.error('Erro ao gerar pré-visualização de relatório:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao gerar pré-visualização', message: error.message });
  }
});

router.get('/:type/export', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, { ...(req.query || {}), userAccountId: req.user?.userID || req.user?._id });
    const csv = toCsvRows(previewData);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=report_${Date.now()}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: 'Acesso negado', message: error.message });
    }
    logger.error('Erro ao exportar relatório CSV:', error.message || error);
    return res.status(500).json({ error: 'Erro ao exportar relatório CSV', message: error.message });
  }
});

router.get('/:type/export/pdf', authenticate, requirePermission('viewReports'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Banco de dados não disponível' });
    }

    const previewData = await buildPreviewData(db, req.params.type, { ...(req.query || {}), userAccountId: req.user?.userID || req.user?._id });
    return res.status(200).json({ success: true, format: 'pdf', data: previewData });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: 'Acesso negado', message: error.message });
    }
    logger.error('Erro ao exportar relatório PDF:', error.message || error);
    return res.status(500).json({ error: 'Erro ao exportar relatório PDF', message: error.message });
  }
});

module.exports = router;
