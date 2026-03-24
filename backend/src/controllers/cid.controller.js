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

    const term = String(req.query.q || '').trim();

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 10;
    const requestedPage = Number(req.query.page);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const result = await cidService.searchPaginated(db, term, page, limit);
    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination
    });
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
