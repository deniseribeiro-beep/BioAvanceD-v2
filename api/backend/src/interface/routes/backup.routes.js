const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const backupService = require('../../services/backup.service');
const logger = require('../../utils/logger');

function getDirSizeSync(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(targetPath).reduce((total, entry) => total + getDirSizeSync(path.join(targetPath, entry)), 0);
}

router.use(authenticate);
// #632: was requireRole(4) — enforced only hierarchyLevel, ignoring
// whether the caller's role was actually granted manageBackup.
router.use(requirePermission('manageBackup'));

router.post('/perform', async (req, res) => {
  try {
    const result = await backupService.runBackup(req.app.locals.db);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Não foi possível executar backup', data: result });
    }

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao executar backup manual:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao executar backup', message: error.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    const baseDir = backupService.getBackupBaseDir();

    // #723 (RF013 AC#1): merge persisted run-history (state/result) onto
    // the filesystem listing, keyed by absolute path. Best-effort -- a
    // history read failure still leaves the filesystem listing usable.
    let historyByPath = {};
    const db = req.app.locals.db;
    if (db) {
      try {
        const historyEntries = await db.collection('backupHistory').find({}).sort({ startedAt: -1 }).toArray();
        historyByPath = historyEntries.reduce((acc, entry) => {
          if (entry.path && !acc[entry.path]) acc[entry.path] = entry;
          return acc;
        }, {});
      } catch (historyError) {
        logger.error('Erro ao carregar histórico de backups:', historyError.message);
      }
    }

    if (!fs.existsSync(baseDir)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(baseDir, entry.name);
        const stats = fs.statSync(fullPath);
        const history = historyByPath[fullPath] || null;
        return {
          fileName: entry.name,
          path: fullPath,
          size: getDirSizeSync(fullPath),
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          status: history ? history.status : null,
          checksum: history ? history.checksum : null
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json({ success: true, data: entries });
  } catch (error) {
    logger.error('Erro ao listar backups:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao listar backups', message: error.message });
  }
});

router.post('/restore/:fileName', async (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName) {
      return res.status(400).json({ success: false, error: 'fileName inválido' });
    }

    const baseDir = backupService.getBackupBaseDir();
    const backupPath = path.join(baseDir, fileName);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ success: false, error: 'Backup não encontrado' });
    }

    const result = await backupService.restoreBackup(backupPath);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Erro ao restaurar backup', data: result });
    }

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao restaurar backup:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao restaurar backup', message: error.message || String(error) });
  }
});

// #727 (RF013 AC#4): controlled/sandboxed restore test -- restores into a
// disposable scratch database (never the live one restore/:fileName above
// targets), so it's safe to run whenever, unlike the destructive live path.
router.post('/restore-test/:fileName', async (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName) {
      return res.status(400).json({ success: false, error: 'fileName inválido' });
    }

    const baseDir = backupService.getBackupBaseDir();
    const backupPath = path.join(baseDir, fileName);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ success: false, error: 'Backup não encontrado' });
    }

    const result = await backupService.testRestoreBackup(backupPath, req.app.locals.db);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Erro ao testar restauração', data: result });
    }

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Erro ao testar restauração de backup:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao testar restauração de backup', message: error.message || String(error) });
  }
});

module.exports = router;
