const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const availability = require('../../services/availability.service');

// RNF003 C1, C2, C4 (#1468): outage and maintenance records and the monthly
// availability report. Role 4: platform-wide operational records whose
// operator is the Administrador, the same gate /api/monitoring carries.

const BAD_MONTH = { success: false, error: 'Parâmetro inválido', message: 'month deve estar no formato YYYY-MM' };

// RNF003 C2: an outage or an announced maintenance window, with start, end,
// cause and impact.
router.post('/records', authenticate, requireRole(4), async (req, res) => {
  const { errors } = availability.validateRecord(req.body);
  if (errors) {
    return res.status(422).json({ success: false, error: 'Dados inválidos', message: errors.join('; '), details: errors });
  }
  try {
    const data = await availability.createRecord(req.app.locals.db, req.body, req.user && req.user.userID);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao registrar a indisponibilidade', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao registrar a indisponibilidade' });
  }
});

router.get('/records', authenticate, requireRole(4), async (req, res) => {
  const month = availability.parseMonth(req.query.month);
  if (!month) return res.status(400).json(BAD_MONTH);
  try {
    const data = await availability.listRecords(req.app.locals.db, month);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao ler os registros de disponibilidade', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao ler os registros de disponibilidade' });
  }
});

// RNF003 C4: the published monthly operational report.
router.get('/report', authenticate, requireRole(4), async (req, res) => {
  if (!availability.parseMonth(req.query.month)) return res.status(400).json(BAD_MONTH);
  try {
    const data = await availability.monthlyReport(req.app.locals.db, req.query.month);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({ success: false, error: 'Parâmetro inválido', message: error.message, details: [error.message] });
    }
    logger.error('Erro ao calcular a disponibilidade', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Erro interno', message: 'Erro ao calcular a disponibilidade' });
  }
});

module.exports = router;
