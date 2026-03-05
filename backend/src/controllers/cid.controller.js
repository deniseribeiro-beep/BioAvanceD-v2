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
    const results = await cidService.search(db, term, limit);
    return res.status(200).json({
      success: true,
      data: results
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
