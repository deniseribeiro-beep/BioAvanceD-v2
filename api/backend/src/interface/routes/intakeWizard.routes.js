// backend/src/interface/routes/intakeWizard.routes.js
const express = require('express');
const { ObjectId } = require('mongodb');
const intakeWizardRouter = require('../../../src/routes/intakeWizard');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const { SampleModel } = require('../../models/Sample');
const quarantineActionService = require('../../services/quarantine-action.service');
const MongoStorageRepository = require('../../infrastructure/persistence/mongo/MongoStorageRepository');

const router = express.Router();

function normalizeString(value) {
  return String(value || '').trim();
}

function buildSampleQuery(sample = {}) {
  const id = normalizeString(sample?._id?.toString?.() || sample?._id);
  const specimenId = normalizeString(sample?.specimenId);
  const queries = [];

  if (id && ObjectId.isValid(id)) {
    queries.push({ _id: new ObjectId(id) });
  }
  if (specimenId) queries.push({ specimenId });

  // Data Matrix encodedValue is a physical identifier, not an alias for
  // specimen identity. Governance persistence resolves only canonical _id
  // or specimenId.
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

// Intake summaries resolve physical custody exclusively from the canonical-v2
// normalized chain. No embedded Sample snapshot or compatibility alias is
// consulted when the sample has not yet been persisted/resolved.
async function resolveCurrentStoragePlacement(db, sample) {
  if (!db) return sample?.currentStoragePlacement || null;

  const specimenRef = sample?.specimenId || sample?._id;
  if (!specimenRef) return sample?.currentStoragePlacement || null;

  try {
    const repository = new MongoStorageRepository(db);
    return await repository.findCurrentStoragePlacement(specimenRef);
  } catch (_error) {
    return sample?.currentStoragePlacement || null;
  }
}

async function buildSafeSampleSummary(db, sample = {}, governanceStatus = {}) {
  const currentStoragePlacement = await resolveCurrentStoragePlacement(db, sample);
  return {
    _id: normalizeString(sample?._id?.toString?.() || sample?._id) || null,
    specimenId: normalizeString(sample.specimenId) || null,
    barcode: normalizeString(sample.barcode) || null,
    status: governanceStatus.status,
    currentStatus: governanceStatus.currentStatus,
    specimenStatus: governanceStatus.specimenStatus,
    quarantineReason: governanceStatus.quarantineReason || sample.quarantineReason || null,
    final_grade: normalizeString(sample.final_grade) || null,
    rcs_score: sample.rcs_score ?? null,
    sprec: sample.sprec || null,
    currentStoragePlacement,
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

  const samplesCollection = await getCollection(db, 'Specimen');
  const existingSample = await samplesCollection.findOne(query);
  const wasQuarantined = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) === 'quarantined' : false;

  // status/currentStatus remain response-only governance display fields;
  // specimenStatus is the sole persisted specimen lifecycle signal.
  await samplesCollection.updateOne(query, {
    $set: {
      specimenStatus,
      quarantineReason: governanceStatus.quarantineReason,
      updatedAt: new Date(),
    },
  });

  const specimenId = existingSample?._id ? String(existingSample._id) : null;
  if (specimenId) {
    if (specimenStatus === 'quarantined' && !wasQuarantined) {
      await quarantineActionService.recordAction(db, {
        specimenIds: [specimenId],
        reasonCodes: [governanceStatus.quarantineReason || 'INTAKE_GOVERNANCE'],
      });
    } else if (specimenStatus !== 'quarantined' && wasQuarantined) {
      await quarantineActionService.releaseActiveAction(db, specimenId, req.user?.userID || 'SYSTEM');
    }
  }

  return governanceStatus;
}

async function sanitizeIntakeResponse(db, body = {}, governanceStatus = null) {
  if (!body || body.success !== true) {
    return body;
  }

  const safeGovernanceStatus = governanceStatus || resolveGovernanceStatus(body);
  const sample = body.sample || {};
  const currentStoragePlacement = await resolveCurrentStoragePlacement(db, sample);
  return {
    success: true,
    message: body.message,
    qualidade: body.qualidade,
    qualityAssessment: body.qualityAssessment || null,
    patientMatch: body.patientMatch || null,
    consent: body.consent || null,
    currentStoragePlacement,
    label: body.label || null,
    sample: await buildSafeSampleSummary(db, sample, safeGovernanceStatus),
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

router.use(authenticate, requirePermission('createSample'), intakeGovernanceResponseGuard, intakeWizardRouter);

module.exports = router;
