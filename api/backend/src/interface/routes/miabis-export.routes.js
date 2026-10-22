const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const { buildMiabisExport } = require('../../services/miabisExport.service');
const logger = require('../../utils/logger');

// RF020 AC5-AC7 (#1322): the MIABIS export of every stored Biobank and
// Collection, mounted at /api/biobanks/miabis. Read only: the global audit
// middleware records the call as a Biobank EXPORT. No organization scope, as
// /api/biobanks and /api/collections have none.
const router = express.Router();

router.get('/export', authenticate, requireRole(3, 4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const [biobanks, collections] = await Promise.all([
      db.collection('biobanks').find({}).toArray(),
      db.collection('collections').find({}).toArray(),
    ]);
    return res.status(200).json({
      success: true,
      data: buildMiabisExport({ biobanks, collections, generatedAt: new Date().toISOString() }),
    });
  } catch (error) {
    logger.error('Erro ao exportar MIABIS:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao exportar MIABIS', message: error.message });
  }
});

module.exports = router;
