const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const logService = require('../../services/log.service');
const sessionService = require('../../services/session.service');
const logger = require('../../utils/logger');
const { isAuditReader } = require('../../services/rbac-assignment.service');

async function requireAuditReader(req, res, next) {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    // #429: a real `auditor` roleCode exists in the RBAC catalog -- the
    // unauthenticated-source `roleName`/`role` substring fallback (#426) is
    // retired. #1056 hoisted the admin-or-auditor predicate itself into
    // rbac-assignment.service so reports.routes.js applies the SAME rule to
    // the accessLogs report types; this middleware keeps only the HTTP
    // shaping. Change the admission rule there, not here.
    if (!(await isAuditReader(db, req.user?.userID))) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Apenas perfis Admin ou Auditor podem acessar trilhas de auditoria.'
      });
    }

    return next();
  } catch (error) {
    logger.error('Erro ao verificar permissao de auditoria:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao verificar permissao' });
  }
}

// #1271: an unknown ?source= (log.service's logSourceCollection).
function sendInvalidSource(res, error) {
  return res.status(422).json({ success: false, error: 'Dados inválidos', message: error.message, details: error.details || [error.message] });
}

// #1466: getLogs returns its rows through logSerializer, which turns each Date
// into { _type: 'Date', _value: <ISO 8601>, _formatted }, so String() of the
// stored timestamp printed "[object Object]" and both exports lost every
// event's time (RF012). The timestamp column is written as ISO 8601, read from
// timestamp, then dateTime, then timestampISO; empty when none is a date.
function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let raw = value;
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    if (raw._type !== 'Date' || typeof raw._value !== 'string') return null;
    raw = raw._value;
  }
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function csvTimestamp(log) {
  for (const value of [log?.timestamp, log?.dateTime, log?.timestampISO]) {
    const iso = toIsoTimestamp(value);
    if (iso) return iso;
  }
  return '';
}

function buildCsv(logs = []) {
  const headers = ['timestamp', 'userName', 'action', 'entity', 'result', 'severity', 'module', 'ipSource', 'message'];
  const escape = (value) => {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = logs.map((log) => headers.map((header) => escape(header === 'timestamp' ? csvTimestamp(log) : log?.[header])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

router.get('/', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 422) return sendInvalidSource(res, error);
    logger.error('Erro ao buscar logs:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar logs', message: error.message });
  }
});

router.get('/all', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, { ...req.query, limit: req.query?.limit || 5000, page: 1 });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 422) return sendInvalidSource(res, error);
    logger.error('Erro ao buscar todos os logs:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar logs', message: error.message });
  }
});

router.post('/query', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const filters = req.body || {};
    const result = await logService.getLogs(db, filters);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 422) return sendInvalidSource(res, error);
    logger.error('Erro ao consultar logs:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao consultar logs', message: error.message });
  }
});

// #1107: there is deliberately NO write route in this file. `POST /register`
// used to sit here carrying `authenticate` alone, while every route above and
// below carries requireAuditReader -- reading the RNF009 trail needed
// Admin/Auditor, writing it needed only a login. It handed `req.body` straight
// to logService.createLog, which sources `userId`, `timestamp` and `source`
// from that body, so any logged-in principal (UsuarioExterno included) could
// write a misattributed, backdated, subsystem-spoofing row into an immutable
// trail that integrityCheckService#buildMerkleForDate then folds into the
// daily Merkle root -- cryptographically indistinguishable from a genuine one,
// because the chain attests that a row was not ALTERED, not that it was
// legitimately produced. Write-side mirror of #1056.
//
// Removed rather than gated: it had zero live callers, and no RF/RNF mandates
// a client-submitted audit event. RNF009's subject is "O sistema deve
// registrar", its AC#2 requires a pseudonymized actor and AC#3 a sanitized
// payload, and every dict-02 AuditEvent row (P1X-0325..0343) names "Backend
// Log.*" as its evidence with the frontend appearing only as a Logs-screen
// column. Audit rows are produced server-side by auditLogger.log, which
// anonymizes the actor and stamps a canonical `source` (#1094).
// Do not re-add a client-facing write route here.

router.get('/export/csv', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, { ...req.query, limit: req.query?.limit || 10000, page: 1 });
    const csv = buildCsv(result.logs || []);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const prefix = req.query?.source === 'archive' ? 'logs_archive' : 'logs';
    res.setHeader('Content-Disposition', `attachment; filename=${prefix}_${new Date().toISOString().split('T')[0]}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    if (error.statusCode === 422) return sendInvalidSource(res, error);
    logger.error('Erro ao exportar logs CSV:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao exportar logs CSV', message: error.message });
  }
});

router.get('/export/xlsx', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, { ...req.query, limit: req.query?.limit || 10000, page: 1 });
    const csv = buildCsv(result.logs || []);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const prefix = req.query?.source === 'archive' ? 'logs_archive' : 'logs';
    res.setHeader('Content-Disposition', `attachment; filename=${prefix}_${new Date().toISOString().split('T')[0]}.xlsx`);
    return res.status(200).send(Buffer.from(csv, 'utf8'));
  } catch (error) {
    if (error.statusCode === 422) return sendInvalidSource(res, error);
    logger.error('Erro ao exportar logs XLSX:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao exportar logs XLSX', message: error.message });
  }
});

// #1271: the archived trail. The retention sweep moves expired rows to
// logs_archive under a policy that cites the legal or regulatory obligation
// keeping them (LGPD art. 16, I), and an archive kept for an obligation has to
// be producible when the obligation is invoked. So it is read here, behind the
// same admin-or-auditor rule as the live trail, never left to database access.
// The list and export routes above take ?source=archive for the same rows.
// Registered before '/:id', which would otherwise take 'archive' as a log id.
router.get('/archive', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, { ...(req.query || {}), source: 'archive' });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error('Erro ao buscar logs arquivados:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar logs arquivados', message: error.message });
  }
});

// #1005: the audit read path over sessions, revoked ones included, for every
// user (dict-02 P1X-0267, "Sessões > Motivo"). It sits behind the same
// admin-or-auditor rule as the log trail rather than a named permission, since
// #1056 made isAuditReader the shared rule for access-log data. Registered
// before '/:id', which would otherwise take 'sessions' as a log id.
router.get('/sessions', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await sessionService.listSessionsForAudit(db, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({ success: false, error: 'Dados inválidos', message: error.message, details: error.details || [error.message] });
    }
    logger.error('Erro ao buscar sessões:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar sessões', message: error.message });
  }
});

router.get('/:id', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const logsCollection = db.collection('logs');
    const { id } = req.params;

    let log = null;
    if (ObjectId.isValid(id)) {
      log = await logsCollection.findOne({ _id: new ObjectId(id) });
    }
    if (!log) {
      log = await logsCollection.findOne({ logId: id });
    }
    if (!log) {
      return res.status(404).json({ success: false, error: 'Log não encontrado' });
    }

    return res.status(200).json({ success: true, data: log });
  } catch (error) {
    logger.error('Erro ao buscar log por id:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar log', message: error.message });
  }
});

module.exports = router;
