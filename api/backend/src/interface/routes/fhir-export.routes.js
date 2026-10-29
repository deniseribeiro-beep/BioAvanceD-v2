const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole, requirePermission } = require('../../infrastructure/middleware/rbac');
const {
  buildFhirExport,
  toFhirProvenance,
  toFhirResearchStudy,
  toFhirAuditEvent,
} = require('../../services/fhir.service');
const { walkWorkflowRunLineage } = require('../../services/workflowRunLineage');
const logger = require('../../utils/logger');

// RF011 AC4 (#1322): the FHIR R4 export of one WorkflowRun (Provenance), one
// Study (ResearchStudy) and one audit event (AuditEvent), mounted at
// /api/export/fhir. Read only (RF011 AC7): the global audit middleware
// records the call as an Export EXPORT. No organization scope, as
// /api/workflow-runs, /api/studies and /api/audit have none. Each gate is the
// one the record's existing read or export uses. The DataFile export is
// fhir-document-reference-export.routes.js, which is scoped. The lineage
// route answers a run and every run its lineage walk reaches as one
// Provenance Bundle (see
// docs/decisions/2026-10-25-fhir-export-workflow-run-lineage-bundle.md).
const router = express.Router();

function byObjectId(rawId) {
  return ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : [];
}

function exportOne(resourceType, transform, findRecord) {
  return async (req, res) => {
    try {
      const { record, id } = await findRecord(req.app.locals.db, req.params);
      if (!record) {
        return res.status(404).json({ success: false, error: `${id} não encontrado` });
      }
      return res.status(200).json({
        success: true,
        data: buildFhirExport(resourceType, [transform(record)], { generatedAt: new Date().toISOString() }),
      });
    } catch (error) {
      logger.error('Erro ao exportar FHIR:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao exportar FHIR', message: error.message });
    }
  };
}

// The run's derived lineage, root first in the walk's order. A run deleted
// between the walk and the read is skipped; a missing root is a 404.
router.get('/workflow-runs/:workflowRunId/lineage', authenticate, requireRole(3, 4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = String(req.params.workflowRunId);
    const lineage = await walkWorkflowRunLineage(db, id);
    if (!lineage) {
      return res.status(404).json({ success: false, error: `${id} não encontrado` });
    }
    const ids = lineage.runs.map((run) => run.workflowRunId);
    const objectIds = ids.filter((rid) => ObjectId.isValid(rid)).map((rid) => new ObjectId(rid));
    const stored = await db.collection('workflowRuns').find({
      $or: [{ workflowRunId: { $in: ids } }, ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])],
    }).toArray();
    const byId = new Map(stored.map((run) => [String(run.workflowRunId || run._id), run]));
    if (!byId.has(ids[0])) {
      return res.status(404).json({ success: false, error: `${id} não encontrado` });
    }
    const resources = ids.map((rid) => byId.get(rid)).filter(Boolean).map(toFhirProvenance);
    const generatedAt = new Date().toISOString();
    return res.status(200).json({
      success: true,
      data: {
        ...buildFhirExport('Provenance', resources, { generatedAt }),
        lineage: { workflowRunId: lineage.workflowRunId, truncated: lineage.truncated },
      },
    });
  } catch (error) {
    logger.error('Erro ao exportar FHIR:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao exportar FHIR', message: error.message });
  }
});

router.get('/workflow-runs/:workflowRunId', authenticate, requireRole(3, 4),
  exportOne('Provenance', toFhirProvenance, async (db, params) => {
    const id = String(params.workflowRunId);
    return { id, record: await db.collection('workflowRuns').findOne({ $or: [...byObjectId(id), { workflowRunId: id }] }) };
  }));

router.get('/studies/:studyId', authenticate, requireRole(3, 4),
  exportOne('ResearchStudy', toFhirResearchStudy, async (db, params) => {
    const id = String(params.studyId);
    return { id, record: await db.collection('studies').findOne({ $or: [...byObjectId(id), { studyId: id }] }) };
  }));

// The permission every read in audit.routes.js uses. An archived event is
// read from audit_events_archive.
router.get('/audit-events/:eventId', authenticate, requirePermission('viewReports'),
  exportOne('AuditEvent', toFhirAuditEvent, async (db, params) => {
    const eventId = String(params.eventId);
    const record = await db.collection('audit_events').findOne({ eventId })
      || await db.collection('audit_events_archive').findOne({ eventId });
    return { id: eventId, record };
  }));

module.exports = router;
