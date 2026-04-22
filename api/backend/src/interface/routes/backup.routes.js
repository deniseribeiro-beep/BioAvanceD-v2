const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const backupService = require('../../services/backup.service');
const logger = require('../../utils/logger');

function getDirSizeSync(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(targetPath).reduce((total, entry) => total + getDirSizeSync(path.join(targetPath, entry)), 0);
}

router.use(authenticate);
router.use(requireRole(4));

router.post('/perform', async (_req, res) => {
  try {
    const result = await backupService.runBackup();
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

router.get('/list', async (_req, res) => {
  try {
    const baseDir = backupService.getBackupBaseDir();
    if (!fs.existsSync(baseDir)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(baseDir, entry.name);
        const stats = fs.statSync(fullPath);
        return {
          fileName: entry.name,
          path: fullPath,
          size: getDirSizeSync(fullPath),
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
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

module.exports = router;
