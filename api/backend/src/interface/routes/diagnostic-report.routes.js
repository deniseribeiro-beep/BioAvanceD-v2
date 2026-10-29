const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const patientService = require('../../services/patient.service');
const { isRecordInOrganizationScope } = require('../../services/rbac-assignment.service');
const {
  createDiagnosticReport,
  getDiagnosticReportsForParticipant,
  getDiagnosticReportById,
} = require('../../services/diagnostic-report.service');

// dict-02 P1X-0168..0174 DiagnosticReport (#695): create one, read one, and
// list one participant's. Gated as /api/patients/:id/observations: the write
// needs createPatient, the reads a session and organization scope
// (docs/decisions/2026-10-23-diagnostic-report-route.md).
const router = express.Router();

// The body fields a caller may set; diagnosticReportId is always assigned
// by the model.
const WRITABLE_FIELDS = ['participantId', 'encounterId', 'reportStatus', 'issuedDateTime', 'resultIds', 'documentUri'];

const OUT_OF_SCOPE_BODY = {
  success: false,
  error: 'Acesso negado',
  message: 'Este paciente pertence a outra organização'
};

// #626: a participant whose patient record lies outside the caller's scope
// is refused. A nonexistent patient is not, as participantId stays
// unenforced (docs/decisions/2026-10-23-diagnostic-report-entity.md).
async function isParticipantOutOfScope(db, participantId, organizationScope) {
  const patient = await patientService.getPatient(db, participantId);
  return Boolean(patient) && !isRecordInOrganizationScope(patient, organizationScope, 'clinicalUnitId');
}

// The model coerces each field, so a malformed one would be stored silently
// (a non-list resultIds as [], skipping its reference check). Refused here
// instead, every failure in one list.
function payloadShapeErrors(payload) {
  const errors = [];
  const present = (value) => value !== undefined && value !== null;
  if (present(payload.resultIds) && !Array.isArray(payload.resultIds)) {
    errors.push('resultIds deve ser uma lista');
  }
  if (present(payload.reportStatus) && typeof payload.reportStatus !== 'string') {
    errors.push('reportStatus deve ser texto');
  }
  if (present(payload.issuedDateTime) && Number.isNaN(new Date(payload.issuedDateTime).getTime())) {
    errors.push('issuedDateTime inválido');
  }
  return errors;
}

function databaseUnavailable(res) {
  return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
}

router.post('/', authenticate, requirePermission('createPatient'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return databaseUnavailable(res);

    const body = req.body || {};
    const payload = {};
    for (const field of WRITABLE_FIELDS) {
      if (body[field] !== undefined) payload[field] = body[field];
    }

    const shapeErrors = payloadShapeErrors(payload);
    if (shapeErrors.length) {
      throw Object.assign(new Error(shapeErrors.join(', ')), { statusCode: 422, details: shapeErrors });
    }

    const participantId = String(payload.participantId || '').trim();
    if (participantId && await isParticipantOutOfScope(db, participantId, req.organizationScope)) {
      return res.status(403).json(OUT_OF_SCOPE_BODY);
    }

    const report = await createDiagnosticReport(db, payload);
    return res.status(201).json({ success: true, data: report });
  } catch (error) {
    return res.status(error.statusCode === 422 ? 422 : 500).json({
      success: false,
      error: 'Erro ao registrar DiagnosticReport',
      message: error.message,
      details: error.details
    });
  }
});

router.get('/', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return databaseUnavailable(res);

    // Never list every participant's reports: the list is per participant.
    const participantId = String(req.query.participantId || '').trim();
    if (!participantId) {
      return res.status(400).json({ success: false, error: 'participantId é obrigatório' });
    }
    if (await isParticipantOutOfScope(db, participantId, req.organizationScope)) {
      return res.status(403).json(OUT_OF_SCOPE_BODY);
    }

    const reports = await getDiagnosticReportsForParticipant(db, participantId);
    return res.status(200).json({ success: true, data: reports });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao listar DiagnosticReports', message: error.message });
  }
});

router.get('/:diagnosticReportId', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return databaseUnavailable(res);

    const report = await getDiagnosticReportById(db, String(req.params.diagnosticReportId).trim());
    if (!report) {
      return res.status(404).json({ success: false, error: 'Registro não encontrado' });
    }
    if (await isParticipantOutOfScope(db, report.participantId, req.organizationScope)) {
      return res.status(403).json(OUT_OF_SCOPE_BODY);
    }

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao consultar DiagnosticReport', message: error.message });
  }
});

module.exports = router;
