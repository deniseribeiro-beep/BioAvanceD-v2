// backend/src/interface/routes/intakeWizard.routes.js
const express = require('express');
const { ObjectId } = require('mongodb');
const intakeWizardRouter = require('../../../src/routes/intakeWizard');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const { SampleModel } = require('../../models/Sample');
const quarantineActionService = require('../../services/quarantine-action.service');

const router = express.Router();

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
  const rawReleaseStatus = normalizeString(sample.lifecycleStatus || sample.release_status || sample.releaseStatus || body.release_status).toUpperCase();
  const hasActiveConsent = consent.active !== false;

  if (!hasActiveConsent || rawReleaseStatus === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      currentStatus: 'Blocked',
      lifecycleStatus: 'BLOCKED',
      availabilityStatus: 'BLOCKED',
      quarantineStatus: 'QUARANTINED',
      quarantineReason: sample.quarantineReason || consent.reason || 'CONSENT_PENDING',
    };
  }

  if (rawReleaseStatus === 'QUARANTINE' || sample.quarantineStatus === 'QUARANTINED') {
    return {
      status: 'QUARANTINE',
      currentStatus: 'Quarantine',
      lifecycleStatus: 'QUARANTINE',
      availabilityStatus: 'BLOCKED',
      quarantineStatus: 'QUARANTINED',
      quarantineReason: sample.quarantineReason || 'QUALITY_GOVERNANCE_FAILURE',
    };
  }

  return {
    status: 'AVAILABLE',
    currentStatus: 'Available',
    lifecycleStatus: 'AVAILABLE',
    availabilityStatus: 'AVAILABLE',
    quarantineStatus: 'RELEASED',
    quarantineReason: null,
  };
}

function buildSafeSampleSummary(sample = {}, governanceStatus = {}) {
  return {
    _id: normalizeString(sample?._id?.toString?.() || sample?._id) || null,
    specimenId: normalizeString(sample.specimenId || sample.sampleID || sample.sampleId) || null,
    barcode: normalizeString(sample.barcode) || null,
    status: governanceStatus.status,
    currentStatus: governanceStatus.currentStatus,
    lifecycleStatus: governanceStatus.lifecycleStatus,
    availabilityStatus: governanceStatus.availabilityStatus,
    quarantineStatus: governanceStatus.quarantineStatus,
    quarantineReason: governanceStatus.quarantineReason || sample.quarantineReason || null,
    final_grade: normalizeString(sample.final_grade) || null,
    rcs_score: sample.rcs_score ?? null,
    sprec: sample.sprec || null,
    storageLocation: sample.storageLocation || null,
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
  const specimenStatus = governanceStatus.status === 'AVAILABLE' ? 'available' : 'quarantined';
  const { lifecycleStatus, availabilityStatus } = SampleModel.deriveLegacyStatuses(specimenStatus);

  const samplesCollection = await getCollection(db, 'samples');
  const existingSample = await samplesCollection.findOne(query);
  const wasQuarantined = existingSample ? SampleModel.resolveSpecimenStatus(existingSample) === 'quarantined' : false;

  await samplesCollection.updateOne(query, {
    $set: {
      status: governanceStatus.status,
      currentStatus: governanceStatus.currentStatus,
      specimenStatus,
      lifecycleStatus,
      availabilityStatus,
      quarantineStatus: governanceStatus.quarantineStatus,
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
      await quarantineActionService.releaseActiveAction(db, specimenId, 'SYSTEM');
    }
  }

  return { ...governanceStatus, specimenStatus, lifecycleStatus, availabilityStatus };
}

function sanitizeIntakeResponse(body = {}, governanceStatus = null) {
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
    sample: buildSafeSampleSummary(body.sample || {}, safeGovernanceStatus),
  };
}

async function intakeGovernanceResponseGuard(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = async function guardedJson(body) {
    if (req.method !== 'POST') {
      return originalJson(body);
    }

    try {
      const governanceStatus = await enforcePersistedGovernanceStatus(req, body);
      return originalJson(sanitizeIntakeResponse(body, governanceStatus));
    } catch (error) {
      return originalJson(sanitizeIntakeResponse(body));
    }
  };

  return next();
}

router.use(authenticate, requirePermission('createSample'), intakeGovernanceResponseGuard, intakeWizardRouter);

module.exports = router;
