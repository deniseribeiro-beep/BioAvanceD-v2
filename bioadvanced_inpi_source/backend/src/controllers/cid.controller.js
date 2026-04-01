const cidService = require('../services/cid.service');
const logger = require('../utils/logger');


const search = async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const q = String(req.query.q || '').trim();
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    if (q.length < 2) {
      return res.json({ items: [], pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false, query: q } });
    }

    const result = await cidService.searchPaginated(db, q, page, limit);
    return res.json(result);
  } catch (error) {
    logger.error('Erro ao buscar CIDs:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar CIDs',
      message: error.message
    });
  }
};

module.exports = {
  search
};
