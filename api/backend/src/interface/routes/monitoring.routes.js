const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const runMonitoring = require('../../services/runMonitoring.service');
const httpMetrics = require('../../infrastructure/metrics/httpMetrics');
const queueDepth = require('../../infrastructure/metrics/queueDepth');

// RNF015 AC5/AC6 (#1323): the recent Foundation, configuration, reference
// and import runs, failures told apart by phase. Role 4: these are
// platform-wide records of the Foundation, reference and import pipelines,
// whose operator is the Administrador, the same gate referenceRelease.routes.js
// puts on promotion and rollback (#1319).
router.get('/runs', authenticate, requireRole(4), async (req, res) => {
  const limit = runMonitoring.parseLimit(req.query.limit);
  if (limit === null) {
    return res.status(400).json({ success: false, error: 'Parâmetro inválido', message: 'limit deve ser um inteiro de 1 a 100' });
  }
  try {
    const data = await runMonitoring.listRecentRuns(req.app.locals.db, { limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao ler as execuções', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao ler as execuções' });
  }
});

// RNF015 C1/C2 (#1323): request count, latency and errors per route template,
// and the BullMQ queue depths. JSON behind the same Administrador gate as
// /runs; the unauthenticated /api/health keeps no such detail.
router.get('/metrics', authenticate, requireRole(4), async (req, res) => {
  try {
    const queues = await queueDepth.readQueueDepths(queueDepth.inputsFrom());
    return res.status(200).json({ success: true, data: { http: httpMetrics.snapshot(), queues } });
  } catch (error) {
    logger.error('Erro ao ler as métricas', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao ler as métricas' });
  }
});

module.exports = router;
