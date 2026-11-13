const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const runMonitoring = require('../../services/runMonitoring.service');
const httpMetrics = require('../../infrastructure/metrics/httpMetrics');
const queueDepth = require('../../infrastructure/metrics/queueDepth');
const { readJobMetrics } = require('../../infrastructure/metrics/jobMetrics');
const { renderPrometheus, CONTENT_TYPE } = require('../../infrastructure/metrics/prometheusText');
const platformAlert = require('../../services/platformAlert.service');

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
// and the BullMQ queue depths; RNF015 C1/C3 (#1468): the worker job metrics.
// Behind the same Administrador gate as /runs; the unauthenticated /api/health
// keeps no such detail. RNF015 C7 (#1468): ?format=prometheus serves the same
// metrics in the Prometheus text format for an equivalent tool to scrape;
// absent or ?format=json keeps the JSON.
router.get('/metrics', authenticate, requireRole(4), async (req, res) => {
  const format = req.query.format === undefined ? 'json' : req.query.format;
  if (format !== 'json' && format !== 'prometheus') {
    return res.status(400).json({ success: false, error: 'Parâmetro inválido', message: 'format deve ser json ou prometheus' });
  }
  try {
    const [queues, jobs] = await Promise.all([
      queueDepth.readQueueDepths(queueDepth.inputsFrom()),
      readJobMetrics(req.app.locals.db),
    ]);
    const http = httpMetrics.snapshot();
    if (format === 'prometheus') {
      // A Buffer, because send() on a string rewrites the charset parameter
      // and moves it ahead of version=0.0.4.
      return res.status(200).set('Content-Type', CONTENT_TYPE).send(Buffer.from(renderPrometheus({ http, queues, jobs }), 'utf8'));
    }
    return res.status(200).json({ success: true, data: { http, queues, jobs } });
  } catch (error) {
    logger.error('Erro ao ler as métricas', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao ler as métricas' });
  }
});

// RNF015 C2 (#1323): the last platform alert evaluation and the active episodes.
router.get('/alerts', authenticate, requireRole(4), async (req, res) => {
  try {
    const data = await platformAlert.getAlertState(req.app.locals.db);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao ler os alertas', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao ler os alertas' });
  }
});

module.exports = router;
