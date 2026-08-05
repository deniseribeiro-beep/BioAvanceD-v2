const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const logService = require('../../services/log.service');
const logger = require('../../utils/logger');
const { isAdministrator, getActiveRoleCodes } = require('../../services/rbac-assignment.service');

// #426: "auditor" has no dedicated roleCode in the RBAC catalog (roles.min.json
// never defined one) -- normalizedRoleName's substring check is the only
// existing signal for it, so it's kept as a fallback until #427/#428 either
// add a real "auditor" role or retire the concept.
function normalizeRoleName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

async function requireAuditReader(req, res, next) {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }
    const isAdmin = await isAdministrator(db, req.user?.userID);
    if (isAdmin) return next();

    const roleCodes = await getActiveRoleCodes(db, req.user?.userID);
    const isAuditor = roleCodes.includes('auditor') || normalizeRoleName(req.user?.roleName || req.user?.role).includes('auditor');

    if (!isAuditor) {
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

function buildCsv(logs = []) {
  const headers = ['timestamp', 'userName', 'action', 'entity', 'result', 'severity', 'module', 'ipSource', 'message'];
  const escape = (value) => {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = logs.map((log) => headers.map((header) => escape(log?.[header])).join(','));
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
    logger.error('Erro ao consultar logs:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao consultar logs', message: error.message });
  }
});

router.post('/register', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const created = await logService.createLog(db, req.body || {}, req);
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    logger.error('Erro ao registrar log:', error.message || error);
    return res.status(400).json({ success: false, error: 'Erro ao registrar log', message: error.message });
  }
});

router.get('/export/csv', authenticate, requireAuditReader, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const result = await logService.getLogs(db, { ...req.query, limit: req.query?.limit || 10000, page: 1 });
    const csv = buildCsv(result.logs || []);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=logs_${new Date().toISOString().split('T')[0]}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
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
    res.setHeader('Content-Disposition', `attachment; filename=logs_${new Date().toISOString().split('T')[0]}.xlsx`);
    return res.status(200).send(Buffer.from(csv, 'utf8'));
  } catch (error) {
    logger.error('Erro ao exportar logs XLSX:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao exportar logs XLSX', message: error.message });
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
