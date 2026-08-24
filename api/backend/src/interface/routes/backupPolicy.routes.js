const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const backupPolicyService = require('../../services/backup-policy.service');
const scheduler = require('../../services/scheduler.service');
const logger = require('../../utils/logger');

// #728 (RF013 AC#5/AC#6): Administrador-only, same hierarchyLevel-4 gate
// security.routes.js's /config uses for its own singleton admin config.
router.use(authenticate);
router.use(requireRole(4));

router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const policy = await backupPolicyService.getPolicy(db);
    return res.status(200).json({ success: true, data: policy });
  } catch (error) {
    logger.error('Erro ao buscar política de backup:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao buscar política de backup', message: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const currentPolicy = await backupPolicyService.getPolicy(db);
    const { merged, changed } = await backupPolicyService.updatePolicy(db, req.body || {}, currentPolicy, req);

    // #728: hot-reload the live cron schedule the instant cronExpression
    // changes, so a policy edit takes effect without a process restart --
    // the design call's explicit added-scope item beyond the plain AC text.
    if (changed.includes('cronExpression')) {
      await scheduler.reloadBackupSchedule(db);
    }

    return res.status(200).json({ success: true, message: 'Política de backup atualizada com sucesso', data: merged });
  } catch (error) {
    if (error.validationErrors) {
      return res.status(422).json({ success: false, error: 'Payload inválido', details: error.validationErrors });
    }
    logger.error('Erro ao atualizar política de backup:', error.message || error);
    return res.status(400).json({ success: false, error: 'Erro ao atualizar política de backup', message: error.message });
  }
});

module.exports = router;
