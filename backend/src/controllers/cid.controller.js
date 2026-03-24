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
    if (q.length < 2) {
      return res.json([]);
    }

    // Busca otimizada: código ou descrição, regex, case-insensitive, limit 20
    const regex = new RegExp(q, 'i');
    const collection = db.collection('cids');
    const results = await collection.find({
      $or: [
        { Codigo_Tabulacao: { $regex: regex } },
        { Descricao: { $regex: regex } }
      ]
    }).limit(20).toArray();
    return res.json(results);
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
