// backend/src/interface/routes/intakeWizard.routes.js
const crypto = require('crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const intakeWizardRouter = require('../../../src/routes/intakeWizard');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const { SampleModel } = require('../../models/Sample');
const quarantineActionService = require('../../services/quarantine-action.service');
const operationalStateDecisionService = require('../../services/operationalStateDecision.service');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');
const GetSampleStorageLocationUseCase = require('../../core/use-cases/GetSampleStorageLocationUseCase');

const router = express.Router();

// The QuarantineAction statuses that still hold a specimen, as the release
// reads them (quarantine-release.service.js).
const OPEN_ACTION_STATUSES = ['active', 'pending_review'];

// #1510: an intake quarantined for its consent whose quality assessment also
// failed records both codes, so a consent signed later
// (consentQuarantine.service.js releases only an action whose every code is
// a consent code) does not release a specimen whose quality still fails.
function intakeReasonCodes(governanceStatus, body = {}) {
  const codes = [governanceStatus.quarantineReason || 'INTAKE_GOVERNANCE'];
  const quality = body?.qualityAssessment;
  const qualityFailed = Boolean(quality) && (quality.governance_status !== 1 || quality.final_grade === 'E');
  if (qualityFailed && !codes.includes('QUALITY_GOVERNANCE_FAILURE')) codes.push('QUALITY_GOVERNANCE_FAILURE');
  return codes;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function buildSampleQuery(sample = {}) {
  const id = normalizeString(sample?._id?.toString?.() || sample?._id);
  const sampleID = normalizeString(sample?.specimenId || sample?.sampleID || sample?.sampleId);
  const barcode = normalizeString(sample?.barcode);
  const queries = [];

  if (id && ObjectId.isValid(id)) {
    queries.push({ _id: new ObjectId(id) });
  }
  if (sampleID) queries.push({ specimenId: sampleID });
  if (barcode) queries.push({ barcode });

  return queries.length > 0 ? { $or: queries } : null;
}

function resolveGovernanceStatus(body = {}) {
  const sample = body?.sample || {};
  const consent = body?.consent || {};
  const hasActiveConsent = consent.active !== false;
  const persistedSpecimenStatus = normalizeString(sample.specimenStatus).toLowerCase() || SampleModel.resolveSpecimenStatus(sample);

  let specimenStatus;
  let status;
  let currentStatus;
  let quarantineReason;

  if (!hasActiveConsent || persistedSpecimenStatus === 'unavailable') {
    specimenStatus = hasActiveConsent ? 'unavailable' : 'quarantined';
    status = 'BLOCKED';
    currentStatus = 'Blocked';
    quarantineReason = sample.quarantineReason || consent.reason || 'CONSENT_PENDING';
  } else if (persistedSpecimenStatus === 'quarantined') {
    specimenStatus = 'quarantined';
    status = 'QUARANTINE';
    currentStatus = 'Quarantine';
    quarantineReason = sample.quarantineReason || 'QUALITY_GOVERNANCE_FAILURE';
  } else {
    specimenStatus = 'available';
    status = 'AVAILABLE';
    currentStatus = 'Available';
    quarantineReason = null;
  }

  return {
    status,
    currentStatus,
    specimenStatus,
    quarantineReason,
  };
}

// #452: resolve via the same GetSampleStorageLocationUseCase/
// MongoStorageRepository abstraction storage-query.controller.js and (post-
// #450) storageService.js use, instead of trusting the storageLocation field
// echoed on the in-memory sample. Falls back to that raw field when the
// abstraction can't be reached (no db, no persisted _id yet, lookup fails) —
// the summary must never throw for this.
async function resolveStorageLocationForSummary(db, sample) {
  if (!db || !sample?._id) {
    return sample?.storageLocation || null;
  }

  try {
    const useCase = new GetSampleStorageLocationUseCase({
      storageRepository: new MongoStorageRepository(db),
    });
    const result = await useCase.execute({ specimenId: sample._id });
    if (!result?.found) {
      return null;
    }
    return {
      boxId: result.location.box.boxId,
      boxName: result.location.box.boxName,
      position: result.location.box.position,
      locationID: result.location.locationID,
      readable: result.location.readable,
    };
  } catch (error) {
    return sample?.storageLocation || null;
  }
}

async function buildSafeSampleSummary(db, sample = {}, governanceStatus = {}) {
  const storageLocation = await resolveStorageLocationForSummary(db, sample);
  return {
    _id: normalizeString(sample?._id?.toString?.() || sample?._id) || null,
    specimenId: normalizeString(sample.specimenId || sample.sampleID || sample.sampleId) || null,
    barcode: normalizeString(sample.barcode) || null,
    status: governanceStatus.status,
    currentStatus: governanceStatus.currentStatus,
    specimenStatus: governanceStatus.specimenStatus,
    quarantineReason: governanceStatus.quarantineReason || sample.quarantineReason || null,
    final_grade: normalizeString(sample.final_grade) || null,
    rcs_score: sample.rcs_score ?? null,
    sprec: sample.sprec || null,
    storageLocation,
  };
}

async function enforcePersistedGovernanceStatus(req, body) {
  const db = req.app.locals.db;
  const sample = body?.sample || {};
  if (!db || !sample || body?.success !== true) {
    return null;
  }

  const query = buildSampleQuery(sample);
  if (!query) {
    return null;
  }

  const governanceStatus = resolveGovernanceStatus(body);
  const { specimenStatus } = governanceStatus;

  const samplesCollection = await getCollection(db, 'samples');
  const existingSample = await samplesCollection.findOne(query);
  // RF026 AC7: closed is final. A closed specimen keeps its status: nothing
  // is written, applied, released or recorded, and the response is built
  // from the intake body alone, as when persistence is unavailable.
  if (existingSample && SampleModel.isTerminalSpecimen(existingSample)) {
    return null;
  }
  const wasQuarantined = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) === 'quarantined' : false;

  // #540: status/currentStatus are legacy fields canonical-data-contract-v1.md
  // bans on the Sample document — specimenStatus is the sole persisted signal.
  // governanceStatus.status/currentStatus still feed buildSafeSampleSummary's
  // response below (a display concern, not a Sample-document write).
  await samplesCollection.updateOne(query, {
    $set: {
      specimenStatus,
      quarantineReason: governanceStatus.quarantineReason,
      updatedAt: new Date(),
    },
  });

  if (existingSample?._id) {
    let action = null;
    // RF019 AC1/AC4 (#1510): the intake's own create already stores the
    // specimen quarantined (a governance failure, a pending consent), so a
    // stored quarantine that no open QuarantineAction covers is this
    // intake's, and records its action. One an open action covers records
    // none, so no source's action is duplicated.
    const openAction = wasQuarantined
      ? (await quarantineActionService.getActionsForSpecimen(db, existingSample))
        .find((candidate) => OPEN_ACTION_STATUSES.includes(candidate.actionStatus))
      : null;
    if (specimenStatus === 'quarantined' && (!wasQuarantined || !openAction)) {
      action = await quarantineActionService.recordAction(db, {
        specimenIds: [quarantineActionService.canonicalSpecimenId(existingSample)],
        reasonCodes: intakeReasonCodes(governanceStatus, body),
      });
      await quarantineActionService.auditDecision(db, { decision: 'applied', action, req });
    } else if (specimenStatus !== 'quarantined' && wasQuarantined) {
      action = await quarantineActionService.releaseActiveAction(db, existingSample, req.user?.userID || 'SYSTEM');
      await quarantineActionService.auditDecision(db, { decision: 'released', action, req });
    }
    // RF006 AC7 (#1315): a change of the stored status is a decision,
    // triggered by the action it applied or released, else by this write.
    await operationalStateDecisionService.recordStatusChange(db, {
      specimenId: quarantineActionService.canonicalSpecimenId(existingSample),
      previousStatus: SampleModel.resolveSpecimenStatus(existingSample),
      newStatus: specimenStatus,
      triggerEventId: action?.quarantineActionId || crypto.randomUUID(),
      rulesApplied: ['intake_governance'],
      reasonCodes: [governanceStatus.quarantineReason || 'INTAKE_GOVERNANCE_CLEARED'],
    });
  }

  return governanceStatus;
}

async function sanitizeIntakeResponse(db, body = {}, governanceStatus = null) {
  if (!body || body.success !== true) {
    return body;
  }

  const safeGovernanceStatus = governanceStatus || resolveGovernanceStatus(body);
  return {
    success: true,
    message: body.message,
    qualidade: body.qualidade,
    qualityAssessment: body.qualityAssessment || null,
    patientMatch: body.patientMatch || null,
    consent: body.consent || null,
    storageLocation: body.storageLocation || null,
    label: body.label || null,
    sample: await buildSafeSampleSummary(db, body.sample || {}, safeGovernanceStatus),
  };
}

async function intakeGovernanceResponseGuard(req, res, next) {
  const originalJson = res.json.bind(res);
  const db = req.app.locals.db;

  res.json = async function guardedJson(body) {
    if (req.method !== 'POST') {
      return originalJson(body);
    }

    try {
      const governanceStatus = await enforcePersistedGovernanceStatus(req, body);
      return originalJson(await sanitizeIntakeResponse(db, body, governanceStatus));
    } catch (error) {
      return originalJson(await sanitizeIntakeResponse(db, body));
    }
  };

  return next();
}

// #1355: the intake writes a sample and may create a participant, both
// organization-owned, so it resolves the caller's scope like POST /api/samples.
router.use(authenticate, requirePermission('createSample'), requireOrganizationScope, intakeGovernanceResponseGuard, intakeWizardRouter);

module.exports = router;
